// Review R3 of the DataForSEO cost guard: each test here reproduces one way R3 broke the guard at a5d2d1a and fails there.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BudgetError, createCostGuard, memoryLedger, fileLedger, estimateCost } from "../src/lib/dataforseo.mjs";
import { sendTelegram } from "../src/lib/notify.mjs";
import { writeJson } from "../src/core/util.mjs";
import { DFS_ENV } from "./dfs-fixtures.mjs";

const NOW = () => new Date("2026-11-26T10:00:00Z");
const M = "2026-11";
const SERP = "serp/google/organic/live/advanced";
const LABS = "dataforseo_labs/google/keyword_ideas/live";
const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (p = "seo-r3-") => mkdtempSync(join(tmpdir(), p));
const quiet = async () => ({ sent: false });

/** Balance endpoint plus paid POSTs; remembers every request. */
function fake({ balance = () => 100, cost = () => 0.004, delay = 0, throwPaid = false } = {}) {
  const reqs = [];
  const f = async (url, init = {}) => {
    reqs.push({ url: String(url), method: init.method || "GET" });
    if (String(url).endsWith("/appendix/user_data")) return jsonRes({ tasks: [{ status_code: 20000, result: [{ money: { balance: balance() } }] }] });
    if (delay) await sleep(delay);
    if (throwPaid) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const c = cost();
    return jsonRes({ status_code: 20000, cost: c, tasks: [{ status_code: 20000, cost: c, result: [{ items: [] }] }] });
  };
  f.reqs = reqs;
  f.paid = () => reqs.filter((r) => r.method === "POST").length;
  f.free = () => reqs.filter((r) => r.method === "GET").length;
  return f;
}
const seeded = (usd, extra = {}) => ({ version: 1, months: { [M]: { usd, calls: 1, jobs: {}, ...extra } } });

// ---- 1. a paid call that times out or drops ------------------------------------------------------------------------------------
test("R3-1: a paid call that times out is recorded at its estimate (flagged), lowers the cached balance, and the cap stops a run of them", async () => {
  const f = fake({ throwPaid: true }), ledger = memoryLedger();
  const g = createCostGuard({ cfg: { monthlyCapUsd: 0.05, minBalanceUsd: 10 }, env: DFS_ENV, fetch: f, ledger, notify: quiet, now: NOW });
  const est = estimateCost(SERP, { depth: 20 });
  let refused = null;
  for (let i = 0; i < 50 && !refused; i++) {
    try { await g.post(SERP, { depth: 20 }); assert.fail("a timed-out call must throw"); }
    catch (e) { if (e instanceof BudgetError) refused = e; else assert.match(e.message, /request failed \(TimeoutError\)/); }
  }
  assert.equal(refused?.reason, "monthly-cap", "the cap trips on recorded timeouts");
  assert.equal(f.paid(), Math.floor(0.05 / est), "no more paid requests than the cap allows");
  const m = ledger.data.months[M];
  assert.equal(m.calls, f.paid());
  assert.equal(m.estimatedCalls, f.paid(), "each one is flagged as an estimate");
  assert.ok(Math.abs(m.usd - est * f.paid()) < 1e-9);
  assert.ok(Math.abs((await g.balance()) - (100 - est * f.paid())) < 1e-9, "the cached balance went down too");
  assert.equal(f.free(), 1);
});

// ---- 2. state restore ----------------------------------------------------------------------------------------------------------
test("R3-2: state restore starts fresh only when the branch is missing (ls-remote exit 2); an unreachable origin fails", async () => {
  const { restore } = await import("../src/cli/state.mjs");
  const repo = tmp(), bare = tmp("seo-r3-bare-");
  const git = (cwd, ...a) => { const r = spawnSync("git", a, { cwd, encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); };
  git(bare, "init", "-q", "--bare");
  git(repo, "init", "-q");
  writeFileSync(join(repo, "seo-autopilot.config.json"), JSON.stringify({ sites: [{ id: "s", url: "https://s.test/", searchConsoleProperty: "sc-domain:s.test", sitemap: "https://s.test/sitemap.xml" }] }));
  git(repo, "remote", "add", "origin", bare);
  const log = console.log; let out = "";
  console.log = (x) => { out += `${x}\n`; };
  try { restore({ cwd: repo }); } finally { console.log = log; }
  assert.match(out, /no "seo-data" branch yet/);
  git(repo, "remote", "set-url", "origin", join(bare, "does-not-exist"));
  console.log = () => {};
  try { assert.throws(() => restore({ cwd: repo }), /could not (reach|read)/i); } finally { console.log = log; }
});

// ---- 3. unknown endpoints and input sizes --------------------------------------------------------------------------------------
test("R3-3: an unknown endpoint is refused with no request unless the caller passes estimateUsd; the explicit estimate counts against the cap", async () => {
  assert.equal(estimateCost("on_page/task_post", { target: "x.test" }), null, "no guess for an unknown endpoint");
  const f = fake({ cost: () => 0.3 }), ledger = memoryLedger();
  const g = createCostGuard({ cfg: { monthlyCapUsd: 1 }, env: DFS_ENV, fetch: f, ledger, notify: quiet, now: NOW });
  await assert.rejects(() => g.post("on_page/task_post", { target: "x.test" }), (e) => e instanceof BudgetError && e.reason === "no-estimate");
  assert.equal(f.reqs.length, 0);
  for (const bad of [0, -1, NaN, "0.5", Infinity, null]) {
    await assert.rejects(() => g.post("ai_optimization/llm_responses/live", { prompt: "p" }, { estimateUsd: bad }), (e) => e.reason === "no-estimate", `estimateUsd ${bad}`);
  }
  assert.equal(f.reqs.length, 0);
  const r = await g.task("ai_optimization/llm_responses/live", { prompt: "p" }, { estimateUsd: 0.6 });
  assert.equal(r.task.cost, 0.3);
  assert.equal(ledger.data.months[M].usd, 0.3);
  await assert.rejects(() => g.post("ai_optimization/llm_responses/live", { prompt: "p" }, { estimateUsd: 0.75 }), (e) => e.reason === "monthly-cap", "0.3 spent + 0.75 > 1");
  assert.equal(f.paid(), 1);
  assert.ok(estimateCost(SERP, { depth: 20 }) > 0);
  const known = createCostGuard({ cfg: { monthlyCapUsd: 0.05 }, env: DFS_ENV, fetch: fake(), ledger: memoryLedger(), notify: quiet, now: NOW });
  await assert.rejects(() => known.post(SERP, { depth: 10 }, { estimateUsd: 0.06 }), (e) => e.reason === "monthly-cap", "a known endpoint uses the higher of the table and the caller's estimate");
});

test("R3-3: a leading slash or /v3/ is the same endpoint; input arrays are counted; non-positive limit or depth is refused", async () => {
  const P = "dataforseo_labs/google/ranked_keywords/live";
  assert.equal(estimateCost(`/${P}`, { limit: 1000 }), estimateCost(P, { limit: 1000 }));
  assert.equal(estimateCost(`/v3/${P}`, { limit: 1000 }), estimateCost(P, { limit: 1000 }));
  // Labs: $0.012 per task + $0.00012 per item (pricing page); 700 keywords give 700 items.
  assert.ok(estimateCost("dataforseo_labs/google/keyword_overview/live", { keywords: Array(700).fill("k") }) >= 0.012 + 0.00012 * 700);
  assert.ok(estimateCost("dataforseo_labs/google/bulk_keyword_difficulty/live", { keywords: Array(1000).fill("k") }) >= 0.012 + 0.00012 * 1000);
  assert.ok(estimateCost("backlinks/bulk_ranks/live", { targets: Array(1000).fill("a.test") }) > estimateCost("backlinks/bulk_ranks/live", { targets: ["a.test"] }));
  for (const t of [{ depth: -7 }, { depth: 0 }, { limit: -5000 }, { limit: "x" }, { limit: NaN }]) assert.equal(estimateCost(t.depth != null ? SERP : P, t), null, JSON.stringify(t));
  const f = fake(), ledger = memoryLedger(seeded(7.99));
  const g = createCostGuard({ cfg: { monthlyCapUsd: 8 }, env: DFS_ENV, fetch: f, ledger, notify: quiet, now: NOW });
  await assert.rejects(() => g.post(P, { limit: -5000 }), (e) => e.reason === "no-estimate");
  await assert.rejects(() => g.post(SERP, { depth: -7 }), (e) => e.reason === "no-estimate");
  assert.equal(f.reqs.length, 0);
  assert.equal(ledger.data.months[M].usd, 7.99, "the ledger never goes down");
  const ok = createCostGuard({ cfg: {}, env: DFS_ENV, fetch: f, ledger: memoryLedger(), notify: quiet, now: NOW });
  await ok.post(`/${P}`, { limit: 10 });
  assert.equal(f.reqs.at(-1).url, `https://api.dataforseo.com/v3/${P}`);
});

// ---- 4. balance cache ----------------------------------------------------------------------------------------------------------
test("R3-4: the balance is cached for 60 seconds at most, so another program's spending is seen within a minute", async () => {
  let real = 20, t = Date.parse("2026-11-26T10:00:00Z");
  const f = fake({ balance: () => real, cost: () => { real -= 0.004; return 0.004; } });
  const g = createCostGuard({ cfg: { monthlyCapUsd: 8, minBalanceUsd: 10 }, env: DFS_ENV, fetch: f, ledger: memoryLedger(), notify: quiet, now: () => new Date(t) });
  await g.post(SERP, { depth: 20 });
  t += 59 * 1000; await g.post(SERP, { depth: 20 });
  assert.equal(f.free(), 1, "within 60 seconds: one read");
  real -= 12; t += 2 * 1000;
  await assert.rejects(() => g.post(SERP, { depth: 20 }), (e) => e.reason === "min-balance");
  assert.equal(f.free(), 2);
  assert.equal(f.paid(), 2);
});

// ---- 5. the alert's stale save -------------------------------------------------------------------------------------------------
test("R3-5: a refusal's alert never overwrites spend recorded while the alert was being sent", async () => {
  const file = join(tmp(), "dataforseo-ledger.json");
  const f = fake({ cost: () => 0.004, delay: 10 });
  const notify = async () => { await sleep(50); return { sent: true, messageId: 1 }; };
  const g = createCostGuard({ cfg: { monthlyCapUsd: 0.05, minBalanceUsd: 10 }, env: DFS_ENV, fetch: f, ledger: fileLedger(file), notify, now: NOW });
  const a = g.post(SERP, { depth: 20 });
  await sleep(1);
  const b = g.post(LABS, { limit: 100 }).catch((e) => e.reason);
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra.cost, 0.004);
  assert.equal(rb, "monthly-cap");
  const disk = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(disk.months[M]?.usd, 0.004, "call A's cost is still in the ledger");
  assert.equal(disk.months[M].calls, 1);
});

// ---- 6. one ledger, many guards ------------------------------------------------------------------------------------------------
test("R3-6: two guards over one ledger file in parallel see each other's reservation (cap allows one call)", async () => {
  const file = join(tmp(), "l.json"), f = fake({ cost: () => 0.04, delay: 20 });
  const mk = (job) => createCostGuard({ cfg: { monthlyCapUsd: 0.05, minBalanceUsd: 10 }, job, env: DFS_ENV, fetch: f, ledger: fileLedger(file), notify: quiet, now: NOW });
  const out = await Promise.allSettled([mk("a").post(LABS, { limit: 100 }), mk("b").post(LABS, { limit: 100 })]);
  assert.deepEqual(out.map((o) => o.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(out.find((o) => o.status === "rejected").reason.reason, "monthly-cap");
  assert.equal(f.paid(), 1);
  const disk = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(disk.months[M].usd, 0.04);
  assert.deepEqual(disk.reserved || {}, {}, "no reservation is left behind");
});

test("R3-6: two processes over one ledger file at the same moment: only one paid call (cap allows one)", async () => {
  const dir = tmp(), file = join(dir, "dataforseo-ledger.json");
  const mod = pathToFileURL(join(import.meta.dirname, "..", "src", "lib", "dataforseo.mjs")).href;
  const start = Date.now() + 700;
  const child = [
    `const { createCostGuard, fileLedger } = await import(${JSON.stringify(mod)});`,
    `let paid = 0;`,
    `const res = (b) => ({ ok: true, status: 200, json: async () => b });`,
    `const f = async (u, i = {}) => { if (String(u).endsWith("user_data")) return res({ tasks: [{ result: [{ money: { balance: 100 } }] }] }); paid++; await new Promise((r) => setTimeout(r, 300)); return res({ cost: 0.04, tasks: [{ status_code: 20000, cost: 0.04, result: [{ items: [] }] }] }); };`,
    `const g = createCostGuard({ cfg: { monthlyCapUsd: 0.05, minBalanceUsd: 10 }, job: process.argv[1], env: { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" }, fetch: f, ledger: fileLedger(${JSON.stringify(file)}), notify: async () => ({ sent: false }), now: () => new Date("2026-11-26T10:00:00Z") });`,
    `while (Date.now() < ${start}) await new Promise((r) => setTimeout(r, 1));`,
    `let result; try { await g.post("dataforseo_labs/google/keyword_ideas/live", { limit: 100 }); result = "ok"; } catch (e) { result = e.reason || e.message; }`,
    `console.log(JSON.stringify({ paid, result }));`,
  ].join("\n");
  const run = (job) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", child, job], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => (code === 0 ? resolve(JSON.parse(out.trim().split("\n").pop())) : reject(new Error(err))));
  });
  const [a, b] = await Promise.all([run("a"), run("b")]);
  assert.equal(a.paid + b.paid, 1, JSON.stringify([a, b]));
  assert.deepEqual([a.result, b.result].sort(), ["monthly-cap", "ok"]);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).months[M].usd, 0.04);
  assert.ok(!existsSync(`${file}.lock`), "the lock is released");
});

test("R3-6: a reservation left by a run that died mid-call is counted as spent (estimated) once it is stale", async () => {
  const ledger = memoryLedger({ version: 1, months: { [M]: { usd: 1, calls: 1, jobs: {} } }, reserved: { dead: { usd: 0.5, at: Date.parse("2026-11-26T09:00:00Z"), job: "rank", endpoint: SERP }, live: { usd: 0.2, at: Date.parse("2026-11-26T09:59:50Z"), job: "gap", endpoint: LABS } } });
  const f = fake();
  const g = createCostGuard({ cfg: { monthlyCapUsd: 1.7 }, env: DFS_ENV, fetch: f, ledger, notify: quiet, now: NOW });
  await assert.rejects(() => g.post(LABS, { limit: 100 }), (e) => e.reason === "monthly-cap", "1 + 0.5 (stale, now spent) + 0.2 (in flight) + 0.04 > 1.7");
  const m = ledger.data.months[M];
  assert.equal(m.usd, 1.5);
  assert.equal(m.estimatedCalls, 1);
  assert.deepEqual(Object.keys(ledger.data.reserved), ["live"]);
});

// ---- 7. alerts in CI, and saved state ------------------------------------------------------------------------------------------
const WF = join(import.meta.dirname, "..", "templates", "workflows");
const workflows = readdirSync(WF).filter((n) => n.endsWith(".yml")).map((n) => [n, readFileSync(join(WF, n), "utf8").replace(/\r\n/g, "\n")]);
const stepsOf = (t) => t.split(/\n(?=\s+- (?:name|uses):)/);

test("R3-7: every workflow step that has DataForSEO credentials also gets the Telegram alert variables", () => {
  let n = 0;
  for (const [name, t] of workflows) for (const step of stepsOf(t)) {
    if (!/DATAFORSEO_LOGIN:/.test(step)) continue;
    n++;
    for (const v of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_THREAD_ID"]) assert.match(step, new RegExp(`\\n\\s+${v}: \\$\\{\\{`), `${name}: ${step.match(/- name: (.*)/)?.[1]} lacks ${v}`);
    assert.match(step, /TELEGRAM_BOT_TOKEN: \$\{\{ secrets\.TELEGRAM_BOT_TOKEN \}\}/, "the bot token comes from a secret");
  }
  assert.ok(n >= 5, `found ${n} DataForSEO steps`);
});

test("R3-2: every workflow that saves state saves it even after a failed or cancelled step, but only when the restore worked", () => {
  let n = 0;
  for (const [name, t] of workflows) {
    const saves = stepsOf(t).filter((s) => /\n\s+run: npx --yes "\$SEO" state save\s*$/.test(s));
    if (!saves.length) continue;
    n += saves.length;
    assert.match(t, /- name: [^\n]+\n\s+id: restore\n\s+run: npx --yes "\$SEO" state restore\n/, `${name}: the restore step has id "restore"`);
    for (const s of saves) assert.match(s, /\n\s+if: always\(\) && steps\.restore\.outcome == 'success'\n/, `${name}: ${s.match(/- name: (.*)/)?.[1]}`);
  }
  assert.ok(n >= 5, `found ${n} save steps`);
});

// ---- 8. validation -------------------------------------------------------------------------------------------------------------
test("R3-8: createCostGuard refuses a cap or floor that is not a number of dollars, 0 or more", () => {
  for (const cfg of [{ monthlyCapUsd: "abc" }, { monthlyCapUsd: "8" }, { minBalanceUsd: "ten" }, { monthlyCapUsd: NaN }, { monthlyCapUsd: null }, { monthlyCapUsd: -1 }, { minBalanceUsd: Infinity }, { monthlyCapUsd: true }, "8", []]) {
    assert.throws(() => createCostGuard({ cfg, env: DFS_ENV, fetch: fake(), ledger: memoryLedger(), notify: quiet }), (e) => e instanceof BudgetError && e.reason === "invalid-config", JSON.stringify(cfg));
  }
  for (const cfg of [{}, { monthlyCapUsd: 0 }, { monthlyCapUsd: 3, minBalanceUsd: 0 }, undefined]) createCostGuard({ cfg, env: DFS_ENV, fetch: fake(), ledger: memoryLedger(), notify: quiet });
});

test("R3-8: a corrupt, empty or mistyped ledger refuses with no request, alerts once a day, and is left as it was", async () => {
  const cases = [["truncated", '{"version":1,"months":{"2026-11":{"usd":7.9'], ["{}", "{}"], ["[]", "[]"], ["usd as string", JSON.stringify(seeded("7.99"))], ["usd null", JSON.stringify(seeded(null))], ["calls negative", JSON.stringify({ version: 1, months: { [M]: { usd: 1, calls: -1, jobs: {} } } })], ["months array", JSON.stringify({ version: 1, months: [] })]];
  for (const [name, content] of cases) {
    const file = join(tmp(), "dataforseo-ledger.json");
    writeFileSync(file, content);
    let alerts = 0;
    const mk = () => createCostGuard({ cfg: { monthlyCapUsd: 8 }, env: DFS_ENV, fetch: f, ledger: fileLedger(file), notify: async () => { alerts++; return { sent: true }; }, now: NOW });
    const f = fake();
    await assert.rejects(() => mk().post(LABS, { limit: 100 }), (e) => e instanceof BudgetError && e.reason === "ledger-invalid", name);
    await assert.rejects(() => mk().post(LABS, { limit: 100 }), (e) => e.reason === "ledger-invalid", name);
    assert.equal(f.reqs.length, 0, name);
    assert.equal(alerts, 1, `${name}: one alert, remembered for the day`);
    assert.equal(readFileSync(file, "utf8"), content, `${name}: the file is evidence, never rewritten`);
  }
  const missing = join(tmp(), "none.json"), f = fake();
  await createCostGuard({ cfg: {}, env: DFS_ENV, fetch: f, ledger: fileLedger(missing), notify: quiet, now: NOW }).post(LABS, { limit: 100 });
  assert.equal(f.paid(), 1, "no file yet is a fresh ledger");
});

test("R3-8: the balance must be a JSON number; a string, array, boolean or null is unreadable", async () => {
  for (const balance of ["50", [50], true, null]) {
    let posted = 0;
    const f = async (u, i = {}) => { if (i.method === "POST") posted++; return String(u).endsWith("user_data") ? jsonRes({ tasks: [{ result: [{ money: { balance } }] }] }) : jsonRes({ cost: 0.01, tasks: [] }); };
    const g = createCostGuard({ cfg: {}, env: DFS_ENV, fetch: f, ledger: memoryLedger(), notify: quiet, now: NOW });
    await assert.rejects(() => g.post(LABS, { limit: 100 }), (e) => e.reason === "balance-unavailable", JSON.stringify(balance));
    assert.equal(posted, 0);
  }
});

test("R3-8: writeJson replaces the file in one step (temp file + rename), so a reader never sees half a file", { skip: process.platform === "win32" }, () => {
  const dir = tmp(), file = join(dir, "l.json");
  writeJson(file, { a: 1 });
  chmodSync(file, 0o444); // a write in place fails on a read-only file; a rename over it does not
  writeJson(file, { a: 2 });
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { a: 2 });
  assert.deepEqual(readdirSync(dir), ["l.json"], "no temp file left behind");
});

test("R3-8: a Telegram error that echoes the bot URL never returns the token", async () => {
  const env = { TELEGRAM_BOT_TOKEN: "123:SECRETTOKEN", TELEGRAM_CHAT_ID: "4242" };
  const r = await sendTelegram("hi", { env, fetch: async (u) => jsonRes({ ok: false, description: `Unauthorized ${u}` }, 401) });
  assert.equal(r.sent, false);
  assert.ok(!r.reason.includes("SECRETTOKEN"), r.reason);
});

// ---- 9. nothing else talks to DataForSEO ---------------------------------------------------------------------------------------
const ROOT = join(import.meta.dirname, "..");
const SCAN_DIRS = ["src", "bin", "scripts", "engines", "skills"];
const SKIP = /(^|\/)(node_modules|\.venv|venv|__pycache__|\.git|dist|build|target)(\/|$)/;
const GUARD = "src/lib/dataforseo.mjs";
// Files that may name DataForSEO, each checked to reach it only through the guard. A new one must be reviewed and added here.
const MAY_NAME = new Set([GUARD, "src/lib/budget-defaults.mjs", "src/lib/serp.mjs", "src/lib/research-sources.mjs", "src/core/config.mjs", "src/cli/doctor.mjs", "src/jobs/authority.mjs", "src/jobs/citations.mjs", "src/jobs/gap.mjs", "src/jobs/keywords.mjs", "src/jobs/optimize.mjs", "src/jobs/rank.mjs", "src/lib/notify.mjs", "src/lib/market.mjs", "src/cli/init.mjs", "src/cli/state.mjs", "src/analysis/authority.mjs", "src/lib/ai-engines.mjs", "src/lib/aeo-config.mjs", "src/jobs/aeo.mjs", "src/jobs/ai-visibility.mjs"]);
/** Problems in one file: the API host (however it is spelled) outside the guard, an unreviewed file naming DataForSEO, test hooks in product code. */
function scanProblems(rel, text) {
  const out = [];
  if (rel !== GUARD && /(?<![a-z0-9])api[^a-z0-9]{1,8}dataforseo[^a-z0-9]{1,8}com(?![a-z0-9])/i.test(text)) out.push(`${rel}: the DataForSEO API host`);
  if (/dataforseo/i.test(text) && !MAY_NAME.has(rel)) out.push(`${rel}: names DataForSEO but is not in the reviewed list`);
  if (rel !== GUARD && /\b(memoryLedger|getBalance)\b/.test(text)) out.push(`${rel}: memoryLedger/getBalance are for tests only`);
  return out;
}
function scanTree() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const n of readdirSync(dir)) {
      const p = join(dir, n), rel = p.slice(ROOT.length + 1).split("\\").join("/");
      if (SKIP.test(rel)) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (statSync(p).size < 2e6) out.push(...scanProblems(rel, readFileSync(p, "latin1")));
    }
  };
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  return out;
}

test("R3-9: only the guard module talks to DataForSEO, in every file type under src, bin, scripts, engines and skills", () => {
  assert.deepEqual(scanTree(), []);
});

test("R3-9: the scan catches R3's bypasses", () => {
  assert.ok(scanProblems("src/lib/new.mjs", 'const host = ["api","dataforseo","com"].join(".");').length);
  assert.ok(scanProblems("src/lib/serp.mjs", 'const host = ["api","dataforseo","com"].join(".");').length, "also inside a reviewed file");
  assert.ok(scanProblems("src/lib/x.js", 'fetch("https://api.dataforseo.com/v3/serp")').length, "any file type");
  assert.ok(scanProblems("engines/python/x.py", 'URL = "https://API.DataForSEO.com/v3/"').length);
  assert.ok(scanProblems("src/jobs/rank.mjs", "import { memoryLedger } from '../lib/dataforseo.mjs'").length);
  assert.ok(scanProblems("scripts/x.mjs", "createCostGuard({ getBalance: async () => 1e9 })").length);
  assert.deepEqual(scanProblems("src/jobs/rank.mjs", "import { costGuardFor } from '../lib/dataforseo.mjs'"), []);
  assert.deepEqual(scanProblems("src/lib/serp.mjs", "[brave, serpapi, dataforseo]; sign up at https://dataforseo.com/"), [], "the product name and its website are fine");
  assert.ok(scanProblems("src/lib/serp.mjs", 'const u = "https://" + "api." + "dataforseo.com";').length);
});
