// The only way this tool talks to DataForSEO (api.dataforseo.com). Every paid call goes through a cost guard:
//   1. Before the call: refuse (BudgetError, no request sent) when this month's spend, plus the estimates of calls still in flight
//      (any process sharing the ledger), plus a conservative estimate for this call would pass `dataforseo.monthlyCapUsd`; when the
//      live account balance (free GET /v3/appendix/user_data, cached for 60 seconds) would fall under `dataforseo.minBalanceUsd`;
//      when the balance cannot be read; when the ledger cannot be read; or when the call cannot be estimated (an endpoint with no
//      known price needs the caller's own `estimateUsd`). No blind spending.
//   2. After the call: add the response's own `cost` to the ledger (<state>/dataforseo-ledger.json: per month, per job, per
//      endpoint). A call that times out or drops after it was sent may have been charged, so its estimate is recorded (flagged).
//      The state folder is what `seo-autopilot state save` keeps on the data branch, so the ledger survives runs.
//   3. When it refuses: one alert per day per reason through the generic notifier (src/lib/notify.mjs, TELEGRAM_* env).
// Scope: the cap counts one ledger, which is one site in one state folder. The balance floor is the only account-wide limit (and,
// within one process, every guard on the same login sees what the others spent since the last balance reading).
// Endpoint paths are lowercase words joined by "/" (anything else is refused), so a priced prefix cannot reach another endpoint.
// Config, per site: "dataforseo": { "monthlyCapUsd": 8, "minBalanceUsd": 10 }. Credentials: DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD
// (only in the Authorization header; never logged, never in an error or an alert). `fetch`, `now`, the ledger and the notifier are
// injectable so tests never touch the network.
import { randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { writeJson } from "../core/util.mjs";
import { sendTelegram } from "./notify.mjs";
import { DEFAULT_CAP_USD, DEFAULT_MIN_BALANCE_USD } from "./budget-defaults.mjs";

export { DEFAULT_CAP_USD, DEFAULT_MIN_BALANCE_USD };
const BASE = "https://api.dataforseo.com/v3/";
// The docs' example user_data response lists the rate limits per minute, including `"appendix": { "user_data": 6, ... }`
// (https://docs.dataforseo.com/v3/appendix/user_data/). One read per minute per ledger stays well under that, and another program
// spending from the same account is seen within a minute.
const BALANCE_TTL_MS = 60 * 1000;
const TIMEOUT_MS = 30 * 1000;
// A reservation older than this belongs to a run that died mid-call (every call ends within TIMEOUT_MS). It may have been charged,
// so it is counted as spent at its estimate.
const STALE_RESERVATION_MS = 10 * 60 * 1000;
const LOCK_STALE_MS = 10 * 1000, LOCK_WAIT_MS = 15 * 1000;
const UNWRITABLE = new Set(["EACCES", "EPERM", "EROFS"]);
// Errors that never reached a billable task: the key was refused, or the request was rate limited. Any other error with no readable
// cost (a 5xx, a gateway page) may have been billed, so its estimate is recorded.
const UNBILLED_STATUS = new Set([401, 403, 429]);

export class BudgetError extends Error {
  /** reason: "monthly-cap" | "min-balance" | "balance-unavailable" | "no-estimate" | "bad-path" | "ledger-invalid" | "ledger-locked" | "ledger-unwritable" | "invalid-config" | "no-guard" */
  constructor(message, reason, details = {}) { super(message); this.name = "BudgetError"; this.reason = reason; this.details = details; }
}

// A deliberately high estimate of what one task costs, in USD, used only to decide whether it may start. Published pay-as-you-go
// prices are a base per task plus a small amount per returned item (Labs: $0.012 + $0.00012 per item; SERP: per page of 10 results).
// The item count is the `limit` (or `depth`) asked for, or the size of an input list (`keywords`, `targets`) when that is larger:
// endpoints such as keyword_overview (700 keywords) or bulk_keyword_difficulty (1,000) return one item per input.
// The real cost always comes from the response and is what the ledger records. An endpoint not listed here has no estimate: the
// caller passes its own (`post(path, tasks, { estimateUsd })`), or the call is refused.
const ESTIMATES = [
  [/^serp\//, { base: 0.003, per: 0.0004, size: "depth", dflt: 10 }],
  [/^dataforseo_labs\//, { base: 0.02, per: 0.0002, size: "limit", dflt: 100 }],
  [/^backlinks\//, { base: 0.03, per: 0.0001, size: "limit", dflt: 100 }],
  [/^keywords_data\//, { base: 0.1, per: 0.0001, size: null, dflt: 0 }],
];
const INPUT_LISTS = ["keywords", "targets"];

const round = (n) => Math.round(n * 1e6) / 1e6;
// Estimates round up to the next millionth, so a tiny one never becomes $0 and slips under a cap of 0 or a full month.
// (The 1e-6 slack absorbs float noise such as 0.003 + 0.0004 * 10 = 0.007000000000000001.)
const roundUp = (n) => Math.max(Math.ceil(n * 1e6 - 1e-6), n > 0 ? 1 : 0) / 1e6;
const monthOf = (d) => d.toISOString().slice(0, 7);
const dayOf = (d) => d.toISOString().slice(0, 10);
// Whole cents for normal amounts, up to four decimals for small ones, so a $0.001 cap does not read as $0.00.
const usd = (n) => (n !== 0 && Math.abs(n) < 0.1 ? `$${Number(Number(n).toFixed(4))}` : `$${Number(n).toFixed(2)}`);
const isObj = (x) => x != null && typeof x === "object" && !Array.isArray(x);
const isMoney = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
const isCount = (x) => Number.isInteger(x) && x >= 0;
const clone = (x) => JSON.parse(JSON.stringify(x));

/** "/v3/serp/..." and "/serp/..." are "serp/...". */
export const normalizePath = (p) => String(p ?? "").trim().replace(/^\/+/, "").replace(/^v3\//, "");
// An endpoint path is lowercase words joined by single slashes. Anything else ("..", ".", "%2e", "\", "?", "//", a trailing "/")
// could make the URL resolve to an endpoint other than the one that was priced, so it is refused before any estimate.
const VALID_PATH = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/;
export const isValidPath = (p) => VALID_PATH.test(normalizePath(p));

/** { usd } for one task of a known endpoint, { unknown } for an endpoint with no price, { error } for a bad limit or depth. */
function estimateTask(path, task) {
  if (!VALID_PATH.test(path)) return { error: "not an endpoint path" };
  const hit = ESTIMATES.find(([re]) => re.test(path));
  if (!hit) return { unknown: true };
  const { base, per, size, dflt } = hit[1];
  const t = isObj(task) ? task : {};
  let items = dflt;
  if (size && t[size] != null) {
    const v = t[size], n = Number(v);
    if (!["number", "string"].includes(typeof v) || !Number.isFinite(n) || n <= 0) return { error: `${size} must be a positive number (got ${typeof v === "string" ? JSON.stringify(v) : String(v)})` };
    items = n;
  }
  for (const k of INPUT_LISTS) if (Array.isArray(t[k])) items = Math.max(items, t[k].length);
  return { usd: roundUp(base + per * items) };
}

/** Conservative USD estimate for one task of `path` (for example "dataforseo_labs/google/keyword_ideas/live"), or null when the
 *  endpoint has no known price or the task asks for a non-positive limit/depth. */
export function estimateCost(path, task = {}) {
  const r = estimateTask(normalizePath(path), task);
  return r.usd ?? null;
}

/** The estimate for one call: the table's, or the caller's `estimateUsd` (whichever is higher for a known endpoint). */
function estimateCall(path, list, opts) {
  const given = opts?.estimateUsd;
  if (given !== undefined && !(typeof given === "number" && Number.isFinite(given) && given > 0)) return { error: `estimateUsd must be a positive number of US dollars (got ${String(given)}).` };
  if (!list.length) return { error: "no task to send." };
  let table = 0, unknown = false;
  for (const t of list) {
    const r = estimateTask(path, t);
    if (r.error) return { error: `${r.error}.` };
    if (r.unknown) unknown = true; else table += r.usd;
  }
  if (unknown && given === undefined) return { error: `no price is known for "${path}", so the call cannot be checked against the cap. Pass a generous { estimateUsd } for the whole call.` };
  return { usd: roundUp(unknown ? given : Math.max(table, given ?? 0)) };
}

// ---- the ledger ------------------------------------------------------------------------------------------------------------------
const emptyLedger = () => ({ version: 1, months: {}, reserved: {} });

/** Throws when the ledger is not what this module writes. A ledger that cannot be trusted refuses spending; it is never rewritten. */
export function checkLedger(l) {
  const bad = (what) => { throw new Error(`the ledger is not valid (${what})`); };
  if (!isObj(l)) bad("not an object");
  if (!isObj(l.months)) bad("no months");
  for (const [k, m] of Object.entries(l.months)) {
    if (!/^\d{4}-\d{2}$/.test(k) || !isObj(m) || !isMoney(m.usd) || !isCount(m.calls)) bad(`month ${k}`);
    if (m.estimatedCalls != null && !isCount(m.estimatedCalls)) bad(`month ${k} estimatedCalls`);
    if (m.jobs != null && !isObj(m.jobs)) bad(`month ${k} jobs`);
    for (const [j, v] of Object.entries(m.jobs || {})) {
      if (!isObj(v) || !isMoney(v.usd) || !isCount(v.calls) || (v.endpoints != null && !isObj(v.endpoints))) bad(`month ${k} job ${j}`);
      for (const [e, x] of Object.entries(v.endpoints || {})) if (!isObj(x) || !isMoney(x.usd) || !isCount(x.calls)) bad(`month ${k} job ${j} endpoint ${e}`);
    }
  }
  if (l.reserved != null) {
    if (!isObj(l.reserved)) bad("reserved");
    for (const [id, r] of Object.entries(l.reserved)) if (!isObj(r) || !isMoney(r.usd) || !Number.isFinite(r.at)) bad(`reservation ${id}`);
  }
  return l;
}

const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const lockedError = (lock) => Object.assign(new Error(`the ledger is locked by another run (${lock})`), { code: "LEDGER_LOCKED" });
const readOr = (f, dflt) => { try { return readFileSync(f, "utf8"); } catch { return dflt; } };
const isStale = (f) => { try { return Date.now() - statSync(f).mtimeMs > LOCK_STALE_MS; } catch { return null; } };

/** A lock older than LOCK_STALE_MS was left by a killed process. A process that stat'ed it and was then paused could remove a live
 *  lock created after its stat, so takeovers go one at a time through a second O_EXCL file (`.takeover`, held for microseconds) and
 *  look again under it: only a lock that is still stale is moved (renamed to a name only this process uses), and only when the moved
 *  file is still the one that was seen is it removed. Anything else is put back. While a stale lock exists nobody can create a new
 *  one, and nobody else can remove it without the gate, so a live lock is moved only if its own holder kept it past LOCK_STALE_MS
 *  (a suspended process); that holder then sees it lost the lock and writes nothing. */
function takeOver(lock, token) {
  const gate = `${lock}.takeover`;
  try { writeFileSync(gate, token, { flag: "wx" }); } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (isStale(gate)) rmSync(gate, { force: true }); // its holder died in the middle of a takeover
    return; // someone else is taking over: try the lock again
  }
  try {
    const seen = readOr(lock, null);
    if (seen === null || isStale(lock) !== true) return; // released, or a fresh lock is there now
    const aside = `${lock}.stale-${token}`;
    try { renameSync(lock, aside); } catch (e) { if (e.code === "ENOENT") return; throw e; }
    if (readOr(aside, null) === seen && isStale(aside) === true) { rmSync(aside, { force: true }); return; }
    try { linkSync(aside, lock); } catch { /* a newer lock is already there; the moved one's holder sees it lost the lock */ }
    rmSync(aside, { force: true });
  } finally { if (readOr(gate, null) === token) rmSync(gate, { force: true }); }
}

/** Run `fn(held)` holding an exclusive lock file next to `file` (created with O_EXCL, holding a random token), so processes sharing
 *  the file never interleave a read-modify-write. `fn` is synchronous, so the lock is held for milliseconds. `held()` throws when the
 *  lock no longer holds this run's token (another process took it over); callers check it right before they write. The lock is
 *  removed only when it still holds this run's token. */
function withLock(file, fn) {
  const lock = `${file}.lock`, token = `${process.pid}-${randomUUID()}`;
  mkdirSync(dirname(file), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try { writeFileSync(lock, token, { flag: "wx" }); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const stale = isStale(lock);
      if (stale === null) continue; // released meanwhile
      if (stale) takeOver(lock, token);
      if (Date.now() - t0 > LOCK_WAIT_MS) throw lockedError(lock);
      pause(stale ? 1 : 5);
    }
  }
  const held = () => { if (readOr(lock, null) !== token) throw lockedError(lock); };
  try { return fn(held); } finally { if (readOr(lock, null) === token) rmSync(lock, { force: true }); }
}

/** The file's real location, so a ledger reached through a symlink (or a symlinked folder) is one ledger with one lock, and an atomic
 *  write replaces the target rather than the link. */
function realFile(file) {
  try { return realpathSync(file); } catch { /* not there yet */ }
  try { return join(realpathSync(dirname(file)), basename(file)); } catch { return resolve(file); }
}

/** The ledger file of a site: <state>/dataforseo-ledger.json. */
export const ledgerFile = (site) => `${site.paths.state}/dataforseo-ledger.json`;

/**
 * A ledger kept in a JSON file. Every change is a locked read-modify-write (`update`), so guards in one process or in several
 * processes never overwrite each other. Alert memory is a separate file next to it (<name>.alerts.json): an alert never writes
 * the money ledger, and a corrupt ledger can still be alerted about once a day.
 */
export function fileLedger(file) {
  const abs = realFile(file), alertsFile = realFile(`${abs.replace(/\.json$/i, "")}.alerts.json`);
  const load = () => (existsSync(abs) ? JSON.parse(readFileSync(abs, "utf8")) : emptyLedger());
  const loadAlerts = () => { try { const a = existsSync(alertsFile) ? JSON.parse(readFileSync(alertsFile, "utf8")) : {}; return isObj(a) ? a : {}; } catch { return {}; } };
  return {
    key: abs,
    load,
    update: (fn) => withLock(abs, (held) => { const d = load(); const out = fn(d); held(); writeJson(abs, d); return out; }),
    alerts: { load: loadAlerts, update: (fn) => withLock(alertsFile, (held) => { const a = fn(loadAlerts()); held(); writeJson(alertsFile, a); }) },
  };
}
/** A ledger in memory (tests, one-off scripts). */
export function memoryLedger(initial) {
  let data = initial || emptyLedger(), alerts = {};
  return {
    load: () => clone(data),
    update: (fn) => { const d = clone(data); const out = fn(d); data = d; return out; },
    alerts: { load: () => clone(alerts), update: (fn) => { alerts = clone(fn(clone(alerts))); } },
    get data() { return data; },
  };
}
// A ledger object from elsewhere may have only load/save.
const updater = (ledger) => ledger.update || ((fn) => { const d = ledger.load(); const out = fn(d); ledger.save(d); return out; });

/** Add one paid call to a ledger object (pure apart from mutating `ledger`). */
export function addToLedger(ledger, { month, job, endpoint, cost, estimated = false }) {
  const m = (ledger.months[month] ||= { usd: 0, calls: 0, jobs: {} });
  const j = ((m.jobs ||= {})[job] ||= { usd: 0, calls: 0, endpoints: {} });
  const e = ((j.endpoints ||= {})[endpoint] ||= { usd: 0, calls: 0 });
  for (const x of [m, j, e]) { x.usd = round(x.usd + cost); x.calls += 1; }
  if (estimated) m.estimatedCalls = (m.estimatedCalls || 0) + 1;
  return ledger;
}

/** Reservations of runs that died mid-call become estimated spend in the month they started. Returns the live reservations' total. */
function settleStale(l, t) {
  let live = 0;
  for (const [id, r] of Object.entries(l.reserved || {})) {
    if (t - r.at > STALE_RESERVATION_MS) {
      addToLedger(l, { month: monthOf(new Date(r.at)), job: String(r.job || "unknown"), endpoint: String(r.endpoint || "unknown"), cost: r.usd, estimated: true });
      delete l.reserved[id];
    } else live += r.usd;
  }
  return round(live);
}

/** What a response says it cost: the top-level `cost`, else the sum of the tasks' costs, else null (unknown). Only a finite number of
 *  0 or more is a cost: a negative one would lower the ledger, and "", false, [] or " " would read as $0. A cost that is present but
 *  not such a number makes the whole answer unknown, so the caller records its estimate instead. */
export function costOf(json) {
  if (!isObj(json)) return null;
  if (json.cost != null) return isMoney(json.cost) ? json.cost : null;
  let sum = 0, any = false;
  for (const t of Array.isArray(json.tasks) ? json.tasks : []) {
    if (!isObj(t) || t.cost == null) continue;
    if (!isMoney(t.cost)) return null;
    sum += t.cost; any = true;
  }
  return any ? round(sum) : null;
}

const authHeader = (env) => `Basic ${Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64")}`;
export const dataforseoEnabled = (env) => Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD);

/** The cap and floor, checked: numbers of US dollars, 0 or more. A missing key takes its default; anything else throws. */
function checkCfg(cfg) {
  if (cfg == null) cfg = {};
  if (!isObj(cfg)) throw new BudgetError(`dataforseo: the "dataforseo" setting must be an object such as {"monthlyCapUsd": 8, "minBalanceUsd": 10}.`, "invalid-config");
  const pick = (k, dflt) => {
    if (cfg[k] === undefined) return dflt;
    if (!isMoney(cfg[k])) throw new BudgetError(`dataforseo: ${k} must be a number of US dollars, 0 or more (got ${typeof cfg[k] === "string" ? JSON.stringify(cfg[k]) : String(cfg[k])}).`, "invalid-config");
    return cfg[k];
  };
  return { cap: pick("monthlyCapUsd", DEFAULT_CAP_USD), floor: pick("minBalanceUsd", DEFAULT_MIN_BALANCE_USD) };
}

// The floor is per account, not per ledger: two sites on one DataForSEO login spend from one balance. Each account (login) keeps an
// in-process total of what its calls cost, and each balance reading remembers that total when it was read, so a cached reading is
// lowered by everything any guard on the same account spent since (whatever its ledger). Readings are shared per account and
// transport (the transport keeps injected fakes apart; real runs use one).
const ACCOUNTS = new Map();
const accountOf = (login) => {
  const k = String(login ?? "");
  if (!ACCOUNTS.has(k)) ACCOUNTS.set(k, { spent: 0, readings: new Map() });
  return ACCOUNTS.get(k);
};
const readingOf = (account, source) => {
  if (!account.readings.has(source)) account.readings.set(source, { value: null, at: 0, spentAtRead: 0 });
  return account.readings.get(source);
};

/**
 * Create a cost guard for one run of one job. Guards over the same ledger (same file, or same memoryLedger object) share the cap:
 * each call reserves its estimate in the ledger before it starts, so parallel jobs, and parallel processes, see each other.
 *   cfg        { monthlyCapUsd, minBalanceUsd } (the site's `dataforseo` block; defaults 8 and 10); anything else throws
 *   job        the job name, for the ledger ("keywords", "rank", ...)
 *   env, fetch DataForSEO credentials and transport
 *   ledger     fileLedger(ledgerFile(site)) in real runs; memoryLedger() in tests
 *   label      first words of an alert, usually the site's host
 *   notify     async (text) => { sent, messageId?, reason? }; default: Telegram from env (TELEGRAM_*), silent no-op when not set
 *   getBalance async () => USD; default: the live free endpoint (tests only)
 *   now        () => Date
 */
export function createCostGuard({ cfg = {}, job = "unknown", env = process.env, fetch: f = globalThis.fetch, ledger, label = "", notify, notifyFetch, getBalance, now = () => new Date() } = {}) {
  if (!ledger) throw new Error("createCostGuard: a ledger is required (fileLedger(ledgerFile(site)) or memoryLedger())");
  const { cap, floor } = checkCfg(cfg);
  const update = updater(ledger);
  const alertStore = ledger.alerts || memoryLedger().alerts;
  const account = accountOf(env.DATAFORSEO_LOGIN), cache = readingOf(account, getBalance || f);
  const alertedThisRun = new Set();
  const send = notify || ((text) => sendTelegram(text, { env, fetch: notifyFetch || globalThis.fetch }));

  async function readBalance() {
    const t = now().getTime();
    if (cache.value != null && t >= cache.at && t - cache.at < BALANCE_TTL_MS) return round(cache.value - (account.spent - cache.spentAtRead));
    let value;
    if (getBalance) value = await getBalance();
    else {
      let r;
      try { r = await f(`${BASE}appendix/user_data`, { headers: { Authorization: authHeader(env) }, signal: AbortSignal.timeout(TIMEOUT_MS) }); } catch (e) { throw new Error(`request failed (${e.name || "error"})`); }
      if (!r.ok) throw new Error(`HTTP ${r.status}${r.status === 401 || r.status === 403 ? " (key rejected)" : ""}`);
      const j = await r.json();
      value = j?.tasks?.[0]?.result?.[0]?.money?.balance;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("no balance in the response");
    Object.assign(cache, { value, at: t, spentAtRead: account.spent });
    return value;
  }

  async function alertOnce(reason, text) {
    if (alertedThisRun.has(reason)) return;
    alertedThisRun.add(reason);
    try {
      const day = dayOf(now());
      if (alertStore.load()?.[day]?.includes?.(reason)) return;
      const r = await send(`${label ? `${label} | ` : ""}${text}`);
      if (!r?.sent) return; // not configured or failed: try again on the next run, never block on it
      // Read again after the send: another refusal may have been remembered meanwhile. Older days are dropped.
      alertStore.update((a) => ({ [day]: [...new Set([...(Array.isArray(a?.[day]) ? a[day] : []), reason])] }));
    } catch { /* an alert problem must never hide the BudgetError */ }
  }

  async function block(reason, message, details) {
    await alertOnce(reason, `DataForSEO paused: ${message} Job: ${job}. No request was sent.`);
    throw new BudgetError(`dataforseo: ${message}`, reason, details);
  }
  const ledgerProblem = (e) => (e?.code === "LEDGER_LOCKED"
    ? block("ledger-locked", `${e.message}, so the spend cannot be checked.`, { cause: e.message })
    : UNWRITABLE.has(e?.code)
      ? block("ledger-unwritable", `the spend ledger's folder cannot be written (${e.code}${e.path ? ` on ${dirname(e.path)}` : ""}), so no spend could be recorded.`, { cause: e.code })
      : block("ledger-invalid", `the spend ledger cannot be read (${String(e?.message || e).slice(0, 120)}). It is left as it is for a person to check.`, { cause: String(e?.message || e) }));

  const guard = {
    cap, floor, job,
    /** This month's recorded spend in USD (throws when the ledger is not valid). */
    spent: () => checkLedger(ledger.load()).months[monthOf(now())]?.usd || 0,
    /** The live balance in USD (cached 60 seconds). */
    balance: readBalance,
    /**
     * POST one or more tasks to a DataForSEO endpoint (path after /v3/, for example "serp/google/organic/live/advanced").
     * Throws BudgetError before any request when the call is not allowed. Returns the parsed response.
     * opts.estimateUsd: the caller's own generous estimate for the whole call, in USD. Required for an endpoint this module has no
     * price for (for example "serp/google/ai_mode/live/advanced" is priced as SERP, but "ai_optimization/..." is not); for a
     * known endpoint the higher of the two is used.
     */
    async post(rawPath, tasks, opts = {}) {
      if (!dataforseoEnabled(env)) throw new Error("dataforseo: DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set");
      const path = normalizePath(rawPath);
      if (!VALID_PATH.test(path)) throw new BudgetError(`dataforseo: ${JSON.stringify(String(rawPath ?? "").slice(0, 80))} is not an endpoint path (lowercase letters, digits and "_", joined by single "/"). No request was sent.`, "bad-path", { path });
      const list = Array.isArray(tasks) ? tasks : [tasks];
      const e = estimateCall(path, list, opts);
      if (e.error) throw new BudgetError(`dataforseo: ${path}: ${e.error} No request was sent.`, "no-estimate", { path });
      const est = e.usd, id = `${process.pid}-${randomUUID()}`;
      let verdict;
      try {
        verdict = update((l) => {
          checkLedger(l);
          const t = now().getTime(), others = settleStale(l, t), spent = l.months[monthOf(now())]?.usd || 0;
          if (spent + others + est > cap) return { refused: true, spent, others };
          (l.reserved ||= {})[id] = { usd: est, at: t, job, endpoint: path }; // reserved before the first await
          return { spent, others };
        });
      } catch (err) { return ledgerProblem(err); }
      if (verdict.refused) {
        const { spent, others } = verdict;
        return block("monthly-cap", `this month's spend ${usd(spent)}${others ? ` plus ${usd(others)} for calls in flight` : ""} plus about ${usd(est)} for this call would pass the monthly cap of ${usd(cap)}.`, { spent, inFlight: others, estimate: est, cap });
      }
      // `sent` is set before the request goes out. From then on the call may have been billed, so its reservation is removed only
      // together with recording its cost; if that record fails, the reservation stays in the ledger, still counted against the cap,
      // and becomes estimated spend after STALE_RESERVATION_MS (settleStale).
      let open = true, sent = false;
      const finish = (cost, estimated) => { // remove the reservation; record the cost when there is one
        try {
          update((l) => {
            if (l.reserved) delete l.reserved[id];
            if (cost != null) addToLedger(l, { month: monthOf(now()), job, endpoint: path, cost, estimated });
          });
        } catch (err) {
          if (!sent) throw err;
          throw Object.assign(new Error(`dataforseo: the call was sent but its cost could not be recorded (${String(err.message).slice(0, 120)}); its reservation of ${usd(est)} stays in the ledger and counts as spent`), { cause: err });
        }
        open = false;
        if (cost != null) account.spent = round(account.spent + cost);
      };
      let json;
      try {
        let balance;
        try { balance = await readBalance(); }
        catch (err) { finish(null); return await block("balance-unavailable", `the account balance could not be read (${String(err.message).slice(0, 80)}), so no paid call is made.`, { cause: err.message }); }
        if (balance - verdict.others - est < floor) {
          finish(null);
          return await block("min-balance", `the account balance ${usd(balance)} would fall under the floor of ${usd(floor)}.`, { balance, estimate: est, floor });
        }
        let r;
        sent = true;
        try { r = await f(`${BASE}${path}`, { method: "POST", headers: { Authorization: authHeader(env), "Content-Type": "application/json" }, body: JSON.stringify(list), signal: AbortSignal.timeout(TIMEOUT_MS) }); }
        catch (err) {
          // DataForSEO may have received (and billed) the request before it timed out or the connection dropped: count the estimate.
          finish(est, true);
          throw new Error(`dataforseo: request failed (${err.name || "error"}); it may have been charged, so its estimate ${usd(est)} was recorded`);
        }
        // The response's own cost when it gives a valid one, on any status. Without one: $0 for a refused key or a rate limit (not a
        // call), otherwise the estimate, flagged (a 5xx or a gateway page may have been billed).
        json = await r.json().catch(() => null);
        const real = costOf(json);
        if (real != null) finish(real > 0 || r.ok ? real : null, false);
        else if (!r.ok && UNBILLED_STATUS.has(r.status)) finish(null);
        else finish(est, true);
        if (!r.ok) throw Object.assign(new Error(`dataforseo: HTTP ${r.status}${r.status === 429 ? " (rate limited)" : r.status === 401 || r.status === 403 ? " (key rejected)" : ""}`), { status: r.status, body: json });
      } finally {
        if (open && !sent) try { update((l) => { if (l.reserved) delete l.reserved[id]; }); } catch { /* left for settleStale */ }
      }
      return json;
    },
    /** `post` for one task: returns { json, task, items } with the task status already checked (a non-20000 task throws). */
    async task(path, task, opts) {
      const json = await guard.post(path, [task], opts);
      const t = json?.tasks?.[0];
      if (t && t.status_code && t.status_code !== 20000) throw new Error(`dataforseo: task status ${t.status_code}`);
      return { json, task: t, items: t?.result?.[0]?.items || [], result: t?.result?.[0] || null };
    },
  };
  return guard;
}

/**
 * The guard for one job run on one site: an injected one (tests, `deps.guard`) or a real one that keeps its ledger in the
 * site's state folder and alerts through TELEGRAM_* when it blocks. Every guard over that folder shares the cap.
 */
export function costGuardFor(site, job, { env = process.env, fetch: f = globalThis.fetch, guard, notify, now } = {}) {
  if (guard) return guard;
  let host = site.id || "";
  try { host = new URL(site.url).hostname.replace(/^www\./, ""); } catch { /* keep the id */ }
  return createCostGuard({ cfg: site.dataforseo || {}, job, env, fetch: f, ledger: fileLedger(ledgerFile(site)), label: host, notify, now });
}

/** The error a DataForSEO caller gets when it was not given a guard. Callers must pass one: there is no unguarded path. */
export function requireGuard(guard, who = "dataforseo") {
  if (!guard || typeof guard.post !== "function") throw new BudgetError(`${who}: no cost guard given. Every DataForSEO call goes through createCostGuard / costGuardFor (src/lib/dataforseo.mjs); nothing is called without one.`, "no-guard");
  return guard;
}

/** Plain-text summary of a month in the ledger for reports: "2026-11: $0.42 in 9 calls (rank $0.30, keywords $0.12)". */
export function ledgerSummary(ledger, month) {
  const m = ledger.months?.[month];
  if (!m) return `${month}: $0.00 in 0 calls`;
  const jobs = Object.entries(m.jobs || {}).map(([j, v]) => `${j} ${usd(v.usd)}`).join(", ");
  return `${month}: ${usd(m.usd)} in ${m.calls} calls${jobs ? ` (${jobs})` : ""}`;
}
