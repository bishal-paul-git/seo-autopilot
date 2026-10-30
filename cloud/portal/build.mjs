// Builds the portal page: cloud/portal/app/index.html with the Supabase address, its publishable key and the agent
// roster filled in, written to cloud/portal/dist/ with a robots.txt that keeps it out of search. Both values are public
// (the publishable key only reaches what row level security allows). No dependencies.
//   PORTAL_SUPABASE_URL=https://<ref>.supabase.co PORTAL_SUPABASE_KEY=<publishable key> node cloud/portal/build.mjs [outDir]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, "../..");
const ORDER = ["command", "research", "content", "quality", "technical", "authority", "ai-search", "verticals"];
const NAMES = { "ai-search": "AI search" };

export function departments(dir = join(root, "departments")) {
  const out = {};
  for (const d of ORDER) {
    const p = join(dir, d, "agents");
    if (existsSync(p)) out[NAMES[d] || d[0].toUpperCase() + d.slice(1)] = readdirSync(p).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
  }
  return out;
}

export function build({ url = process.env.PORTAL_SUPABASE_URL || "", key = process.env.PORTAL_SUPABASE_KEY || "", out = join(here, "dist") } = {}) {
  if (url && !/^(https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)\/?$/.test(url)) throw new Error("PORTAL_SUPABASE_URL must be https://<project>.supabase.co");
  if (/service_role|^sb_secret_/.test(key)) throw new Error("Use the publishable (anon) key, never the service role or a secret key.");
  const cfg = JSON.stringify({ supabaseUrl: url.replace(/\/$/, ""), anonKey: key }).replace(/</g, "\\u003c");
  const html = readFileSync(join(here, "app/index.html"), "utf8").replace("__CONFIG__", cfg).replace("__DEPTS__", JSON.stringify(departments()));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.html"), html);
  writeFileSync(join(out, "robots.txt"), "User-agent: *\nDisallow: /\n");
  return { out, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build({ out: process.argv[2] ? resolve(process.argv[2]) : undefined });
  console.log(`portal: wrote ${r.out}/index.html (${Math.round(r.bytes / 1024)} KB)`);
}
