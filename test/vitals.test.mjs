// Real-user Core Web Vitals: CrUX parsing, grades, regressions and the job (mocked API).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecord, parseHistory, regressions, grade } from "../src/analysis/vitals.mjs";

const record = (lcp, inp, cls) => ({ record: { metrics: {
  largest_contentful_paint: { percentiles: { p75: lcp }, histogram: [{ start: 0, end: 2500, density: 0.81 }] },
  interaction_to_next_paint: { percentiles: { p75: inp } },
  cumulative_layout_shift: { percentiles: { p75: String(cls) } },
}, collectionPeriod: { firstDate: { year: 2026, month: 9, day: 1 }, lastDate: { year: 2026, month: 9, day: 28 } } } });

test("record: p75 values, grades with Google's thresholds, pass only when all three are good", () => {
  const r = parseRecord(record(2100, 180, 0.05));
  assert.deepEqual(r.p75, { lcp: 2100, inp: 180, cls: 0.05 }); assert.equal(r.passes, true); assert.equal(r.good.lcp, 0.81);
  assert.deepEqual(r.period, { from: "2026-09-01", to: "2026-09-28" });
  assert.equal(parseRecord(record(2600, 180, 0.05)).passes, false);
  assert.equal(grade("cls", 0.1), "good"); assert.equal(grade("inp", 501), "poor"); assert.equal(grade("lcp", 3000), "needs improvement");
});

test("history and regressions: a metric that crossed into a worse grade is flagged; small noise is not", () => {
  const periods = Array.from({ length: 10 }, (_, i) => ({ lastDate: { year: 2026, month: 8, day: i + 1 } }));
  const h = parseHistory({ record: { collectionPeriods: periods, metrics: {
    largest_contentful_paint: { percentilesTimeseries: { p75s: [2000, 2100, 2050, 2000, 2100, 2000, 2900, 3000, 3100, 3000] } },
    interaction_to_next_paint: { percentilesTimeseries: { p75s: [150, 160, 155, 150, 158, 152, 160, 155, 150, 157] } },
    cumulative_layout_shift: { percentilesTimeseries: { p75s: [null, null, "0.02", "0.02", "0.03", "0.02", "0.02", "0.03", "0.02", "0.02"] } },
  } } });
  assert.equal(h.weeks.length, 10); assert.equal(h.series.cls[2], 0.02);
  const r = regressions(h);
  assert.deepEqual(r.map((x) => [x.metric, x.from, x.to]), [["lcp", "good", "needs improvement"]]);
});

test("vitals job: whole site and top pages by clicks; pages without field data say so; needs a key", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-vit-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [{ page: "https://s.test/a", clicks: 50 }, { page: "https://s.test/b", clicks: 5 }] }));
  const bodies = [];
  const f = async (url, init) => {
    const b = JSON.parse(init.body); bodies.push({ kind: url.includes("History") ? "history" : "record", ...b });
    if (b.url === "https://s.test/b") return { ok: false, status: 404 };
    if (url.includes("History")) return { ok: true, status: 200, json: async () => ({ record: { collectionPeriods: [], metrics: {} } }) };
    return { ok: true, status: 200, json: async () => record(1900, 120, 0.02) };
  };
  const site = { id: "s", name: "S", url: "https://s.test/", paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/vitals.mjs");
  const log = console.log; const out = []; console.log = (x) => out.push(String(x));
  try {
    await run({ site, flags: {} }, { env: {}, fetch: f });
    assert.match(out.join("\n"), /CRUX_API_KEY/); assert.equal(bodies.length, 0);
    await run({ site, flags: { pages: 2 } }, { env: { CRUX_API_KEY: "k" }, fetch: f });
  } finally { console.log = log; }
  assert.equal(bodies[0].origin, "https://s.test"); assert.equal(bodies[0].formFactor, "PHONE");
  const r = JSON.parse(readFileSync(join(state, "vitals.json"), "utf8"));
  assert.equal(r.origin.current.passes, true);
  assert.deepEqual(r.pages.map((p) => [p.url, p.current.error || "ok"]), [["https://s.test/a", "ok"], ["https://s.test/b", "not enough Chrome traffic for field data"]]);
  assert.match(readFileSync(join(state, "vitals.md"), "utf8"), /real-user Core Web Vitals/);
});
