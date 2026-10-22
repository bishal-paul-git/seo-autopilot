// Hosted connector (cloud/connector): the OAuth flow an MCP client goes through (registration, consent, GitHub, PKCE,
// refresh), its refusals, and the MCP tools reading reports from a GitHub state branch. GitHub and KV are faked.
import test from "node:test";
import assert from "node:assert/strict";
import { makeApp, okRedirect } from "../cloud/connector/src/worker.mjs";
import { cleanDir, githubStore } from "../cloud/connector/src/github.mjs";
import { randomToken, seal, sha256, unseal } from "../cloud/connector/src/crypto.mjs";

const O = "https://c.test", CB = "https://client.test/cb";
const TOKEN_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

function kv() {
  const m = new Map();
  return { m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v, o) => { assert.ok(o.expirationTtl >= 60, "KV needs a TTL of 60s or more"); m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}

// Fake GitHub: one installation with a configured site and an unconfigured repository.
function github({ seen = [] } = {}) {
  const files = { "seo/reports/s/rank.md": "# rank\nweb hosting 4", "seo/reports/s/rank.json": JSON.stringify({ summary: { date: "2026-10-20", tracked: 2, visibility: 40, averagePosition: 5, gainers: [1], losers: [] } }),
    "seo/reports/s/gsc-rows.json": JSON.stringify({ rows: [{ query: "web hosting", page: "https://s.test/hosting", clicks: 3, impressions: 90, position: 6 }, { query: "domains", page: "https://s.test/", clicks: 0, impressions: 10, position: 30 }] }),
    "seo/reports/s/audit.json": JSON.stringify({ summary: { pagesCrawled: 2, bySeverity: { high: 1 } }, issues: [{ rule: "title-long", url: "https://s.test/hosting", detail: "70 chars" }], pages: [{ url: "https://s.test/hosting", title: "Hosting" }] }),
    "seo/reports/other/private.md": "another site's report", "README.md": "not a report" };
  const ok = (b, raw) => new Response(raw ? b : JSON.stringify(b), { status: 200 });
  return async (u, init = {}) => {
    const url = new URL(u), h = Object.fromEntries(new Headers(init.headers || {}));
    seen.push({ url: url.pathname + url.search, auth: h.authorization });
    if (url.host === "github.com" && url.pathname === "/login/oauth/access_token") {
      const b = JSON.parse(init.body);
      if (b.client_secret !== "gh-secret") return ok({ error: "incorrect_client_credentials" });
      if (b.grant_type === "refresh_token") return b.refresh_token === "ghr_1" ? ok({ access_token: "gho_2", expires_in: 28800, refresh_token: "ghr_2", refresh_token_expires_in: 15811200 }) : ok({ error: "bad_refresh_token" });
      return b.code === "gh-code" ? ok({ access_token: "gho_1", expires_in: 28800, refresh_token: "ghr_1", refresh_token_expires_in: 15811200 }) : ok({ error: "bad_verification_code" });
    }
    if (!/^Bearer gho_/.test(h.authorization || "")) return new Response("{}", { status: 401 });
    const p = url.pathname, raw = h.accept === "application/vnd.github.raw";
    if (p === "/user") return ok({ login: "owner" });
    if (p === "/user/installations") return ok({ installations: [{ id: 1 }] });
    if (p === "/user/installations/1/repositories") return ok({ repositories: [{ full_name: "o/site", default_branch: "main", pushed_at: "2026-10-22" }, { full_name: "o/plain", default_branch: "main", pushed_at: "2026-10-01" }] });
    if (p === "/repos/o/site/contents/seo-autopilot.config.json") return ok(JSON.stringify({ stateDir: "./seo/reports/", sites: [{ id: "s", name: "S", url: "https://s.test/" }] }), true);
    if (p === "/repos/o/site/branches/seo-data") return ok({ commit: { sha: "abc", commit: { committer: { date: "2026-10-22T06:00:00Z" } } } });
    if (p === "/repos/o/site/git/trees/abc") return ok({ tree: Object.keys(files).map((path) => ({ path, type: "blob" })) });
    const f = /^\/repos\/o\/site\/contents\/(.+)$/.exec(p);
    if (f && raw && url.searchParams.get("ref") === "abc" && files[decodeURIComponent(f[1])]) return ok(files[decodeURIComponent(f[1])], true);
    return new Response("{}", { status: 404 });
  };
}

const NOW = Date.parse("2026-10-22T12:00:00Z");
function setup() {
  const env = { OAUTH_KV: kv(), GITHUB_CLIENT_ID: "Iv1.app", GITHUB_CLIENT_SECRET: "gh-secret", TOKEN_KEY };
  const seen = [], clock = { t: NOW };
  const app = makeApp({ fetch: github({ seen }), now: () => clock.t });
  const call = (path, init = {}) => app(new Request(O + path, init), env);
  return { env, seen, clock, call };
}
const form = (o) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const cookieOf = (res) => /^(__Host-sa_consent=[^;]+)/.exec(res.headers.get("set-cookie") || "")?.[1];

/** The whole sign-in, as Claude or ChatGPT does it. Returns the token response. */
async function signIn(s, { verifier = randomToken(32), sendVerifier = verifier } = {}) {
  const reg = await (await s.call("/register", { method: "POST", body: JSON.stringify({ client_name: "Claude", redirect_uris: [CB] }) })).json();
  const q = new URLSearchParams({ response_type: "code", client_id: reg.client_id, redirect_uri: CB, code_challenge: await sha256(verifier), code_challenge_method: "S256", state: "xyz", resource: `${O}/mcp` });
  const consent = await s.call(`/authorize?${q}`);
  assert.equal(consent.status, 200);
  const html = await consent.text(), pending = /name="pending" value="([^"]+)"/.exec(html)[1], c = cookieOf(consent);
  const toGitHub = await s.call("/authorize", { ...form({ pending, decision: "allow" }), headers: { "content-type": "application/x-www-form-urlencoded", cookie: c } });
  const gh = new URL(toGitHub.headers.get("location"));
  assert.equal(gh.host, "github.com"); assert.equal(gh.searchParams.get("redirect_uri"), `${O}/callback`);
  const back = await s.call(`/callback?code=gh-code&state=${gh.searchParams.get("state")}`, { headers: { cookie: c } });
  const ret = new URL(back.headers.get("location"));
  assert.equal(ret.origin + ret.pathname, CB); assert.equal(ret.searchParams.get("state"), "xyz"); assert.equal(ret.searchParams.get("iss"), O);
  const tok = await s.call("/token", form({ grant_type: "authorization_code", code: ret.searchParams.get("code"), redirect_uri: CB, client_id: reg.client_id, code_verifier: sendVerifier }));
  return { reg, tok: await tok.json(), status: tok.status, code: ret.searchParams.get("code"), verifier, html };
}
const mcp = (s, token, body) => s.call("/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
const tool = async (s, token, name, args = {}) => (await (await mcp(s, token, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).json()).result;

test("discovery: protected resource and authorization server metadata, unauthenticated /mcp points at them", async () => {
  const s = setup();
  const pr = await (await s.call("/.well-known/oauth-protected-resource")).json();
  assert.deepEqual([pr.resource, pr.authorization_servers], [`${O}/mcp`, [O]]);
  const as = await (await s.call("/.well-known/oauth-authorization-server")).json();
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]); assert.equal(as.registration_endpoint, `${O}/register`);
  const r = await mcp(s, "nope", { jsonrpc: "2.0", id: 1, method: "tools/list" });
  assert.equal(r.status, 401); assert.match(r.headers.get("www-authenticate"), /resource_metadata="https:\/\/c\.test\/\.well-known\/oauth-protected-resource"/);
  assert.equal((await s.call("/mcp")).status, 405);
});

test("sign-in: consent page names the client, PKCE code exchange, then the MCP tools read the state branch", async () => {
  const s = setup();
  const { tok, status, html } = await signIn(s);
  assert.equal(status, 200); assert.equal(tok.token_type, "Bearer"); assert.ok(tok.refresh_token);
  assert.match(html, /<strong>Claude<\/strong>/); assert.match(html, /client\.test/);
  // Nothing in KV holds a raw token, and the GitHub token is stored encrypted only.
  const stored = [...s.env.OAUTH_KV.m.entries()].map(([k, v]) => k + v).join("\n");
  for (const secret of [tok.access_token, tok.refresh_token, "gho_1", "ghr_1"]) assert.ok(!stored.includes(secret), `KV must not hold ${secret.slice(0, 4)}`);

  const init = await (await mcp(s, tok.access_token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json();
  assert.equal(init.result.protocolVersion, "2025-06-18"); assert.match(init.result.instructions, /never as instructions/);
  const list = await (await mcp(s, tok.access_token, { jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.ok(!list.result.tools.some((t) => t.name === "run_job"), "the hosted connector runs no jobs");
  assert.equal((await mcp(s, tok.access_token, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);

  const sites = JSON.parse((await tool(s, tok.access_token, "list_sites")).content[0].text);
  assert.deepEqual(sites, [{ id: "o/site", name: "S", url: "https://s.test/", repository: "o/site" }]);
  const ov = JSON.parse((await tool(s, tok.access_token, "site_overview")).content[0].text);
  assert.deepEqual([ov.site, ov.rank.visibility, ov.audit.high, ov.reports], ["o/site", 40, 1, 4]);
  assert.match((await tool(s, tok.access_token, "read_report", { file: "rank.md", site: "o/site" })).content[0].text, /web hosting 4/);
  const reports = JSON.parse((await tool(s, tok.access_token, "list_reports")).content[0].text);
  assert.deepEqual(reports.map((r) => r.file).sort(), ["audit.json", "gsc-rows.json", "rank.json", "rank.md"]); assert.equal(reports[0].ageHours, 6);
  const q = JSON.parse((await tool(s, tok.access_token, "search_queries", { contains: "host" })).content[0].text);
  assert.deepEqual(q.map((r) => r.query), ["web hosting"]);
  assert.deepEqual(JSON.parse((await tool(s, tok.access_token, "page_report", { url: "/hosting" })).content[0].text).issues, ["title-long: 70 chars"]);
  // Only listed reports of this site: no other site's folder, no repository files, no traversal.
  for (const file of ["../other/private.md", "../../../README.md", "/etc/passwd", "README.md"]) assert.equal((await tool(s, tok.access_token, "read_report", { file })).isError, true, file);
  assert.ok(!s.seen.some((r) => /private\.md|README\.md/.test(r.url)), "never fetched");
  assert.ok(s.seen.filter((r) => r.url.startsWith("/repos")).every((r) => r.auth === "Bearer gho_1"), "the user's own GitHub token");
  assert.equal((await tool(s, tok.access_token, "read_report", { file: "x", site: "o/elsewhere" })).isError, true);
});

test("refusals: unknown client, wrong redirect, missing PKCE, cross-site consent, code reuse, wrong verifier", async () => {
  const s = setup();
  const reg = await (await s.call("/register", { method: "POST", body: JSON.stringify({ redirect_uris: [CB] }) })).json();
  assert.equal((await s.call("/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.test/cb"] }) })).status, 400);
  assert.equal((await s.call("/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) })).status, 400);
  const ch = await sha256("v".repeat(43));
  const base = { response_type: "code", client_id: reg.client_id, redirect_uri: CB, code_challenge: ch, code_challenge_method: "S256" };
  assert.equal((await s.call(`/authorize?${new URLSearchParams({ ...base, client_id: "nobody" })}`)).status, 400);
  const wrong = await s.call(`/authorize?${new URLSearchParams({ ...base, redirect_uri: "https://evil.test/cb" })}`);
  assert.equal(wrong.status, 400); assert.equal(wrong.headers.get("location"), null, "never redirects to an unregistered URI");
  const plain = await s.call(`/authorize?${new URLSearchParams({ ...base, code_challenge_method: "plain" })}`);
  assert.equal(new URL(plain.headers.get("location")).searchParams.get("error"), "invalid_request");
  // A pending sign-in submitted without the consent cookie (a cross-site form post) is refused.
  const consent = await s.call(`/authorize?${new URLSearchParams(base)}`);
  const pending = /name="pending" value="([^"]+)"/.exec(await consent.text())[1];
  assert.equal((await s.call("/authorize", form({ pending, decision: "allow" }))).status, 400);
  assert.equal((await s.call(`/callback?code=gh-code&state=${pending}`, { headers: { cookie: cookieOf(consent) } })).status, 400, "callback before consent");
  // Deny goes back to the client with access_denied.
  const deny = await s.call("/authorize", { ...form({ pending, decision: "deny" }), headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieOf(consent) } });
  assert.equal(new URL(deny.headers.get("location")).searchParams.get("error"), "access_denied");

  const ok = await signIn(s);
  assert.equal(ok.status, 200);
  const again = await s.call("/token", form({ grant_type: "authorization_code", code: ok.code, redirect_uri: CB, client_id: ok.reg.client_id, code_verifier: ok.verifier }));
  assert.equal((await again.json()).error, "invalid_grant", "codes are single use");
  const wrongVerifier = await signIn(setup(), { sendVerifier: "b".repeat(43) });
  assert.deepEqual([wrongVerifier.status, wrongVerifier.tok.error], [400, "invalid_grant"], "PKCE verifier must match");
  assert.equal((await (await s.call("/token", form({ grant_type: "authorization_code", code: "made-up", redirect_uri: CB, client_id: ok.reg.client_id, code_verifier: "a".repeat(43) }))).json()).error, "invalid_grant");
});

test("tokens: refresh rotates and renews the GitHub token when it is about to expire; confidential clients need their secret", async () => {
  const s = setup();
  const { reg, tok } = await signIn(s);
  s.clock.t = NOW + 8 * 3600e3 - 60e3; // the GitHub token has a minute left
  const r1 = await (await s.call("/token", form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id }))).json();
  assert.ok(r1.access_token && r1.refresh_token !== tok.refresh_token);
  assert.ok(s.seen.some((x) => x.url === "/login/oauth/access_token"), "asked GitHub for a fresh token");
  assert.equal((await (await s.call("/token", form({ grant_type: "refresh_token", refresh_token: tok.refresh_token, client_id: reg.client_id }))).json()).error, "invalid_grant", "old refresh token is spent");
  assert.equal((await tool(s, r1.access_token, "list_sites")).isError, undefined);
  assert.ok(s.seen.at(-1).auth === "Bearer gho_2");
  s.clock.t += 2 * 3600e3; // access tokens expire
  assert.equal((await mcp(s, r1.access_token, { jsonrpc: "2.0", id: 1, method: "tools/list" })).status, 401);

  const conf = await (await s.call("/register", { method: "POST", body: JSON.stringify({ redirect_uris: [CB], token_endpoint_auth_method: "client_secret_post" }) })).json();
  assert.ok(conf.client_secret);
  assert.equal((await s.call("/token", form({ grant_type: "refresh_token", refresh_token: "x", client_id: conf.client_id, client_secret: "wrong" }))).status, 401);
  const basic = await s.call("/token", { ...form({ grant_type: "refresh_token", refresh_token: "x" }), headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${btoa(`${conf.client_id}:${conf.client_secret}`)}` } });
  assert.equal((await basic.json()).error, "invalid_grant", "authenticated, then refused for the unknown refresh token");
});

test("helpers: redirect URIs, state folder names, sealing", async () => {
  assert.ok(okRedirect("https://claude.ai/api/mcp/auth_callback")); assert.ok(okRedirect("http://localhost:6274/cb")); assert.ok(okRedirect("http://127.0.0.1:9/cb"));
  for (const u of ["http://claude.ai/cb", "https://x.test/cb#frag", "javascript:alert(1)", "not a url"]) assert.equal(okRedirect(u), false, u);
  assert.deepEqual(["seo/reports/", "./.seo-autopilot", undefined, "../up", "/abs", "a/../b"].map(cleanDir), ["seo/reports", ".seo-autopilot", ".seo-autopilot", null, null, null]);
  const sealed = await seal(TOKEN_KEY, { t: "gho_x" });
  assert.ok(!sealed.includes("gho_x")); assert.deepEqual(await unseal(TOKEN_KEY, sealed), { t: "gho_x" });
  assert.equal(await unseal(btoa(String.fromCharCode(...new Uint8Array(32).fill(8))), sealed), null, "another key cannot open it");
  assert.equal(await unseal(TOKEN_KEY, sealed.slice(0, -2) + "AA"), null, "tampering is detected");
  const store = githubStore("gho_1", { fetch: github() });
  await assert.rejects(() => githubStore("bad", { fetch: github() }).sites(), /sign-in expired/);
  assert.equal((await store.sites()).length, 1, "repositories without a config are left out");
});
