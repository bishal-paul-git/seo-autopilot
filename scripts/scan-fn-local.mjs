#!/usr/bin/env node
// Runs the Supabase `scan` Edge Function in Deno (the runtime Supabase Edge Functions use) in job mode against a real
// website, with a stand-in for the database RPCs. Checks: the secret is enforced, one site is scanned and returned in
// compact form, the snapshot is handed to finish_scan for the portal, bad input is refused. Needs a deno binary:
//   node cloud/portal/build-scan.mjs && DENO=/path/to/deno node scripts/scan-fn-local.mjs https://example.com
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] || "https://erudience.com/";
const SECRET = "local-scan-secret", KEY = "local-service-key";
const check = (ok, msg) => { if (!ok) throw new Error(`FAILED: ${msg}`); console.log(`ok - ${msg}`); };
const rpcCalls = [];
const db = createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c;
  const fn = req.url.split("/").pop(); rpcCalls.push({ fn, body: b ? JSON.parse(b) : {}, key: req.headers.authorization });
  const out = fn === "scan_secret_ok" ? JSON.parse(b).p_secret === SECRET : fn === "finish_scan" ? null : null;
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
});
await new Promise((r) => db.listen(0, "127.0.0.1", r));
const PORT = 18900 + (process.pid % 500);
const deno = spawn(process.env.DENO || "deno", ["run", "--allow-net", "--allow-env", "--allow-read", join(root, "cloud/portal/supabase/functions/scan/index.ts")], {
  env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${db.address().port}`, SUPABASE_SERVICE_ROLE_KEY: KEY, DENO_SERVE_ADDRESS: `tcp:127.0.0.1:${PORT}`, DENO_CERT: process.env.NODE_EXTRA_CA_CERTS || "", NO_PROXY: "127.0.0.1,localhost" },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = ""; deno.stdout.on("data", (d) => (log += d)); deno.stderr.on("data", (d) => (log += d));
const F = `http://127.0.0.1:${PORT}`;
const post = (body, secret = SECRET) => fetch(F, { method: "POST", headers: { "content-type": "application/json", "x-scan-secret": secret }, body: JSON.stringify(body) });
try {
  for (let i = 0; i < 60; i++) { try { await fetch(F); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
  check((await post({ mode: "job", site: { id: "s1", url } }, "wrong")).status === 403, "wrong secret refused");
  check((await post({ mode: "job", site: { id: 1 } })).status === 400, "malformed site refused");
  const t0 = Date.now(), r = await post({ mode: "job", site: { id: "s1", name: "test", url }, maxPages: 999 }), body = await r.json();
  check(r.status === 200 && body.ok, `job mode scanned ${url} in ${Date.now() - t0} ms`);
  check(body.audit.summary.pagesCrawled > 0 && body.audit.summary.pagesCrawled <= 40, `page cap enforced (${body.audit.summary.pagesCrawled} pages, asked for 999)`);
  check(body.discovered && body.profile && Array.isArray(body.audit.issues) && body.audit.pages.length === 0, "compact result: discovered, profile, issues, no page bodies");
  check(body.snapshotStored === true && rpcCalls.some((c) => c.fn === "finish_scan" && c.body.p_site === "s1" && c.body.p_data), "snapshot handed to finish_scan for the portal");
  check(rpcCalls.every((c) => c.key === `Bearer ${KEY}`), "every database call used the service key");
  console.log(`response size ${JSON.stringify(body).length} bytes`);
  const internal = await post({ mode: "job", site: { id: "s2", url: "http://127.0.0.1:8080/" } });
  check(internal.status === 422, "an internal address is refused by the guarded fetch");
  console.log("scan function job mode checks passed in Deno");
} catch (e) { console.error(log.slice(-2000)); throw e; } finally { deno.kill(); db.close(); }
