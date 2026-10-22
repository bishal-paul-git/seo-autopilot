// seo-autopilot hosted connector: a remote MCP server (Streamable HTTP) that claude.ai, ChatGPT and other MCP clients add
// as a custom connector. People sign in with GitHub; the connector then reads the SEO reports their scheduled workflows
// already save in their own repository. It is read-only and runs no jobs (decision D20). Cloudflare Worker, no
// dependencies; the tools are the same code as the local `seo-autopilot mcp` server (src/mcp/core.mjs).
//
// OAuth 2.1 authorization server, as MCP clients expect: protected-resource and server metadata, dynamic client
// registration, PKCE S256 only, single-use codes, rotating refresh tokens. Sign-in is delegated to GitHub. Safety:
//  - our own consent page names the client before GitHub is asked, so a registered client cannot get a token silently;
//    a SameSite=Lax cookie binds the consent and the GitHub callback to the same browser (no cross-site approval);
//  - redirect URIs must match the registered ones exactly (https, or http on loopback only);
//  - KV keeps only hashes of our tokens and codes, and the GitHub token only AES-GCM encrypted with TOKEN_KEY.
// Bindings: OAUTH_KV (KV namespace). Secrets: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (a GitHub App with Contents: read
// and Metadata: read), TOKEN_KEY (32 random bytes, base64). Optional: GITHUB_APP_SLUG (for the install link).
import { handle, readHandlers, READ_TOOLS } from "../../../src/mcp/core.mjs";
import { githubStore } from "./github.mjs";
import { randomToken, same, seal, sha256, unseal } from "./crypto.mjs";

const GITHUB = "https://github.com";
const SCOPE = "reports:read";
const TTL = { access: 3600, refresh: 30 * 86400, code: 300, pending: 600, client: 365 * 86400 };
const COOKIE = "__Host-sa_consent";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id", "access-control-expose-headers": "www-authenticate, mcp-session-id" };

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers } });
const oauthError = (error, error_description, status = 400) => json({ error, error_description }, status);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title, body, status = 200, headers = {}) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 16px;color:#1d2420}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}code{overflow-wrap:anywhere}</style>${body}`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer", ...headers } });
const cookie = (req, name) => (req.headers.get("cookie") || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1] || null;
const withParams = (uri, params) => { const u = new URL(uri); for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, v); return u.toString(); };

/** https anywhere, or http on the local machine only (desktop clients); no fragments. */
export function okRedirect(uri) {
  try {
    const u = new URL(uri);
    return !u.hash && (u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)));
  } catch { return false; }
}

export function makeApp({ fetch = globalThis.fetch, now = () => Date.now() } = {}) {
  return async function app(req, env) {
    const url = new URL(req.url), origin = String(env.PUBLIC_URL || url.origin).replace(/\/$/, ""), path = url.pathname.replace(/\/$/, "") || "/";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.OAUTH_KV || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.TOKEN_KEY) return json({ error: "server_error", error_description: "This connector is not configured yet." }, 500);
    const kv = env.OAUTH_KV;
    // Every record carries its own expiry too: KV deletes on a TTL of at least 60 seconds, and only approximately.
    const get = async (k) => { const v = await kv.get(k, "json"); return v && v._exp > now() ? v : null; };
    const put = (k, v, ttl) => kv.put(k, JSON.stringify({ ...v, _exp: now() + ttl * 1000 }), { expirationTtl: Math.max(60, Math.ceil(ttl)) });

    // --- Discovery (RFC 9728 and RFC 8414) ---
    if (path.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: `${origin}/mcp`, authorization_servers: [origin], bearer_methods_supported: ["header"], scopes_supported: [SCOPE], resource_name: "seo-autopilot" });
    if (path.startsWith("/.well-known/oauth-authorization-server")) {
      return json({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"], scopes_supported: [SCOPE], authorization_response_iss_parameter_supported: true });
    }

    // --- Dynamic client registration (RFC 7591) ---
    if (path === "/register" && req.method === "POST") {
      const b = await req.json().catch(() => null);
      const uris = b?.redirect_uris;
      if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every(okRedirect)) return oauthError("invalid_redirect_uri", "redirect_uris must be 1 to 10 https URLs (or http on localhost).");
      const method = b.token_endpoint_auth_method || "none";
      if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) return oauthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method.");
      const client_id = randomToken(16), secret = method === "none" ? null : randomToken();
      const name = String(b.client_name || "An MCP client").slice(0, 100);
      await put(`client:${client_id}`, { name, redirect_uris: uris, method, secret: secret && (await sha256(secret)) }, TTL.client);
      return json({ client_id, ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}), client_id_issued_at: Math.floor(now() / 1000), client_name: name, redirect_uris: uris, token_endpoint_auth_method: method, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
    }

    // --- Authorization: our consent page, then GitHub ---
    if (path === "/authorize" && req.method === "GET") {
      const q = Object.fromEntries(url.searchParams);
      const client = q.client_id ? await get(`client:${q.client_id}`) : null;
      // Never redirect to a URI we cannot vouch for.
      if (!client || !client.redirect_uris.includes(q.redirect_uri)) return page("Cannot connect", "<h1>Cannot connect</h1><p>This app is not registered with the connector, or its return address does not match. Start again from the app.</p>", 400);
      const back = (error, error_description) => Response.redirect(withParams(q.redirect_uri, { error, error_description, state: q.state, iss: origin }), 302);
      if (q.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
      if (!q.code_challenge || q.code_challenge_method !== "S256") return back("invalid_request", "PKCE with S256 is required.");
      if (q.resource && ![origin, `${origin}/mcp`].includes(q.resource.replace(/\/$/, ""))) return back("invalid_target", "Unknown resource.");
      const pending = randomToken(), csrf = randomToken();
      await put(`pending:${pending}`, { client_id: q.client_id, redirect_uri: q.redirect_uri, code_challenge: q.code_challenge, state: q.state || null, scope: SCOPE, csrf: await sha256(csrf) }, TTL.pending);
      const host = new URL(q.redirect_uri).host;
      return page("Connect seo-autopilot", `<h1>Connect seo-autopilot</h1><p><strong>${esc(client.name)}</strong> (returning to <code>${esc(host)}</code>) asks to read the SEO reports saved in the GitHub repositories you install the seo-autopilot app on.</p><p>It can read reports only. It cannot change your site, your repository or your settings.</p><form method="post" action="/authorize"><input type="hidden" name="pending" value="${esc(pending)}"><button name="decision" value="allow">Continue with GitHub</button><button name="decision" value="deny">Cancel</button></form><p><small>Only continue if you started this from ${esc(client.name)} just now.</small></p>`, 200, { "set-cookie": `${COOKIE}=${csrf}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${TTL.pending}` });
    }
    if (path === "/authorize" && req.method === "POST") {
      const f = await req.formData().catch(() => null);
      const id = String(f?.get("pending") || ""), p = id ? await get(`pending:${id}`) : null;
      if (!p || !same(await sha256(cookie(req, COOKIE) || ""), p.csrf)) return page("Expired", "<h1>This sign-in expired</h1><p>Start again from the app.</p>", 400);
      if (f.get("decision") !== "allow") { await kv.delete(`pending:${id}`); return Response.redirect(withParams(p.redirect_uri, { error: "access_denied", state: p.state, iss: origin }), 302); }
      await put(`pending:${id}`, { ...p, approved: true }, TTL.pending);
      return Response.redirect(withParams(`${GITHUB}/login/oauth/authorize`, { client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${origin}/callback`, state: id }), 302);
    }
    if (path === "/callback" && req.method === "GET") {
      const id = url.searchParams.get("state") || "", p = id ? await get(`pending:${id}`) : null;
      if (!p?.approved || !same(await sha256(cookie(req, COOKIE) || ""), p.csrf)) return page("Expired", "<h1>This sign-in expired</h1><p>Start again from the app.</p>", 400);
      await kv.delete(`pending:${id}`);
      const back = (params) => new Response(null, { status: 302, headers: { location: withParams(p.redirect_uri, { ...params, state: p.state, iss: origin }), "set-cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0` } });
      const code = url.searchParams.get("code");
      if (!code) return back({ error: "access_denied", error_description: "GitHub sign-in was cancelled." });
      const gt = await githubToken(fetch, env, { code, redirect_uri: `${origin}/callback` });
      if (!gt) return back({ error: "access_denied", error_description: "GitHub did not confirm the sign-in." });
      const user = await fetch("https://api.github.com/user", { headers: { authorization: `Bearer ${gt.t}`, accept: "application/vnd.github+json", "user-agent": "seo-autopilot-connector" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const ours = randomToken();
      await put(`code:${await sha256(ours)}`, { client_id: p.client_id, redirect_uri: p.redirect_uri, code_challenge: p.code_challenge, scope: p.scope, login: user?.login || null, grant: await seal(env.TOKEN_KEY, gt) }, TTL.code);
      return back({ code: ours });
    }

    // --- Token endpoint ---
    if (path === "/token" && req.method === "POST") {
      const f = await req.formData().catch(() => null);
      if (!f) return oauthError("invalid_request", "Send the request as application/x-www-form-urlencoded.");
      let client_id = String(f.get("client_id") || ""), secret = f.get("client_secret");
      const basic = /^Basic\s+(.+)$/i.exec(req.headers.get("authorization") || "");
      if (basic) { try { const [i, s] = atob(basic[1]).split(":"); client_id = decodeURIComponent(i); secret = decodeURIComponent(s || ""); } catch { return oauthError("invalid_client", "Bad client credentials.", 401); } }
      const client = client_id ? await get(`client:${client_id}`) : null;
      if (!client || (client.method !== "none" && !same(await sha256(secret || ""), client.secret))) return oauthError("invalid_client", "Unknown client or wrong secret.", 401);
      const grant = f.get("grant_type");
      if (grant === "authorization_code") {
        const key = `code:${await sha256(f.get("code") || "")}`, rec = await get(key);
        if (rec) await kv.delete(key); // single use
        const verifier = String(f.get("code_verifier") || "");
        if (!rec || rec.client_id !== client_id || rec.redirect_uri !== f.get("redirect_uri") || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !same(await sha256(verifier), rec.code_challenge)) return oauthError("invalid_grant", "The code is invalid, used, expired, or does not match.");
        return issue(rec, await unseal(env.TOKEN_KEY, rec.grant));
      }
      if (grant === "refresh_token") {
        const key = `rt:${await sha256(f.get("refresh_token") || "")}`, rec = await get(key);
        if (!rec || rec.client_id !== client_id) return oauthError("invalid_grant", "Unknown or expired refresh token.");
        await kv.delete(key); // rotated: each refresh token works once
        let gt = await unseal(env.TOKEN_KEY, rec.grant);
        if (gt?.exp && gt.exp - now() < 120000) gt = gt.r && (!gt.rexp || gt.rexp > now()) ? await githubToken(fetch, env, { grant_type: "refresh_token", refresh_token: gt.r }) : null;
        if (!gt) return oauthError("invalid_grant", "GitHub sign-in expired. Connect again.");
        return issue({ ...rec, grant: await seal(env.TOKEN_KEY, gt) }, gt);
      }
      return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
    }

    // --- MCP endpoint (Streamable HTTP, JSON responses) ---
    if (path === "/mcp") {
      if (req.method !== "POST") return new Response("Use POST.", { status: 405, headers: { allow: "POST, OPTIONS", ...CORS } });
      const meta = `${origin}/.well-known/oauth-protected-resource`;
      const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") || "")?.[1];
      const rec = token ? await get(`at:${await sha256(token)}`) : null;
      const gt = rec && (await unseal(env.TOKEN_KEY, rec.grant));
      if (!gt || (gt.exp && gt.exp <= now())) return json({ error: "invalid_token", error_description: "Sign in to the connector." }, 401, { "www-authenticate": `Bearer resource_metadata="${meta}"${token ? ', error="invalid_token"' : ""}, scope="${SCOPE}"` });
      let body;
      try { body = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
      const handlers = readHandlers(githubStore(gt.t, { fetch, now }));
      const out = [];
      for (const m of Array.isArray(body) ? body : [body]) { const r = await handle(m, handlers, READ_TOOLS); if (r) out.push(r); }
      if (!out.length) return new Response(null, { status: 202, headers: CORS });
      return json(Array.isArray(body) ? out : out[0]);
    }

    if (path === "/" && req.method === "GET") return page("seo-autopilot connector", `<h1>seo-autopilot connector</h1><p>Add <code>${esc(origin)}/mcp</code> as a custom connector in Claude or ChatGPT to ask about the SEO reports in your website's repository.${env.GITHUB_APP_SLUG ? ` First <a href="https://github.com/apps/${esc(env.GITHUB_APP_SLUG)}/installations/new">install the GitHub App</a> on that repository.` : ""}</p><p>Open source: <a href="https://github.com/bishal-paul-git/seo-autopilot">github.com/bishal-paul-git/seo-autopilot</a>.</p>`);
    return json({ error: "not_found" }, 404);

    async function issue(rec, gt) {
      const at = randomToken(), rt = randomToken();
      const ttl = gt?.exp ? Math.min(TTL.access, Math.floor((gt.exp - now()) / 1000)) : TTL.access;
      const keep = { client_id: rec.client_id, login: rec.login, scope: rec.scope, grant: rec.grant };
      await put(`at:${await sha256(at)}`, keep, ttl);
      await put(`rt:${await sha256(rt)}`, keep, gt?.rexp ? Math.min(TTL.refresh, (gt.rexp - now()) / 1000) : TTL.refresh);
      return json({ access_token: at, token_type: "Bearer", expires_in: Math.max(60, ttl), refresh_token: rt, scope: rec.scope });
    }
  };

  // GitHub's token endpoint: a new user token from a code, or from a GitHub refresh token. Returns { t, exp, r, rexp } or null.
  async function githubToken(fetchFn, env, params) {
    const r = await fetchFn(`${GITHUB}/login/oauth/access_token`, { method: "POST", headers: { accept: "application/json", "content-type": "application/json", "user-agent": "seo-autopilot-connector" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }) }).catch(() => null);
    const b = r?.ok ? await r.json().catch(() => null) : null;
    if (!b?.access_token) return null;
    const t = now();
    return { t: b.access_token, exp: b.expires_in ? t + b.expires_in * 1000 : null, r: b.refresh_token || null, rexp: b.refresh_token_expires_in ? t + b.refresh_token_expires_in * 1000 : null };
  }
}

const app = makeApp();
export default { fetch: (req, env) => app(req, env) };
