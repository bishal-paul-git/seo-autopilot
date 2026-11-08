import { test } from "node:test";
import assert from "node:assert/strict";
import { normUrl, openExperiment, evaluateExperiment, lessonsFrom, applyLessons, learn, SETTLE_DAYS } from "../src/god/learning.mjs";
import { agentInput } from "../src/god/agent-runner.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const T0 = "2026-11-01T00:00:00Z", day = (n) => new Date(Date.parse(T0) + n * 864e5).toISOString();
const audit = (at, issues, crawled) => ({ generatedAt: at, summary: {}, issues, crawled });
const ADVICE = (id, agent, recs, extra = {}) => ({ id, kind: `agent:${agent}`, status: "completed", inputs: { agent }, updatedAt: T0, outputs: { proposal: { mode: "advise", recommendations: recs } }, ...extra });

test("addresses compare without scheme, www, case of host or trailing slash", () => {
  assert.equal(normUrl("https://WWW.Plumber.test/boilers/"), "plumber.test/boilers");
  assert.equal(normUrl("http://plumber.test/boilers"), "plumber.test/boilers");
  assert.equal(normUrl("https://plumber.test/"), "plumber.test");
});

test("an experiment records each recommendation with the problems found on its page", () => {
  const a = audit(T0, [{ rule: "title-missing", severity: "high", url: "https://plumber.test/x" }, { rule: "meta-description-missing", severity: "medium", url: "https://plumber.test/x/" }, { rule: "h1-missing", severity: "medium", url: "https://plumber.test/y" }], []);
  const e = openExperiment(ADVICE("j1", "seo-snippet-optimizer", [{ title: "Add a title", url: "https://www.plumber.test/x" }, { title: "General advice", url: null }]), a, T0);
  assert.equal(e.items.length, 1, "only recommendations with an address can be checked");
  assert.deepEqual(e.items[0].baseline, ["meta-description-missing", "title-missing"]);
  assert.equal(openExperiment(ADVICE("j2", "x", [{ title: "No address" }]), a, T0), null);
});

test("re-checks: too early, fixed, partly, unchanged, worse, not re-read, and closed as not done after 30 days", () => {
  const base = { job: "j", agent: "a", openedAt: T0, status: "open", items: [
    { url: "p.test/fixed", baseline: ["title-missing"], status: "open" }, { url: "p.test/partly", baseline: ["title-missing", "h1-missing"], status: "open" },
    { url: "p.test/same", baseline: ["title-missing"], status: "open" }, { url: "p.test/worse", baseline: ["h1-missing"], status: "open" },
    { url: "p.test/unread", baseline: ["title-missing"], status: "open" }] };
  const crawled = ["https://p.test/fixed", "https://p.test/partly", "https://p.test/same", "https://p.test/worse"];
  const issues = [{ rule: "h1-missing", url: "https://p.test/partly", severity: "medium" }, { rule: "title-missing", url: "https://p.test/same", severity: "high" },
    { rule: "noindex", url: "https://p.test/worse", severity: "high" }, { rule: "h1-missing", url: "https://p.test/worse", severity: "medium" }];
  assert.equal(evaluateExperiment(base, audit(day(SETTLE_DAYS - 1), issues, crawled), day(2)), base, "too early to judge");
  const e = evaluateExperiment(base, audit(day(5), issues, crawled), day(5));
  assert.deepEqual(e.items.map((i) => i.status), ["resolved", "partly", "unchanged", "worse", "not_rechecked"]);
  assert.equal(e.status, "open");
  assert.deepEqual(e.items[3].newHigh, ["noindex"]);
  const late = evaluateExperiment(e, audit(day(31), issues, crawled), day(31));
  assert.equal(late.items[2].status, "not_implemented");
  assert.equal(late.status, "closed");
});

test("lessons per agent, with the agency's recent refusals; lessons change the plan", () => {
  const exps = [{ agent: "seo-snippet-optimizer", items: [{ status: "resolved" }, { status: "resolved" }, { status: "unchanged" }] }, { agent: "seo-refresher", items: [{ status: "unchanged" }, { status: "not_implemented" }, { status: "unchanged" }] }];
  const jobs = [{ kind: "agent:seo-link-builder", status: "rejected", updatedAt: day(20) }, { kind: "agent:seo-link-builder", status: "rejected", updatedAt: day(25) }, { kind: "agent:seo-reporter", status: "rejected", updatedAt: "2026-08-01T00:00:00Z" }];
  const ls = lessonsFrom(exps, jobs, day(30));
  const by = Object.fromEntries(ls.map((l) => [l.key, l.value]));
  assert.match(by["agent:seo-snippet-optimizer"].text, /2 of 3 checked recommendations were fixed/);
  assert.equal(by["agent:seo-link-builder"].refusals, 2);
  assert.equal(by["agent:seo-reporter"], undefined, "refusals older than 30 days are forgotten");
  const plan = [{ kind: "agent:seo-link-builder", priority: 3 }, { kind: "agent:seo-refresher", priority: 3, why: "stale pages" }, { kind: "agent:seo-snippet-optimizer", priority: 3 }, { kind: "scan", priority: 2 }];
  const g = applyLessons(plan, ls);
  assert.deepEqual(g.deferred.map((d) => d.kind), ["agent:seo-link-builder"]);
  assert.match(g.deferred[0].reason, /declined this 2 times/);
  assert.equal(g.keep.find((j) => j.kind === "agent:seo-refresher").priority, 4, "advice never acted on drops a step");
  assert.equal(g.keep.find((j) => j.kind === "agent:seo-snippet-optimizer").priority, 3, "advice that works keeps its place");
});

test("the loop through the scheduler: accepted advice is checked by later scans, becomes a lesson, and reaches the agents", async () => {
  const store = new MemoryStore(); let clock = day(0); store.clock = () => clock;
  const SITE = { id: "A", name: "P", url: "https://p.test/" };
  store.writeMemory("A", [{ kind: "strategy", key: "initial", value: { status: "approved" }, basis: "verified" },
    { kind: "report", key: "audit", value: audit(day(0), [{ rule: "title-missing", severity: "high", url: "https://p.test/x" }], ["https://p.test/x"]), basis: "verified" }]);
  const j = store.createJob({ siteId: "A", kind: "agent:seo-snippet-optimizer", title: "Titles", risk: "medium", inputs: { agent: "seo-snippet-optimizer" } });
  Object.assign(j, { status: "completed", updatedAt: day(0), outputs: { proposal: { recommendations: [{ title: "Add a title to /x", url: "https://p.test/x" }] } } });
  await tick({ store, sites: [SITE], handlers: {}, now: day(0), maxJobs: 0 });
  assert.equal(store.readMemory("A", "experiment")[0].value.items[0].baseline[0], "title-missing", "experiment opened when the advice was accepted");
  // Six days later a new scan no longer finds the problem on that page.
  clock = day(6);
  store.writeMemory("A", [{ kind: "report", key: "audit", value: audit(day(6), [], ["https://p.test/x"]), basis: "verified" }]);
  const r = await tick({ store, sites: [SITE], handlers: {}, now: day(6), maxJobs: 0 });
  assert.equal(store.readMemory("A", "experiment")[0].value.items[0].status, "resolved");
  const lesson = store.readMemory("A", "lesson")[0];
  assert.match(lesson.value.text, /seo-snippet-optimizer: 1 of 1 checked recommendations were fixed/);
  assert.equal(r.sites[0].learning.lessons, 1);
  const input = agentInput({ kind: "agent:seo-refresher", title: "Refresh", inputs: { agent: "seo-refresher" } }, store.readMemory("A"), SITE);
  assert.ok(input.includes("1 of 1 checked recommendations were fixed"), "agents see the site's own lessons, inside the data block");
  const before = store.readMemory("A").length;
  await tick({ store, sites: [SITE], handlers: {}, now: day(6), maxJobs: 0 });
  assert.equal(store.readMemory("A").length, before, "nothing new learned: nothing rewritten");
});

test("learning never invents: no audit, no checks; advice without addresses opens nothing", () => {
  const out = learn({ memory: [], jobs: [ADVICE("j", "a", [{ title: "t", url: "https://p.test/x" }])], now: T0 });
  assert.equal(out.experiments[0].items[0].baseline.length, 0, "no audit: empty baseline, nothing claimed");
  assert.equal(learn({ memory: [], jobs: [ADVICE("k", "a", [{ title: "t" }])], now: T0 }).experiments.length, 0);
});
