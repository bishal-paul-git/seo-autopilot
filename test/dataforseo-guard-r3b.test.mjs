// Re-check R3b of the DataForSEO cost guard (after 2e22928): each test reproduces one way R3b broke the guard and fails there.
// (B, an HTTP 5xx with no readable cost, is in test/dataforseo-guard.test.mjs next to the other HTTP-error cases.)
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BudgetError, createCostGuard, memoryLedger, fileLedger, estimateCost, costOf } from "../src/lib/dataforseo.mjs";
import { DFS_ENV } from "./dfs-fixtures.mjs";

const NOW = () => new Date("2026-11-26T10:00:00Z");
const M = "2026-11";
const SERP = "serp/google/organic/live/advanced";
const LABS = "dataforseo_labs/google/keyword_ideas/live";
const MOD = pathToFileURL(join(import.meta.dirname, "..", "src", "lib", "dataforseo.mjs")).href;
const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const costRes = (c) => jsonRes({ status_code: 20000, cost: c, tasks: [{ status_code: 20000, cost: c, result: [{ items: [] }] }] });
const quiet = async () => ({ sent: false });
const tmp = (p = "seo-r3b-") => mkdtempSync(join(tmpdir(), p));

function fake({ balance = () => 100, paid = () => costRes(0.004) } = {}) {
  const reqs = [];
  const f = async (url, init = {}) => {
    reqs.push({ url: new URL(String(url)).href, method: init.method || "GET" });
    if (String(url).endsWith("/appendix/user_data")) return jsonRes({ tasks: [{ status_code: 20000, result: [{ money: { balance: balance() } }] }] });
    return paid();
  };
  f.reqs = reqs;
  f.paid = () => reqs.filter((r) => r.method === "POST").length;
  return f;
}
const seeded = (usd) => memoryLedger({ version: 1, months: { [M]: { usd, calls: 1, jobs: {} } } });

test("R3b-A: a path with .., ., an encoded dot or any character outside [a-z0-9_/] is refused with no request", async () => {
  const f = fake({ paid: () => costRes(12.5) }), ledger = seeded(7.9);
  const g = createCostGuard({ cfg: { monthlyCapUsd: 8 }, env: DFS_ENV, fetch: f, ledger, notify: quiet, now: NOW });
  for (const p of ["serp/../on_page/task_post", "serp/%2e%2e/on_page/task_post", "dataforseo_labs/./../on_page/task_post", "serp\\..\\on_page/task_post", "serp//google/organic/live/advanced", "serp/google/organic/live/advanced?x=1", "SERP/google/organic/live/advanced", "serp/google/organic/live/advanced/", "", "/"]) {
    assert.equal(estimateCost(p, { depth: 10 }), null, p);
    await assert.rejects(() => g.post(p, { depth: 10 }), (e) => e instanceof BudgetError && e.reason === "bad-path", p);
    await assert.rejects(() => g.post(p, { depth: 10 }, { estimateUsd: 1 }), (e) => e.reason === "bad-path", `${p} with estimateUsd`);
  }
  assert.equal(f.reqs.length, 0);
  assert.equal(ledger.data.months[M].usd, 7.9);
  for (const p of [`/${SERP}`, `/v3/${SERP}`, `v3/${SERP}`]) assert.equal(estimateCost(p, { depth: 10 }), estimateCost(SERP, { depth: 10 }), p);
});

test("R3b-C: once a request was sent, a failure to record its cost leaves the reservation in place (counted, later settled as spend)", async () => {
  const inner = memoryLedger();
  let n = 0;
  const flaky = { load: inner.load, alerts: inner.alerts, update: (fn) => { n++; if (n === 2) throw Object.assign(new Error("the ledger is locked by another run"), { code: "LEDGER_LOCKED" }); return inner.update(fn); } };
  const f = fake({ paid: () => costRes(0.6) });
  const g = createCostGuard({ cfg: { monthlyCapUsd: 1 }, env: DFS_ENV, fetch: f, ledger: flaky, notify: quiet, now: NOW });
  await assert.rejects(() => g.post("ai_optimization/x/live", { p: 1 }, { estimateUsd: 0.7 }), /locked/);
  assert.equal(f.paid(), 1);
  const left = Object.values(inner.data.reserved);
  assert.equal(left.length, 1, "the reservation stays");
  assert.equal(left[0].usd, 0.7);
  await assert.rejects(() => g.post("ai_optimization/x/live", { p: 1 }, { estimateUsd: 0.7 }), (e) => e.reason === "monthly-cap", "0.7 in flight + 0.7 > 1");
  assert.equal(f.paid(), 1);
  // A request that was never sent (balance refused) still releases its reservation.
  const l2 = memoryLedger();
  const g2 = createCostGuard({ cfg: { minBalanceUsd: 10 }, env: DFS_ENV, fetch: fake({ balance: () => 5 }), ledger: l2, notify: quiet, now: NOW });
  await assert.rejects(() => g2.post(LABS, { limit: 10 }), (e) => e.reason === "min-balance");
  assert.deepEqual(l2.data.reserved, {});
});

// ---- D. the lock ---------------------------------------------------------------------------------------------------------------
const childSrc = (file, startAt, holdMs, pre = "") => [
  pre,
  `const { fileLedger } = await import(${JSON.stringify(MOD)});`,
  `while (Date.now() < ${startAt}) {}`,
  `fileLedger(${JSON.stringify(file)}).update((l) => { const m = (l.months["${M}"] ||= { usd: 0, calls: 0, jobs: {} }); const c = m.calls; const t = Date.now(); while (Date.now() - t < ${holdMs}) {} m.calls = c + 1; m.usd = Math.round((m.usd + 0.5) * 1e6) / 1e6; });`,
].join("\n");
const runChild = (src) => new Promise((ok, bad) => {
  const p = spawn(process.execPath, ["--input-type=module", "-e", src], { stdio: ["ignore", "pipe", "pipe"] });
  let e = "";
  p.stderr.on("data", (d) => { e += d; });
  p.on("close", (c) => (c === 0 ? ok() : bad(new Error(e.slice(0, 400)))));
});
const staleLedger = () => {
  const file = join(tmp("seo-r3b-lock-"), "dataforseo-ledger.json");
  writeFileSync(file, JSON.stringify({ version: 1, months: { [M]: { usd: 0, calls: 0, jobs: {} } }, reserved: {} }));
  writeFileSync(`${file}.lock`, "");
  const old = (Date.now() - 60_000) / 1000;
  utimesSync(`${file}.lock`, old, old); // left by a killed run
  return file;
};

test("R3b-D: taking over a stale lock never lets two processes in: a process paused between stat and takeover does not steal a live lock", { skip: process.platform === "win32" }, async () => {
  const file = staleLedger(), startAt = Date.now() + 1200;
  // B stats the stale lock, then is descheduled for 300 ms; meanwhile A takes the stale lock over and holds a fresh one.
  const slowStat = [`import module from "node:module"; import fs from "node:fs";`, `const real = fs.statSync; let once = true; fs.statSync = (...a) => { const s = real(...a); if (once && String(a[0]).endsWith(".lock")) { once = false; const t = Date.now(); while (Date.now() - t < 300) {} } return s; }; module.syncBuiltinESMExports();`].join("\n");
  await Promise.all([runChild(childSrc(file, startAt, 1000, slowStat)), runChild(childSrc(file, startAt + 100, 1000))]);
  const m = JSON.parse(readFileSync(file, "utf8")).months[M];
  assert.deepEqual({ calls: m.calls, usd: m.usd }, { calls: 2, usd: 1 });
});

test("R3b-D: six processes racing over a stale lock lose no update", { skip: process.platform === "win32" }, async () => {
  const file = staleLedger(), startAt = Date.now() + 1200;
  await Promise.all(Array.from({ length: 6 }, () => runChild(childSrc(file, startAt, 100))));
  const m = JSON.parse(readFileSync(file, "utf8")).months[M];
  assert.deepEqual({ calls: m.calls, usd: m.usd }, { calls: 6, usd: 3 });
});

test("R3b-D: the lock holds the holder's token, and a holder whose lock was taken never writes", () => {
  const file = join(tmp(), "l.json");
  const ledger = fileLedger(file);
  ledger.update((l) => {
    const t = readFileSync(`${file}.lock`, "utf8");
    assert.match(t, /^\d+-[0-9a-f-]{36}$/, "a random token in the lock file");
    l.months[M] = { usd: 1, calls: 1, jobs: {} };
  });
  assert.throws(() => ledger.update((l) => {
    writeFileSync(`${file}.lock`, "someone-else"); // another process took the lock over meanwhile
    l.months[M].usd = 99;
  }), (e) => e.code === "LEDGER_LOCKED");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).months[M].usd, 1, "nothing written");
  assert.equal(readFileSync(`${file}.lock`, "utf8"), "someone-else", "another holder's lock is never removed");
});

// ---- E. the cost a response reports -------------------------------------------------------------------------------------------
test("R3b-E: a cost that is not a finite number of 0 or more is not trusted: the estimate is recorded, flagged", async () => {
  for (const c of [-5, "", false, [], " ", "0.5", null, {}, Infinity]) assert.equal(costOf({ cost: c, tasks: [{ cost: 0.5 }] }), c === null ? 0.5 : null, JSON.stringify(c));
  assert.equal(costOf({ tasks: [{ cost: 0.25 }, { cost: -1 }] }), null, "one bad task cost spoils the sum");
  assert.equal(costOf({ cost: 0 }), 0);
  for (const c of [-5, "", false, [], " "]) {
    const l = seeded(7.99);
    const f = fake({ paid: () => jsonRes({ status_code: 20000, cost: c, tasks: [{ status_code: 20000, cost: 0.5, result: [{ items: [] }] }] }) });
    const g = createCostGuard({ cfg: { monthlyCapUsd: 8.1 }, env: DFS_ENV, fetch: f, ledger: l, notify: quiet, now: NOW });
    await g.post(SERP, { depth: 10 });
    const m = l.data.months[M];
    assert.equal(m.usd, Math.round((7.99 + estimateCost(SERP, { depth: 10 })) * 1e6) / 1e6, JSON.stringify(c));
    assert.equal(m.estimatedCalls, 1, JSON.stringify(c));
  }
});

// ---- F. tiny estimates --------------------------------------------------------------------------------------------------------
test("R3b-F: an estimate never rounds down to $0: a tiny estimateUsd is refused on a cap of 0, or at the cap", async () => {
  for (const [cap, seed] of [[0, 0], [8, 8]]) {
    const f = fake({ paid: () => costRes(0.5) });
    const g = createCostGuard({ cfg: { monthlyCapUsd: cap }, env: DFS_ENV, fetch: f, ledger: seed ? seeded(seed) : memoryLedger(), notify: quiet, now: NOW });
    await assert.rejects(() => g.post("ai_optimization/x/live", { p: 1 }, { estimateUsd: 1e-7 }), (e) => e.reason === "monthly-cap", `cap ${cap}`);
    assert.equal(f.paid(), 0);
  }
  const l = memoryLedger(), g = createCostGuard({ cfg: { monthlyCapUsd: 1 }, env: DFS_ENV, fetch: fake({ paid: () => jsonRes({}, 500) }), ledger: l, notify: quiet, now: NOW });
  await assert.rejects(() => g.post("ai_optimization/x/live", { p: 1 }, { estimateUsd: 1.0000004 - 1 }), /HTTP 500/);
  assert.equal(l.data.months[M].usd, 0.000001, "rounded up to the next millionth, never down");
  assert.equal(estimateCost(SERP, { depth: 10 }), 0.007, "float noise is not rounded up");
});

// ---- G. one ledger under two names --------------------------------------------------------------------------------------------
test("R3b-G: a ledger reached through a symlink is the same ledger, and the symlink stays a symlink", { skip: process.platform === "win32" }, async () => {
  const base = tmp(), dir = join(base, "real");
  mkdirSync(dir);
  const real = join(dir, "f.json"), link = join(base, "link.json");
  writeFileSync(real, JSON.stringify({ version: 1, months: {}, reserved: {} }));
  symlinkSync(real, link);
  const f = fake({ paid: () => costRes(0.04) });
  const mk = (file) => createCostGuard({ cfg: { monthlyCapUsd: 0.05 }, env: DFS_ENV, fetch: f, ledger: fileLedger(file), notify: quiet, now: NOW });
  await mk(link).post(LABS, { limit: 10 });
  await assert.rejects(() => mk(real).post(LABS, { limit: 10 }), (e) => e.reason === "monthly-cap");
  assert.equal(f.paid(), 1);
  assert.ok(lstatSync(link).isSymbolicLink());
  assert.equal(JSON.parse(readFileSync(real, "utf8")).months[M].usd, 0.04);
});

// ---- H. the floor is per account ----------------------------------------------------------------------------------------------
test("R3b-H: two sites on one account in one process: a cached balance includes the other site's spend", async () => {
  let real = 10.6;
  const t = Date.parse("2026-11-26T10:00:00Z");
  const site = (cost) => async (url) => {
    if (String(url).endsWith("user_data")) return jsonRes({ tasks: [{ result: [{ money: { balance: real } }] }] });
    real = Math.round((real - cost) * 1e6) / 1e6;
    return costRes(cost);
  };
  const env = { DATAFORSEO_LOGIN: "r3b-h-account", DATAFORSEO_PASSWORD: "p" };
  const fa = site(0.04), fb = site(0.55), aFile = join(tmp(), "a.json");
  const A = createCostGuard({ cfg: { minBalanceUsd: 10 }, env, fetch: fa, ledger: fileLedger(aFile), notify: quiet, now: () => new Date(t) });
  const B = createCostGuard({ cfg: { minBalanceUsd: 10 }, env, fetch: fb, ledger: fileLedger(join(tmp(), "b.json")), notify: quiet, now: () => new Date(t + 5000) });
  const A2 = createCostGuard({ cfg: { minBalanceUsd: 10 }, env, fetch: fa, ledger: fileLedger(aFile), notify: quiet, now: () => new Date(t + 10000) });
  await A.post(LABS, { limit: 100 });
  await B.post("ai_optimization/x/live", { p: 1 }, { estimateUsd: 0.55 });
  await assert.rejects(() => A2.post(LABS, { limit: 100 }), (e) => e.reason === "min-balance", "10.6 - 0.04 - 0.55 - 0.04 < 10");
  assert.equal(real, 10.01);
});

// ---- I. a ledger folder that cannot be written --------------------------------------------------------------------------------
test("R3b-I: a ledger folder that cannot be written is reported as such, not as an invalid ledger", { skip: process.platform === "win32" || process.getuid?.() === 0 }, async () => {
  const dir = tmp(), file = join(dir, "l.json");
  writeFileSync(file, JSON.stringify({ version: 1, months: { [M]: { usd: 1, calls: 1, jobs: {} } } }));
  chmodSync(dir, 0o555);
  const f = fake();
  try {
    await assert.rejects(() => createCostGuard({ cfg: {}, env: DFS_ENV, fetch: f, ledger: fileLedger(file), notify: quiet, now: NOW }).post(LABS, { limit: 10 }), (e) => e.reason === "ledger-unwritable" && /cannot be written/.test(e.message));
  } finally { chmodSync(dir, 0o755); }
  assert.equal(f.reqs.length, 0);
});
