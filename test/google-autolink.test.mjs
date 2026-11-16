// Automatic Google linking (D61): which property is bound without a person (domain, URL prefix, www, http/https, several,
// none), the job (lists with the D56 code, binds through the service-role RPC, queues the day's Search Console read when it
// linked), a conflict reported by the database, and planning (once a day, no Google call while planning, then the
// snapshot and its dependants in the same tick). Mocked Google and RPC; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { autoPick, makeAutolinkHandler } from "../src/god/google-access.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const S = (...urls) => ({ sites: urls.map((url) => ({ url, level: "siteRestrictedUser" })), ga4: [], errors: [] });

test("pick: the site's own domain property first, then the matching https prefix, then a parent domain", () => {
  assert.deepEqual(autoPick("https://plumber.test/", S("https://plumber.test/", "sc-domain:plumber.test", "http://plumber.test/")), { gsc: "sc-domain:plumber.test", ga4: null, state: "linked", reason: null, ga4Reason: null });
  assert.equal(autoPick("https://www.plumber.test/", S("sc-domain:plumber.test")).gsc, "sc-domain:plumber.test", "a domain property covers www");
  assert.equal(autoPick("https://plumber.test/", S("https://plumber.test/")).gsc, "https://plumber.test/", "a URL prefix");
  assert.equal(autoPick("https://shop.plumber.test/", S("https://shop.plumber.test/", "sc-domain:plumber.test")).gsc, "https://shop.plumber.test/", "a subdomain's own prefix before the parent domain");
  assert.equal(autoPick("https://shop.plumber.test/", S("sc-domain:plumber.test")).gsc, "sc-domain:plumber.test", "the parent domain when it is the only one");
  assert.equal(autoPick("https://plumber.test/blog/", S("https://plumber.test/")).gsc, "https://plumber.test/", "a prefix the site's path starts with");
  assert.equal(autoPick("https://bakery.test/", S("https://plumber.test/", "sc-domain:plumber.test")).state, "add_email", "other hosts never count");
});

test("pick: www vs non-www, http vs https", () => {
  assert.equal(autoPick("https://www.plumber.test/", S("https://plumber.test/", "https://www.plumber.test/")).gsc, "https://www.plumber.test/", "the www form the site uses");
  assert.equal(autoPick("https://plumber.test/", S("https://www.plumber.test/", "https://plumber.test/")).gsc, "https://plumber.test/", "the non-www form the site uses");
  const www = autoPick("https://plumber.test/", S("https://www.plumber.test/"));
  assert.equal(www.gsc, null); assert.equal(www.state, "pick"); assert.match(www.reason, /does not match https:\/\/plumber\.test exactly \(www or path\)/);
  assert.equal(autoPick("https://plumber.test/", S("http://plumber.test/", "https://plumber.test/")).gsc, "https://plumber.test/", "https before http");
  const http = autoPick("https://plumber.test/", S("http://plumber.test/"));
  assert.equal(http.gsc, null); assert.match(http.reason, /Only http:\/\/plumber\.test\/ was found, but the website uses https/);
  assert.equal(autoPick("http://plumber.test/", S("http://plumber.test/")).gsc, "http://plumber.test/", "an http site's own prefix");
});

test("pick: several candidates or none bind nothing and say why; GA4 only when exactly one and every property was checked", () => {
  const several = autoPick("https://plumber.test/blog/", S("https://plumber.test/", "https://plumber.test/blog/"));
  assert.equal(several.gsc, null); assert.equal(several.state, "pick"); assert.match(several.reason, /Several Search Console properties could belong to plumber\.test \(https:\/\/plumber\.test\/, https:\/\/plumber\.test\/blog\/\): pick the right one/);
  const parents = autoPick("https://a.b.plumber.test/", S("sc-domain:plumber.test", "sc-domain:b.plumber.test"));
  assert.equal(parents.gsc, null, "two parent domains: ambiguous");
  const none = autoPick("https://plumber.test/", S());
  assert.deepEqual([none.gsc, none.state], [null, "add_email"]); assert.match(none.reason, /We cannot see plumber\.test in Search Console yet: add our email/);
  assert.match(autoPick("https://plumber.test/", { sites: [], ga4: [], errors: ["Search Console: API disabled"] }).reason, /^Search Console: API disabled\. Try Check access later\./);
  const one = { ...S("sc-domain:plumber.test"), ga4: [{ id: "properties/2", name: "Plumber web" }] };
  assert.equal(autoPick("https://plumber.test/", one).ga4, "properties/2");
  const two = autoPick("https://plumber.test/", { ...one, ga4: [{ id: "properties/2", name: "Plumber web" }, { id: "properties/3", name: "Plumber old" }] });
  assert.equal(two.ga4, null); assert.match(two.ga4Reason, /Several Analytics properties have a web stream on plumber\.test \(Plumber web, Plumber old\)/);
  assert.equal(two.gsc, "sc-domain:plumber.test", "Search Console is linked on its own");
  const capped = autoPick("https://plumber.test/", { ...one, errors: ["Analytics: only 30 of 45 properties were checked; name the property after the website so it is checked first"] });
  assert.equal(capped.ga4, "properties/2", "a capped list still binds the one property named like the site (it was checked first)");
  const cappedOther = autoPick("https://plumber.test/", { ...one, ga4: [{ id: "properties/9", name: "Main site" }], errors: ["Analytics: only 30 of 45 properties were checked; name the property after the website so it is checked first"] });
  assert.equal(cappedOther.ga4, null, "a capped list never binds a property not named like the site"); assert.match(cappedOther.ga4Reason, /Not every Analytics property could be checked/);
  const down = autoPick("https://plumber.test/", { ...one, errors: ["Analytics: HTTP 403"] });
  assert.equal(down.ga4, null); assert.match(down.ga4Reason, /Analytics could not be read/);
});

// Google stand-in: one customer's plumber.test (domain + GA4), another's bakery.test.
const jsonRes = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { "content-type": "application/json" } });
function google() {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = String(url); calls.push(u);
    if (u === "https://www.googleapis.com/webmasters/v3/sites") return jsonRes({ siteEntry: [{ siteUrl: "sc-domain:plumber.test", permissionLevel: "siteRestrictedUser" }, { siteUrl: "https://bakery.test/", permissionLevel: "siteOwner" }] });
    if (u.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries")) return jsonRes({ accountSummaries: [{ displayName: "Plumber", propertySummaries: [{ property: "properties/2", displayName: "Plumber web" }] }, { displayName: "Bakery", propertySummaries: [{ property: "properties/1", displayName: "Bakery" }] }] });
    if (u.includes("/properties/2/dataStreams")) return jsonRes({ dataStreams: [{ webStreamData: { defaultUri: "https://plumber.test/" } }] });
    if (u.includes("/properties/1/dataStreams")) return jsonRes({ dataStreams: [{ webStreamData: { defaultUri: "https://bakery.test" } }] });
    return jsonRes({ error: { message: "unexpected " + u } }, 500);
  };
  return { fetchImpl, calls };
}

test("job: lists with the D56 code, binds through the service-role RPC (this host only), queues the day's Search Console read once", async () => {
  const NOW = "2026-11-30T12:00:00Z", store = new MemoryStore(), g = google(), rpcs = [];
  const call = async (fn, args) => { rpcs.push({ fn, args }); return { state: "linked", linked: true, gscProperty: args.p_pick.gsc, ga4Property: args.p_pick.ga4 }; };
  const h = makeAutolinkHandler({ store, siteOf: async () => ({ id: "A", url: "https://www.plumber.test/" }), getToken: async () => "sa", fetchImpl: g.fetchImpl, call, now: () => NOW });
  const out = await h({ siteId: "A" });
  assert.equal(rpcs.length, 1); assert.equal(rpcs[0].fn, "google_autolink");
  assert.deepEqual(rpcs[0].args.p_pick, { gsc: "sc-domain:plumber.test", ga4: "properties/2", state: "linked", reason: null, ga4Reason: null });
  assert.ok(!JSON.stringify(rpcs[0].args).includes("bakery"), "another customer's properties never leave the job");
  assert.match(out.evidence.join("\n"), /sc-domain:plumber\.test linked automatically[\s\S]*Analytics: properties\/2[\s\S]*first Search Console read queued/);
  const snap = store.listJobs("A").filter((j) => j.kind === "search_snapshot");
  assert.equal(snap.length, 1); assert.equal(snap[0].status, "queued"); assert.equal(snap[0].idempotencyKey, "search_snapshot:2026-11-30", "the planner's key: never a second read that day");
  await h({ siteId: "A" });
  assert.equal(store.listJobs("A").filter((j) => j.kind === "search_snapshot").length, 1);
});

test("job: a conflict or ambiguity from the database binds nothing and queues nothing; the reason is evidence", async () => {
  const store = new MemoryStore(), g = google();
  const call = async () => ({ state: "pick", linked: false, gscProperty: null, ga4Property: null, reason: "sc-domain:plumber.test is already connected to another website: the platform admin has been told." });
  const out = await makeAutolinkHandler({ store, siteOf: async () => ({ id: "A", url: "https://plumber.test/" }), getToken: async () => "sa", fetchImpl: g.fetchImpl, call })({ siteId: "A" });
  assert.match(out.evidence[1], /Search Console not linked: sc-domain:plumber\.test is already connected to another website/);
  assert.equal(store.listJobs("A").length, 0);
});

test("planning: once a day for a site that applies; no Google call while planning; the read follows in the same tick", async () => {
  const NOW = "2026-11-30T12:00:00Z", store = new MemoryStore(), g = google();
  store.sites = [{ id: "A", url: "https://plumber.test/" }, { id: "B", url: "https://bound.test/" }];
  let linked = false;
  const call = async () => { linked = true; return { state: "linked", linked: true, gscProperty: "sc-domain:plumber.test" }; };
  const auto = makeAutolinkHandler({ store, siteOf: async (id) => store.sites.find((s) => s.id === id), getToken: async () => "sa", fetchImpl: g.fetchImpl, call, now: () => NOW });
  auto.applies = async (id) => id === "A" && !linked;
  const reads = [];
  const snapshot = async (job) => { reads.push(job.siteId); return { evidence: ["read"] }; }; snapshot.applies = async (id) => id === "A" && linked;
  const planned = await tick({ store, handlers: { google_autolink: auto, search_snapshot: snapshot }, now: NOW, maxJobs: 0 });
  assert.equal(g.calls.length, 0, "planning makes no Google call");
  assert.deepEqual(planned.sites.map((x) => x.queued.map((q) => q.kind)), [["google_autolink"], []]);
  const ran = await tick({ store, handlers: { google_autolink: auto, search_snapshot: snapshot }, now: NOW, maxJobs: 3 });
  assert.deepEqual(ran.runs.map((r) => r.outcome), ["completed", "completed"], "the link, then the read it queued");
  assert.deepEqual(reads, ["A"]);
  assert.equal(store.listJobs("A").filter((j) => j.kind === "google_autolink").length, 1, "not twice the same day");
  linked = false; // even if the database still said so, the day's key holds
  await tick({ store, handlers: { google_autolink: auto }, now: "2026-11-30T18:00:00Z", maxJobs: 0 });
  assert.equal(store.listJobs("A").filter((j) => j.kind === "google_autolink").length, 1);
  await tick({ store, handlers: { google_autolink: auto }, now: "2026-12-01T06:00:00Z", maxJobs: 0 });
  assert.equal(store.listJobs("A").filter((j) => j.kind === "google_autolink").length, 2, "the next day again while unbound");
  const none = await tick({ store: new MemoryStore(), sites: [{ id: "C", url: "https://c.test/" }], handlers: {}, now: NOW, maxJobs: 0 });
  assert.ok(!none.sites[0].queued.length, "never planned without the Worker's Google key (no handler)");
});
