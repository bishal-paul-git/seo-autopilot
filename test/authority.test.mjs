// Backlink and authority profile: merging sources, tiers, new and lost, competitor comparison and the link intersect.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeDomains, profile, intersect, compare, tier } from "../src/analysis/authority.mjs";

test("merge and profile: one record per domain with its sources; tiers; new and lost against the snapshot; provider-lost kept apart", () => {
  const d = mergeDomains({ "search-console export": ["www.a.test", "b.test"], dataforseo: [{ domain: "a.test", backlinks: 12, rank: 300 }, { domain: "c.test", backlinks: 1, lost: "2026-09-01" }] });
  assert.deepEqual(d.find((x) => x.domain === "a.test"), { domain: "a.test", sources: ["search-console export", "dataforseo"], links: 12, providerRank: 300, firstSeen: null });
  const p = profile(d, { authority: { "a.test": 7.2, "b.test": 3 }, previous: { domains: ["b.test", "z.test"] } });
  assert.equal(p.referringDomains, 2, "a domain the provider marks lost is not counted");
  assert.deepEqual(p.tiers, { "high (7-10)": 1, "low (2-3.9)": 1 });
  assert.equal(p.averageAuthority, 5.1); assert.deepEqual(p.newDomains.map((x) => x.domain), ["a.test"]); assert.deepEqual(p.lostDomains, ["z.test"]);
  assert.deepEqual(p.providerLost, [{ domain: "c.test", lost: "2026-09-01" }]);
  assert.equal(tier(null), "unknown");
});

test("link intersect: sites linking to two or more competitors and not to you, most competitors then authority first", () => {
  const ix = intersect(["mine.test"], { "r1.test": [{ domain: "dir.test" }, { domain: "mine.test" }, { domain: "blog.test" }, { domain: "r2.test" }], "r2.test": [{ domain: "dir.test" }, { domain: "blog.test" }, { domain: "news.test" }], "r3.test": [{ domain: "blog.test" }] }, { authority: { "dir.test": 6 } });
  assert.deepEqual(ix.map((x) => [x.domain, x.linksTo.length]), [["blog.test", 3], ["dir.test", 2]]);
  const c = compare("www.s.test", 10, { "r1.test": [1, 2, 3] }, { "s.test": 3, "r1.test": 5 });
  assert.deepEqual(c.map((x) => [x.domain, x.referringDomains, x.you]), [["r1.test", 3, false], ["s.test", 10, true]]);
});

const res = (body) => ({ ok: true, status: 200, json: async () => body });

test("authority job: export plus DataForSEO plus Open PageRank; snapshot for next time; nothing is contacted", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-auth-")); const state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "inbound.json"), JSON.stringify({ domains: ["dir.test", "friend.test"] }));
  const urls = [];
  const f = async (url, init) => {
    urls.push(String(url));
    if (String(url).includes("openpagerank")) return res({ response: [{ status_code: 200, domain: "dir.test", page_rank_decimal: 5 }, { status_code: 200, domain: "blog.test", page_rank_decimal: 6 }] });
    const t = JSON.parse(init.body)[0].target;
    const items = { "s.test": [{ domain: "dir.test", backlinks: 2 }], "r1.test": [{ domain: "blog.test" }, { domain: "dir.test" }], "r2.test": [{ domain: "blog.test" }] }[t];
    return res({ tasks: [{ status_code: 20000, result: [{ items }] }] });
  };
  const site = { id: "s", name: "S", url: "https://s.test/", research: { competitors: ["r1.test", "r2.test"] }, paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/authority.mjs");
  const log = console.log; console.log = () => {};
  try { await run({ site, flags: {} }, { env: { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p", OPENPAGERANK_API_KEY: "o" }, fetch: f }); } finally { console.log = log; }
  assert.ok(urls.every((u) => /dataforseo|openpagerank/.test(u)), "only the data providers are called");
  const r = JSON.parse(readFileSync(join(state, "authority.json"), "utf8"));
  assert.equal(r.profile.referringDomains, 2); assert.deepEqual(r.intersect.map((x) => [x.domain, x.authority]), [["blog.test", 6]]);
  assert.deepEqual(JSON.parse(readFileSync(join(state, "authority-snapshot.json"), "utf8")).domains, ["dir.test", "friend.test"]);
});
