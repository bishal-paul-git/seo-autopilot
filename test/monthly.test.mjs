// Monthly report: the numbers a site owner reads once a month to judge the autopilot. Each must come from saved data,
// and the comparison with last month must not compare a month with itself.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { trafficChange, autopilotLedger, auditChange, experimentSummary, monthlyMarkdown } from "../src/analysis/monthly.mjs";

const add = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const days = (from, n, clicks, impressions = 100) => Object.fromEntries(Array.from({ length: n }, (_, i) => [add(from, i), [clicks, impressions, 5]]));

test("traffic: the last 28 days vs the 28 before, ending 3 days ago, with the pages that moved most", () => {
  const today = "2026-10-01"; // window 2026-09-01..09-28, previous 2026-08-04..08-31
  const series = { "https://s.test/a": { ...days("2026-08-04", 28, 2), ...days("2026-09-01", 28, 3) }, "https://s.test/b": { ...days("2026-08-04", 28, 1), ...days("2026-09-01", 28, 0) } };
  const t = trafficChange(series, today);
  assert.deepEqual(t.window, { from: "2026-09-01", to: "2026-09-28", previousFrom: "2026-08-04", previousTo: "2026-08-31" });
  assert.equal(t.now.clicks, 84); assert.equal(t.before.clicks, 84);
  assert.equal(t.gained[0].url, "https://s.test/a"); assert.equal(t.lost[0].change, -28);
  assert.ok(t.comparable);
  assert.equal(trafficChange({ "https://s.test/a": days("2026-09-20", 9, 1) }, today).comparable, false, "too little history to compare");
});

test("ledger: autopilot merges by kind, rollbacks, and changes a person merged", () => {
  const l = (...n) => n.map((name) => ({ name }));
  const r = autopilotLedger([
    { number: 1, labels: l("seo-autopilot-merged", "seo-snippet") }, { number: 2, labels: l("seo-autopilot-merged", "seo-refresh", "seo-reverted") },
    { number: 3, labels: l("seo-revert") }, { number: 4, labels: l("seo-topic") },
  ]);
  assert.deepEqual(r, { merged: 2, reverted: 1, byKind: { "seo-snippet": 1, "seo-refresh": 1 }, byPerson: 1, revertedPrs: [2] });
});

test("audit: findings that fell and rose since last month; the first month has nothing to compare", () => {
  const now = { pagesCrawled: 10, bySeverity: { high: 1, medium: 2, low: 0 }, byRule: { "title-missing": 1, "desc-long": 2 } };
  const a = auditChange(now, { bySeverity: { high: 3, medium: 1, low: 0 }, byRule: { "title-missing": 3, "desc-long": 1 } });
  assert.deepEqual(a.fixed, [{ rule: "title-missing", from: 3, to: 1 }]); assert.deepEqual(a.appeared, [{ rule: "desc-long", from: 1, to: 2 }]);
  const first = auditChange(now, null);
  assert.equal(first.was, null); assert.deepEqual(first.fixed, []);
  assert.equal(auditChange(null, null), null);
});

test("report: says when there is too little data, never claims the autopilot caused a traffic change", () => {
  const md = monthlyMarkdown({ siteName: "S", month: "2026-10", traffic: trafficChange({}, "2026-10-01"), ledger: autopilotLedger([]), audit: null, experiments: experimentSummary([]) });
  assert.match(md, /Not enough daily history/); assert.match(md, /No audit this month/); assert.match(md, /None logged/);
  const t = trafficChange({ "https://s.test/a": { ...days("2026-08-04", 28, 2), ...days("2026-09-01", 28, 3) } }, "2026-10-01");
  assert.match(monthlyMarkdown({ siteName: "S", month: "2026-10", traffic: t, ledger: autopilotLedger([]), audit: null, experiments: experimentSummary([]) }), /not proof of why/);
});

test("monthly job: writes the report and a baseline; a second run in the same month still compares with last month", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-monthly-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "audit.json"), JSON.stringify({ summary: { pagesCrawled: 5, bySeverity: { high: 1, medium: 0, low: 0 }, byRule: { "title-missing": 1 } } }));
  writeFileSync(join(state, "monthly-snapshot.json"), JSON.stringify({ month: "2026-09", bySeverity: { high: 4, medium: 0, low: 0 }, byRule: { "title-missing": 4 } }));
  const prs = join(root, "prs.json"); writeFileSync(prs, JSON.stringify([{ number: 9, labels: [{ name: "seo-autopilot-merged" }, { name: "seo-fix" }] }]));
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/monthly.mjs");
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: { prs, today: "2026-10-01", dry: true } });
    await run({ site, flags: { prs, today: "2026-10-02", dry: true } });
  } finally { console.log = log; }
  const r = JSON.parse(readFileSync(join(state, "monthly.json"), "utf8"));
  assert.equal(r.ledger.merged, 1); assert.deepEqual(r.audit.fixed, [{ rule: "title-missing", from: 4, to: 1 }]);
  assert.equal(JSON.parse(readFileSync(join(state, "monthly-snapshot.json"), "utf8")).previous.month, "2026-09");
  assert.match(readFileSync(join(state, "monthly.md"), "utf8"), /Published on its own after every check passed: 1 \(seo-fix 1\)/);
});
