// DataForSEO cost guard: monthly cap, balance floor, ledger maths, once-a-day alerts, and that nothing bypasses it.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetError, createCostGuard, memoryLedger, fileLedger, estimateCost, costOf, addToLedger, requireGuard, costGuardFor, ledgerFile, ledgerSummary } from "../src/lib/dataforseo.mjs";
import { escapeHtml, sendTelegram } from "../src/lib/notify.mjs";
import { dataforseo as serp } from "../src/lib/serp.mjs";
import { dataforseo as sources } from "../src/lib/research-sources.mjs";
import { validate, DEFAULTS } from "../src/core/config.mjs";
import { SA_AR, CONFIG } from "./market-fixtures.mjs";
import { DFS_ENV } from "./dfs-fixtures.mjs";

const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const LABS = "dataforseo_labs/google/keyword_ideas/live";
const TASK_OK = (cost, items = []) => ({ status_code: 20000, cost, result: [{ items }] });

/** A fetch that serves the free balance endpoint and paid POSTs, and remembers every request. */
function fakeDfs({ balance = 36.66, balanceStatus = 200, cost = 0.05, items = [] } = {}) {
  const requests = [];
  const f = async (url, init = {}) => {
    const u = String(url);
    requests.push({ url: u, method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null });
    if (u.endsWith("/appendix/user_data")) return jsonRes({ tasks: [{ status_code: 20000, result: [{ money: { balance } }] }] }, balanceStatus);
    return jsonRes({ status_code: 20000, cost, tasks: [TASK_OK(cost, items)] });
  };
  f.requests = requests;
  f.paid = () => requests.filter((r) => r.method === "POST");
  return f;
}

function setup({ cfg = {}, ledger = memoryLedger(), now = () => new Date("2026-11-26T10:00:00Z"), ...dfs } = {}) {
  const f = fakeDfs(dfs), alerts = [];
  const notify = async (text) => { alerts.push(text); return { sent: true, messageId: alerts.length }; };
  const guard = createCostGuard({ cfg, job: "keywords", env: DFS_ENV, fetch: f, ledger, label: "shop.test", notify, now });
  return { f, guard, alerts, ledger, now };
}

test("cap reached: the call is refused with no request, and one alert goes out", async () => {
  const seed = { version: 1, alerts: {}, months: { "2026-11": { usd: 7.99, calls: 3, jobs: {} } } };
  const { f, guard, alerts } = setup({ cfg: { monthlyCapUsd: 8 }, ledger: memoryLedger(seed) });
  await assert.rejects(() => guard.post(LABS, [{ keywords: ["x"], limit: 300 }]), (e) => e instanceof BudgetError && e.reason === "monthly-cap" && /monthly cap of \$8\.00/.test(e.message));
  assert.equal(f.requests.length, 0, "not even the free balance call is needed to refuse on the cap");
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /^shop\.test \| DataForSEO paused: /);
  assert.match(alerts[0], /No request was sent/);
  assert.ok(!/DATAFORSEO_|password|Basic /i.test(alerts[0]), "no credentials in the alert");
});

test("the cap counts the estimate: a call that would just fit is allowed, one that would not is refused", async () => {
  const est = estimateCost(LABS, { limit: 300 });
  assert.ok(est > 0.01 && est < 0.2, `estimate is a few cents, got ${est}`);
  const fits = setup({ cfg: { monthlyCapUsd: 1 }, ledger: memoryLedger({ version: 1, alerts: {}, months: { "2026-11": { usd: 1 - est, calls: 1, jobs: {} } } }) });
  await fits.guard.post(LABS, [{ keywords: ["x"], limit: 300 }]);
  assert.equal(fits.f.paid().length, 1);
  const over = setup({ cfg: { monthlyCapUsd: 1 }, ledger: memoryLedger({ version: 1, alerts: {}, months: { "2026-11": { usd: 1 - est + 0.001, calls: 1, jobs: {} } } }) });
  await assert.rejects(() => over.guard.post(LABS, [{ keywords: ["x"], limit: 300 }]), /monthly cap/);
  assert.equal(over.f.paid().length, 0);
});

test("balance under the floor: the free balance is read, the paid call is not made, and one alert goes out", async () => {
  const { f, guard, alerts } = setup({ balance: 9.5, cfg: { minBalanceUsd: 10 } });
  await assert.rejects(() => guard.post(LABS, [{ keywords: ["x"], limit: 100 }]), (e) => e.reason === "min-balance" && /\$9\.50/.test(e.message) && /floor of \$10\.00/.test(e.message));
  assert.deepEqual(f.requests.map((r) => [r.method, r.url]), [["GET", "https://api.dataforseo.com/v3/appendix/user_data"]]);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /balance \$9\.50/);
});

test("a balance just above the floor is refused when the call would take it under", async () => {
  const { f, guard } = setup({ balance: 10.01, cfg: { minBalanceUsd: 10 } });
  await assert.rejects(() => guard.post(LABS, [{ keywords: ["x"], limit: 300 }]), /would fall under the floor/);
  assert.equal(f.paid().length, 0);
});

test("balance unreadable (key rejected, or no balance in the answer): refused, never blind spending", async () => {
  const a = setup({ balanceStatus: 401 });
  await assert.rejects(() => a.guard.post(LABS, [{ keywords: ["x"] }]), (e) => e.reason === "balance-unavailable" && /HTTP 401 \(key rejected\)/.test(e.message));
  assert.equal(a.f.paid().length, 0);
  assert.equal(a.alerts.length, 1);
  const b = createCostGuard({ job: "x", env: DFS_ENV, ledger: memoryLedger(), notify: async () => ({ sent: false }), fetch: async () => jsonRes({ tasks: [{ result: [{}] }] }) });
  await assert.rejects(() => b.post(LABS, [{}]), /no balance in the response/);
});

test("the balance is read once and cached for 60 seconds, then read again; each paid cost lowers the cached balance", async () => {
  let t = Date.parse("2026-11-26T10:00:00Z");
  const { f, guard } = setup({ balance: 12, cost: 0.5, cfg: { minBalanceUsd: 10 }, now: () => new Date(t) });
  await guard.post(LABS, [{ limit: 10 }]);
  await guard.post(LABS, [{ limit: 10 }]);
  assert.equal(f.requests.filter((r) => r.method === "GET").length, 1, "one balance read for two calls");
  assert.ok(Math.abs((await guard.balance()) - 11) < 1e-9, "12 minus two calls of 0.50");
  t += 59 * 1000;
  await guard.balance();
  assert.equal(f.requests.filter((r) => r.method === "GET").length, 1);
  t += 2 * 1000;
  await guard.balance();
  assert.equal(f.requests.filter((r) => r.method === "GET").length, 2, "re-read after 60 seconds");
});

test("ledger maths: the response's own cost, per month, job and endpoint; sum of tasks when no top-level cost; estimate flagged when none", async () => {
  assert.equal(costOf({ cost: 0.0123, tasks: [{ cost: 0.5 }] }), 0.0123);
  assert.equal(costOf({ tasks: [{ cost: 0.25 }, { cost: 0.5 }] }), 0.75);
  assert.equal(costOf({ tasks: [{}] }), null);
  assert.equal(costOf(null), null);
  const ledger = memoryLedger();
  let t = new Date("2026-11-30T23:00:00Z");
  const f = async (url) => String(url).endsWith("user_data") ? jsonRes({ tasks: [{ result: [{ money: { balance: 50 } }] }] }) : jsonRes(next());
  let next;
  const guardFor = (job) => createCostGuard({ job, env: DFS_ENV, fetch: f, ledger, notify: async () => ({ sent: false }), now: () => t });
  const kw = guardFor("keywords"), rank = guardFor("rank");
  next = () => ({ cost: 0.0123, tasks: [TASK_OK(0.0123)] }); await kw.post(LABS, [{ limit: 1 }]);
  next = () => ({ cost: 0.1, tasks: [TASK_OK(0.1)] }); await kw.post(LABS, [{ limit: 1 }]);
  next = () => ({ cost: 0.004, tasks: [TASK_OK(0.004)] }); await rank.post("serp/google/organic/live/advanced", [{ keyword: "q", depth: 20 }]);
  next = () => ({ tasks: [{ status_code: 20000, cost: 0.02, result: [{ items: [] }] }, { status_code: 20000, cost: 0.03, result: [{ items: [] }] }] }); await rank.post(LABS, [{}, {}]);
  let m = ledger.data.months["2026-11"];
  assert.equal(m.usd, 0.1663,"0.0123 + 0.1 + 0.004 + 0.05");
  assert.equal(m.calls, 4);
  assert.deepEqual(m.jobs.keywords, { usd: 0.1123, calls: 2, endpoints: { [LABS]: { usd: 0.1123, calls: 2 } } });
  assert.deepEqual(m.jobs.rank.endpoints["serp/google/organic/live/advanced"], { usd: 0.004, calls: 1 });
  assert.equal(m.jobs.rank.endpoints[LABS].usd, 0.05);
  assert.equal(m.estimatedCalls, undefined);
  next = () => ({ tasks: [{ status_code: 20000, result: [{ items: [] }] }] });
  await kw.post(LABS, [{ limit: 10 }]);
  m = ledger.data.months["2026-11"];
  assert.equal(m.estimatedCalls, 1, "no cost in the response: the estimate is recorded and flagged");
  assert.equal(m.calls, 5);
  t = new Date("2026-12-01T00:00:01Z");
  assert.equal(kw.spent(), 0, "a new month starts at zero");
  next = () => ({ cost: 0.2, tasks: [TASK_OK(0.2)] }); await kw.post(LABS, [{ limit: 1 }]);
  assert.equal(ledger.data.months["2026-12"].usd, 0.2);
  assert.equal(ledger.data.months["2026-11"].calls, 5, "the old month is untouched");
  assert.match(ledgerSummary(ledger.data, "2026-12"), /^2026-12: \$0\.20 in 1 calls \(keywords \$0\.20\)$/);
  const l = addToLedger({ months: {} }, { month: "2026-01", job: "j", endpoint: "e", cost: 1.5 });
  assert.deepEqual(l.months["2026-01"], { usd: 1.5, calls: 1, jobs: { j: { usd: 1.5, calls: 1, endpoints: { e: { usd: 1.5, calls: 1 } } } } });
});

test("the ledger is a file in the state folder, shared by guards of different runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-dfs-"));
  const site = { id: "s", url: "https://www.shop.test/", paths: { state: join(dir, "state") }, dataforseo: { monthlyCapUsd: 8, minBalanceUsd: 10 } };
  const f = fakeDfs({ cost: 0.07 });
  const env = DFS_ENV, now = () => new Date("2026-11-26T10:00:00Z");
  await costGuardFor(site, "gap", { env, fetch: f, now }).post(LABS, [{ limit: 5 }]);
  await costGuardFor(site, "rank", { env, fetch: f, now }).post(LABS, [{ limit: 5 }]);
  const file = JSON.parse(readFileSync(ledgerFile(site), "utf8"));
  assert.equal(file.months["2026-11"].usd, 0.14);
  assert.deepEqual(Object.keys(file.months["2026-11"].jobs).sort(), ["gap", "rank"]);
  assert.equal(fileLedger(ledgerFile(site)).load().months["2026-11"].calls, 2);
  const text = readFileSync(ledgerFile(site), "utf8");
  assert.ok(!/DATAFORSEO|"l"|"p"/.test(text) && !text.includes(Buffer.from("l:p").toString("base64")), "no credentials in the ledger");
});

test("alerts: once per day per reason, remembered across runs, and a failed send is retried, not remembered", async () => {
  let t = new Date("2026-11-26T08:00:00Z");
  const ledger = memoryLedger({ version: 1, alerts: {}, months: { "2026-11": { usd: 8, calls: 1, jobs: {} } } });
  const sent = [];
  let ok = true;
  const mk = (balance = 50) => createCostGuard({ cfg: { monthlyCapUsd: 8 }, job: "rank", env: DFS_ENV, fetch: fakeDfs({ balance }), ledger, label: "shop.test", notify: async (x) => { sent.push(x); return ok ? { sent: true, messageId: 1 } : { sent: false, reason: "down" }; }, now: () => t });
  const g1 = mk();
  for (let i = 0; i < 5; i++) await assert.rejects(() => g1.post(LABS, [{}]), BudgetError);
  assert.equal(sent.length, 1, "five refusals in one run, one alert");
  const g2 = mk();
  await assert.rejects(() => g2.post(LABS, [{}]), BudgetError);
  assert.equal(sent.length, 1, "a later run the same day stays quiet (the ledger remembers)");
  const g3 = createCostGuard({ cfg: { monthlyCapUsd: 100, minBalanceUsd: 10 }, job: "rank", env: DFS_ENV, fetch: fakeDfs({ balance: 5 }), ledger, label: "shop.test", notify: async (x) => { sent.push(x); return { sent: true }; }, now: () => t });
  await assert.rejects(() => g3.post(LABS, [{}]), (e) => e.reason === "min-balance");
  assert.equal(sent.length, 2, "another reason the same day is its own alert");
  t = new Date("2026-11-27T08:00:00Z");
  await assert.rejects(() => mk().post(LABS, [{}]), BudgetError);
  assert.equal(sent.length, 3, "the next day alerts again");
  ok = false; t = new Date("2026-11-28T08:00:00Z");
  const g4 = mk();
  await assert.rejects(() => g4.post(LABS, [{}]), BudgetError);
  assert.equal(sent.length, 4);
  ok = true;
  await assert.rejects(() => mk().post(LABS, [{}]), BudgetError);
  assert.equal(sent.length, 5, "a send that failed is tried again on the next run");
  assert.deepEqual(Object.keys(ledger.alerts.load()), ["2026-11-28"], "older days are dropped");
  assert.deepEqual(ledger.data.alerts, {}, "alert memory is kept apart: the money ledger is never written by an alert");
});

test("an alert that throws never hides the BudgetError", async () => {
  const guard = createCostGuard({ cfg: { monthlyCapUsd: 0 }, job: "x", env: DFS_ENV, fetch: fakeDfs(), ledger: memoryLedger(), notify: async () => { throw new Error("boom"); } });
  await assert.rejects(() => guard.post(LABS, [{}]), BudgetError);
});

test("parallel calls count each other's estimate: only as many start as the cap allows", async () => {
  const est = estimateCost(LABS, { limit: 100 });
  const { f, guard } = setup({ cfg: { monthlyCapUsd: est * 1.5 } });
  const r = await Promise.allSettled([guard.post(LABS, [{ limit: 100 }]), guard.post(LABS, [{ limit: 100 }])]);
  assert.deepEqual(r.map((x) => x.status), ["fulfilled", "rejected"]);
  assert.equal(f.paid().length, 1);
});

test("a failed paid call (HTTP error) with a cost in the body is still recorded; 401/403/429 without one count $0; any other error without one counts the estimate", async () => {
  const ledger = memoryLedger();
  const f = async (url) => String(url).endsWith("user_data") ? jsonRes({ tasks: [{ result: [{ money: { balance: 50 } }] }] }) : jsonRes({ cost: 0.01, tasks: [] }, 500);
  const guard = createCostGuard({ job: "j", env: DFS_ENV, fetch: f, ledger, notify: async () => ({}) , now: () => new Date("2026-11-01T00:00:00Z") });
  await assert.rejects(() => guard.post(LABS, [{}]), /HTTP 500/);
  assert.equal(ledger.data.months["2026-11"].usd, 0.01);
  const g2 = createCostGuard({ job: "j", env: DFS_ENV, fetch: async (u) => String(u).endsWith("user_data") ? jsonRes({ tasks: [{ result: [{ money: { balance: 50 } }] }] }) : jsonRes({}, 401), ledger: memoryLedger(), notify: async () => ({}) });
  await assert.rejects(() => g2.post(LABS, [{}]), (e) => /HTTP 401 \(key rejected\)/.test(e.message));
  // R3b-B: a gateway 504 with an HTML body may have been billed: its estimate is recorded (flagged), so the cap still trips.
  const bal = (u) => String(u).endsWith("user_data");
  for (const [status, expect] of [[401, 0], [403, 0], [429, 0], [500, "est"], [502, "est"], [504, "est"]]) {
    const l = memoryLedger(), html = { ok: false, status, json: async () => { throw new SyntaxError("Unexpected token <"); } };
    const g = createCostGuard({ job: "j", env: DFS_ENV, fetch: async (u) => (bal(u) ? jsonRes({ tasks: [{ result: [{ money: { balance: 50 } }] }] }) : html), ledger: l, notify: async () => ({}), now: () => new Date("2026-11-01T00:00:00Z") });
    await assert.rejects(() => g.post(LABS, [{ limit: 100 }]), new RegExp(`HTTP ${status}`));
    const m = l.data.months["2026-11"];
    assert.equal(m?.usd ?? 0, expect === "est" ? estimateCost(LABS, { limit: 100 }) : 0, `HTTP ${status}`);
    assert.equal(m?.estimatedCalls ?? 0, expect === "est" ? 1 : 0, `HTTP ${status}`);
  }
  let sent = 0;
  const g504 = createCostGuard({ cfg: { monthlyCapUsd: 0.05 }, job: "j", env: DFS_ENV, fetch: async (u) => { if (bal(u)) return jsonRes({ tasks: [{ result: [{ money: { balance: 50 } }] }] }); sent++; return { ok: false, status: 504, json: async () => { throw new SyntaxError("<"); } }; }, ledger: memoryLedger(), notify: async () => ({}), now: () => new Date("2026-11-01T00:00:00Z") });
  let refused = null;
  for (let i = 0; i < 50 && !refused; i++) await g504.post("serp/google/organic/live/advanced", { depth: 20 }).catch((e) => { if (e instanceof BudgetError) refused = e.reason; });
  assert.equal(refused, "monthly-cap");
  assert.equal(sent, Math.floor(0.05 / estimateCost("serp/google/organic/live/advanced", { depth: 20 })));
});

test("a task status other than 20000 throws from task(); credentials missing throws before any request", async () => {
  const f = fakeDfs();
  const g = createCostGuard({ job: "j", env: DFS_ENV, fetch: async (u, i) => String(u).endsWith("user_data") ? f(u, i) : jsonRes({ cost: 0, tasks: [{ status_code: 40501, result: null }] }), ledger: memoryLedger(), notify: async () => ({}) });
  await assert.rejects(() => g.task(LABS, {}), /task status 40501/);
  const g2 = fakeDfs();
  const none = createCostGuard({ job: "j", env: {}, fetch: g2, ledger: memoryLedger() });
  await assert.rejects(() => none.post(LABS, [{}]), /DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set/);
  assert.equal(g2.requests.length, 0);
});

test("nothing calls DataForSEO without a guard: every caller refuses with no request", async () => {
  const f = fakeDfs();
  for (const call of [() => serp.search("q", SA_AR, { fetch: f, env: DFS_ENV }), () => sources.ideas(["x"], SA_AR, { fetch: f, env: DFS_ENV }), () => sources.ranked("a.test", SA_AR, { fetch: f, env: DFS_ENV }), () => sources.referringDomains("a.test", { fetch: f, env: DFS_ENV })]) {
    await assert.rejects(call, (e) => e instanceof BudgetError && e.reason === "no-guard");
  }
  assert.throws(() => requireGuard(null), BudgetError);
  assert.equal(f.requests.length, 0);
});

test("callers go through the guard: SERP, ideas, ranked keywords and referring domains are all counted in the ledger", async () => {
  const ledger = memoryLedger();
  const f = fakeDfs({ cost: 0.01, items: [] });
  const guard = createCostGuard({ job: "all", env: DFS_ENV, fetch: f, ledger, notify: async () => ({}), now: () => new Date("2026-11-26T00:00:00Z") });
  await serp.search("q", SA_AR, { guard });
  await sources.ideas(["x"], SA_AR, { guard });
  await sources.ranked("a.test", SA_AR, { guard });
  await sources.referringDomains("a.test", { guard });
  assert.deepEqual(Object.keys(ledger.data.months["2026-11"].jobs.all.endpoints).sort(), ["backlinks/referring_domains/live", LABS, "dataforseo_labs/google/ranked_keywords/live", "serp/google/organic/live/advanced"].sort());
  assert.equal(ledger.data.months["2026-11"].usd, 0.04);
});

test("a job stops at the cap: gap makes no DataForSEO request and says why", async () => {
  const dir = mkdtempSync(join(tmpdir(), "seo-dfs-job-")), state = join(dir, "state");
  mkdirSync(state, { recursive: true });
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [] }));
  const f = fakeDfs();
  const site = { id: "s", name: "S", url: "https://s.test/", market: CONFIG.SA, research: { competitors: ["rival.test"] }, dataforseo: { monthlyCapUsd: 0.001, minBalanceUsd: 10 }, paths: { state, root: dir, data: dir } };
  const { run } = await import("../src/jobs/gap.mjs");
  const log = console.log; let out = ""; console.log = (x) => { out += `${x}\n`; };
  try { await run({ site, flags: {} }, { env: DFS_ENV, fetch: f }); } finally { console.log = log; }
  assert.equal(f.requests.length, 0, "no request at all, paid or free");
  assert.match(out, /monthly cap of \$0\.001/);
  assert.match(readFileSync(join(state, "gap.md"), "utf8"), /monthly cap/);
});

test("notify: HTML-escaped, topic and chat from env, token only in the URL, nothing sent when not configured", async () => {
  assert.equal(escapeHtml("a <b> & c"), "a &lt;b&gt; &amp; c");
  const calls = [];
  const f = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return jsonRes({ ok: true, result: { message_id: 42 } }); };
  const env = { TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "424242", TELEGRAM_THREAD_ID: "172" };
  const r = await sendTelegram("shop.test | cap <reached> & more", { env, fetch: f });
  assert.deepEqual(r, { sent: true, messageId: 42 });
  assert.equal(calls[0].url, "https://api.telegram.org/bot123:SECRET/sendMessage");
  assert.deepEqual(calls[0].body, { chat_id: 424242, message_thread_id: 172, parse_mode: "HTML", disable_notification: false, text: "shop.test | cap &lt;reached&gt; &amp; more" });
  assert.ok(!JSON.stringify(r).includes("SECRET"));
  delete env.TELEGRAM_THREAD_ID;
  await sendTelegram("x", { env, fetch: f });
  assert.equal("message_thread_id" in calls[1].body, false);
  const none = await sendTelegram("x", { env: {}, fetch: async () => { throw new Error("must not be called"); } });
  assert.deepEqual(none, { sent: false, reason: "not-configured" });
  const bad = await sendTelegram("x", { env, fetch: async () => jsonRes({ ok: false, description: "Bad Request: chat not found" }, 400) });
  assert.equal(bad.sent, false); assert.match(bad.reason, /400.*chat not found/);
  const down = await sendTelegram("x", { env, fetch: async () => { throw new Error(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage failed`); } });
  assert.equal(down.sent, false); assert.ok(!down.reason.includes("SECRET"));
});

test("config: the dataforseo block has defaults (8 and 10), and wrong values are named", () => {
  assert.deepEqual(DEFAULTS.site.dataforseo, { monthlyCapUsd: 8, minBalanceUsd: 10 });
  const base = { sites: [{ id: "s", url: "https://s.test/", searchConsoleProperty: "sc-domain:s.test", sitemap: "https://s.test/sitemap.xml" }] };
  const bad = (d) => validate({ sites: [{ ...base.sites[0], dataforseo: d }] });
  assert.deepEqual(bad({ monthlyCapUsd: 3, minBalanceUsd: 0 }), []);
  assert.match(bad({ monthlyCapUsd: "8" }).join(), /monthlyCapUsd must be a number of US dollars/);
  assert.match(bad({ minBalanceUsd: -1 }).join(), /minBalanceUsd must be a number/);
  assert.match(bad({ cap: 1 }).join(), /unknown key "cap"/);
  assert.match(bad([]).join(), /must be an object/);
});

// The scan that only src/lib/dataforseo.mjs reaches the API lives in test/dataforseo-guard-r3.test.mjs (R3-9): all file types,
// src, bin, scripts, engines and skills.

// ---- SERP rows that come back as Google redirect links (seen live at Saudi Arabia, location 2682) ----------------------------------
const GOTO = (n) => `https://google.com/goto?url=CAESZAHEIkXX${n}`;
const REDIRECT_SERP = [
  { type: "ai_overview", asynchronous_ai_overview: true, markdown: "text", items: [{ type: "ai_overview_element", references: [{ domain: "google.com", source: "cited.example", url: GOTO("a") }] }], references: [
    { type: "ai_overview_reference", source: "Store apps", domain: "apps.example", url: "https://apps.example/ar" },
    { type: "ai_overview_reference", source: "cited.example", domain: "google.com", url: GOTO("b") },
    { type: "ai_overview_reference", source: "A blog title with spaces", domain: "google.com", url: GOTO("c") },
  ] },
  { type: "organic", rank_group: 1, rank_absolute: 2, domain: "google.com", url: GOTO("1"), title: "one", breadcrumb: "https://rival.example › blog › post" },
  { type: "organic", rank_group: 2, rank_absolute: 3, domain: "google.com", url: GOTO("2"), title: "two", website_name: "other.example" },
  { type: "organic", rank_group: 3, rank_absolute: 4, domain: "google.com", url: GOTO("3"), title: "three, nothing to say where it points" },
  { type: "organic", rank_group: 4, rank_absolute: 5, domain: "www.plain.example", url: "https://www.plain.example/page", title: "four" },
  { type: "people_also_ask", items: [{ domain: "google.com" }] },
];

test("SERP rows that are Google redirect links: the real domain is found in the item, rows that cannot be resolved are skipped, never counted as google.com", async () => {
  const f = fakeDfs({ cost: 0.0035, items: REDIRECT_SERP });
  const guard = createCostGuard({ job: "rank", env: DFS_ENV, fetch: f, ledger: memoryLedger(), notify: async () => ({}), now: () => new Date("2026-11-26T00:00:00Z") });
  const r = await serp.search("q", SA_AR, { guard });
  assert.deepEqual(r.results.map((x) => [x.position, x.domain]), [[2, "rival.example"], [3, "other.example"], [5, "plain.example"]]);
  assert.ok(r.results.every((x) => !/google\./.test(x.domain) && !/goto/.test(x.url)));
  assert.deepEqual(r.aiSources.map((s) => s.domain).sort(), ["apps.example", "cited.example"]);
  assert.ok(!r.features.some((x) => x.domains.includes("google.com")));
});

test("realTarget: plain items keep their own domain and url, redirects fall back, nothing resolvable gives null", async () => {
  const { realTarget } = await import("../src/lib/serp.mjs");
  assert.deepEqual(realTarget({ domain: "www.a.test", url: "https://www.a.test/x" }), { url: "https://www.a.test/x", domain: "a.test" });
  assert.deepEqual(realTarget({ domain: "google.com", url: "https://b.test/y" }), { url: "https://b.test/y", domain: "b.test" });
  assert.equal(realTarget({ domain: "google.com", url: GOTO("z") }), null);
  assert.equal(realTarget({ domain: "google.com", url: GOTO("z"), source: "not a host" }), null);
});

test("aiOverview option asks DataForSEO to load the AI Overview; the default does not", async () => {
  const f = fakeDfs({ cost: 0.0035, items: [] });
  const guard = createCostGuard({ job: "citations", env: DFS_ENV, fetch: f, ledger: memoryLedger(), notify: async () => ({}), now: () => new Date("2026-11-26T00:00:00Z") });
  await serp.search("q", SA_AR, { guard });
  await serp.search("q", SA_AR, { guard, aiOverview: true });
  const [a, b] = f.paid().map((r) => r.body[0]);
  assert.equal(a.load_async_ai_overview, undefined);
  assert.equal(b.load_async_ai_overview, true);
});
