import { test } from "node:test";
import assert from "node:assert/strict";
import { googleToken, trafficDue, makeSearchConsoleHandler } from "../src/god/search-console.mjs";
import { lessonsFrom, openExperiment } from "../src/god/learning.mjs";
import { MemoryStore } from "../src/god/stores.mjs";
import { tick } from "../src/god/tick.mjs";

const NOW = "2026-11-30T12:00:00Z", OPENED = "2026-11-08T09:00:00Z";
const SITE = { id: "A", name: "P", url: "https://www.plumber.test/" };
const HREF = "https://www.plumber.test/boilers/";
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };

test("Google sign-in: a correctly signed, read-only service-account token request (Web Crypto)", async () => {
  const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", kp.privateKey)).toString("base64");
  const key = JSON.stringify({ client_email: "seo@agency.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`, token_uri: "https://oauth2.googleapis.com/token" });
  let seen;
  const fetchImpl = async (url, o) => { seen = { url, body: new URLSearchParams(o.body) }; return new Response(JSON.stringify({ access_token: "ya29.test" }), { status: 200 }); };
  assert.equal(await googleToken(key, { fetchImpl, now: Date.parse(NOW) }), "ya29.test");
  const [h, c, s] = seen.body.get("assertion").split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString());
  assert.equal(dec(c).scope, "https://www.googleapis.com/auth/webmasters.readonly", "read-only scope");
  assert.equal(dec(c).iss, "seo@agency.iam.gserviceaccount.com");
  assert.ok(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", kp.publicKey, Buffer.from(s, "base64url"), new TextEncoder().encode(`${h}.${c}`)), "signature verifies with the public key");
  await assert.rejects(googleToken('{"client_email":"x"}'), /missing/);
  await assert.rejects(googleToken(key, { fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) }), /invalid_grant/);
});

function setup({ access = "prefix", pageGrowth = 2 } = {}) {
  const store = new MemoryStore(); store.clock = () => NOW;
  const exp = openExperiment({ id: "j1", kind: "agent:seo-snippet-optimizer", inputs: { agent: "seo-snippet-optimizer" }, outputs: { proposal: { recommendations: [{ title: "Rewrite the boilers title", url: HREF }] } } },
    { generatedAt: OPENED, issues: [{ rule: "title-too-short", severity: "medium", url: HREF }] }, OPENED);
  store.writeMemory("A", [{ kind: "experiment", key: "exp:j1", value: exp, basis: "verified" }]);
  const calls = [];
  const fetchImpl = async (url, o) => {
    const prop = decodeURIComponent(url.split("/sites/")[1].split("/")[0]), b = JSON.parse(o.body); calls.push({ prop, b });
    if (access === "none" || (access === "prefix" && prop.startsWith("sc-domain:"))) return new Response(JSON.stringify({ error: { message: "User does not have sufficient permission" } }), { status: 403 });
    const page = !!b.dimensionFilterGroups, rows = days(b.startDate, b.endDate).map((d) => {
      const after = d >= addDays(OPENED.slice(0, 10), 3);
      const pc = after ? 10 * pageGrowth : 10, pi = after ? 100 * pageGrowth : 100;
      return { keys: [d], clicks: page ? pc : 100 + pc, impressions: page ? pi : 1000 + pi, position: 8 };
    });
    return new Response(JSON.stringify({ rows }), { status: 200 });
  };
  const handler = makeSearchConsoleHandler({ store, siteOf: async () => SITE, getToken: async () => "tok", fetchImpl, now: () => NOW });
  return { store, calls, handler };
}

test("measures accepted advice: small queries only, the domain property then the address prefix, a verdict against the rest of the site", async () => {
  const { store, calls, handler } = setup();
  assert.equal(trafficDue(store.readMemory("A", "experiment").map((m) => m.value), "2026-11-20T00:00:00Z").length, 0, "not before the after-window completes");
  assert.equal(trafficDue(store.readMemory("A", "experiment").map((m) => m.value), NOW).length, 1);
  const out = await handler({ siteId: "A" });
  assert.match(out.evidence[0], /1 page measured/);
  assert.ok(calls[0].prop.startsWith("sc-domain:plumber.test"), "tries the domain property first");
  assert.equal(calls[1].prop, "https://www.plumber.test/");
  for (const c of calls) assert.deepEqual(c.b.dimensions, ["date"], "never downloads page x date data");
  assert.deepEqual(calls.at(-1).b.dimensionFilterGroups[0].filters[0], { dimension: "page", operator: "equals", expression: HREF });
  const t = store.readMemory("A", "experiment")[0].value.items[0].traffic;
  assert.equal(t.status, "done");
  assert.equal(t.verdict, "better than the rest of the site");
  assert.ok(t.adjustedImpressionsChange > 0.5 && t.before.clicks > 0 && t.after.clicks > t.before.clicks);
  const lesson = lessonsFrom(store.readMemory("A", "experiment").map((m) => m.value), [], NOW)[0];
  assert.match(lesson.value.text, /in Search Console 1 of 1 measured pages did better than the rest of the site/);
  assert.equal(trafficDue(store.readMemory("A", "experiment").map((m) => m.value), NOW).length, 0, "measured once");
});

test("no access to the property goes to a person with what to do; flat traffic is not called a win", async () => {
  const none = setup({ access: "none" });
  assert.match((await none.handler({ siteId: "A" })).escalate, /site owner must add it as a user/);
  const flat = setup({ pageGrowth: 1 });
  await flat.handler({ siteId: "A" });
  assert.equal(flat.store.readMemory("A", "experiment")[0].value.items[0].traffic.verdict, "in line with the rest of the site");
});

test("the scheduler queues the measurement only when advice is ready and a Google key is configured", async () => {
  const { store, handler } = setup();
  store.sites = [SITE];
  let r = await tick({ store, sites: [SITE], handlers: {}, now: NOW, maxJobs: 0 });
  assert.ok(!r.sites[0].queued.some((q) => q.kind === "search_console"), "no key: never queued");
  r = await tick({ store, sites: [SITE], handlers: { search_console: handler }, now: NOW, maxJobs: 5 });
  assert.ok(r.sites[0].queued.some((q) => q.kind === "search_console"));
  assert.ok(r.runs.some((x) => x.outcome === "completed"), "read-only measurement completes without approval");
  assert.equal(store.readMemory("A", "experiment")[0].value.items[0].traffic.status, "done");
});
