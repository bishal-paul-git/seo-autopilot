// Local management app for seo-autopilot: one page to see and manage every project on this computer.
//   npx seo-autopilot ui            (prints a private link, opens nothing unless you pass --open)
//
// Safety design:
//  - Listens on 127.0.0.1 only. Nothing leaves your computer except what the jobs themselves fetch.
//  - Every request needs a random token generated at start-up (in the link it prints). Requests whose Host or Origin is not
//    this local address are refused, which blocks DNS-rebinding and cross-site requests from other web pages.
//  - It can only run a fixed list of jobs, never backlinks submission and never anything with --live.
//  - It never stores secrets. The settings file holds only the PATH of your Google key file.
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { listSites, findSite, addProject, removeProject, getSettings, saveSettings } from "../core/projects.mjs";
import { collectSiteData } from "../core/collect.mjs";
import { restore } from "../cli/state.mjs";

const BIN = fileURLToPath(new URL("../../bin/seo-autopilot.mjs", import.meta.url));
const APP = fileURLToPath(new URL("./app.html", import.meta.url));

/** Jobs the app may start, and the flags it forces. Anything else is refused. */
export const ALLOWED_JOBS = {
  dashboard: [],
  audit: [],
  analyze: [],
  speed: [],
  deepdive: [],
  geo: [],
  quality: [],
  links: [],
  priorities: ["--dry"],
  "indexing-queue": ["--dry"],
  schedule: ["--dry"],
  release: ["--dry"],
  indexnow: ["--dry"],
  daily: [],
  research: [],
  digest: [],
  news: [],
  propose: [],
  mentions: [],
  "backlinks-queue": [],
};
const NEEDS_GOOGLE = new Set(["daily", "research", "digest"]);

const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const json = (res, body, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };

export function createApp({ token, port }) {
  const hostOk = (h) => [`127.0.0.1:${port}`, `localhost:${port}`].includes(String(h || ""));
  const originOk = (o) => !o || [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(o);

  async function readBody(req) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > 100_000) throw new Error("body too large"); chunks.push(c); }
    const t = Buffer.concat(chunks).toString("utf8");
    return t ? JSON.parse(t) : {};
  }

  function runJob(entry, job, extra = []) {
    const settings = getSettings();
    const env = { ...process.env };
    if (settings.googleKeyFile && !env.GOOGLE_KEY_FILE) env.GOOGLE_KEY_FILE = settings.googleKeyFile;
    if (NEEDS_GOOGLE.has(job) && !env.GOOGLE_KEY_FILE && !env.GOOGLE_KEY_JSON) return Promise.resolve({ ok: false, output: "This job reads Google. Set the path to your service-account key file under Settings first." });
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [BIN, "run", job, "--site", entry.siteId, ...ALLOWED_JOBS[job], ...extra], { cwd: entry.root, env });
      let out = "";
      const add = (d) => { out += d; if (out.length > 200_000) out = out.slice(-200_000); };
      child.stdout.on("data", add); child.stderr.on("data", add);
      const timer = setTimeout(() => child.kill(), 10 * 60 * 1000);
      child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: out.trim() }); });
      child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, output: e.message }); });
    });
  }

  function inbox(entry) {
    const labels = ["seo-topic", "seo-proposal", "seo-indexing", "seo-backlink", "seo-digest", "seo-priorities"];
    const r = spawnSync("gh", ["issue", "list", "--state", "open", "--limit", "60", "--json", "number,title,url,labels,createdAt"], { cwd: entry.root, encoding: "utf8", timeout: 30000 });
    if (r.error || r.status !== 0) return { error: "GitHub CLI not available or not signed in here. Install it from cli.github.com and run `gh auth login` to see approvals in this app.", items: [] };
    const all = JSON.parse(r.stdout || "[]");
    const items = all.filter((i) => i.labels.some((l) => labels.includes(l.name))).map((i) => ({ number: i.number, title: i.title, url: i.url, createdAt: i.createdAt, kind: i.labels.map((l) => l.name).find((n) => labels.includes(n)) }));
    return { items };
  }

  return async function handle(req, res) {
    try {
      if (!hostOk(req.headers.host)) return json(res, { error: "bad host" }, 403);
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      const supplied = req.headers["x-ui-token"] || url.searchParams.get("token");

      if (url.pathname === "/" && req.method === "GET") {
        if (!supplied || !same(supplied, token)) { res.writeHead(403, { "Content-Type": "text/plain" }); return res.end("Open the private link printed by `seo-autopilot ui`."); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
        return res.end(readFileSync(APP, "utf8").replace("__TOKEN__", token));
      }
      if (!url.pathname.startsWith("/api/")) return json(res, { error: "not found" }, 404);
      if (!supplied || !same(supplied, token)) return json(res, { error: "unauthorized" }, 401);
      if (req.method !== "GET" && !originOk(req.headers.origin)) return json(res, { error: "bad origin" }, 403);

      const parts = url.pathname.split("/").filter(Boolean); // api, ...
      if (parts[1] === "projects" && req.method === "GET" && parts.length === 2) {
        const { sites, problems } = listSites();
        return json(res, { sites: sites.map((s) => ({ id: s.id, name: s.site.name, url: s.site.url, repo: s.repo, root: s.root })), problems, settings: getSettings() });
      }
      if (parts[1] === "projects" && req.method === "POST") { const b = await readBody(req); return json(res, { root: addProject(b.path) }); }
      if (parts[1] === "projects" && req.method === "DELETE") { const b = await readBody(req); removeProject(b.path); return json(res, { ok: true }); }
      if (parts[1] === "settings" && req.method === "POST") { return json(res, saveSettings(await readBody(req))); }

      if (parts[1] === "site" && parts[2]) {
        const entry = findSite(parts[2]);
        if (!entry) return json(res, { error: "unknown project" }, 404);
        const action = parts[3];
        if (action === "data" && req.method === "GET") return json(res, await collectSiteData(entry.site));
        if (action === "inbox" && req.method === "GET") return json(res, inbox(entry));
        if (action === "sync" && req.method === "POST") {
          try { const lines = []; const log = console.log; console.log = (m) => lines.push(String(m)); try { restore({ cwd: entry.root }); } finally { console.log = log; } return json(res, { ok: true, output: lines.join("\n") }); }
          catch (e) { return json(res, { ok: false, output: e.message }); }
        }
        if (action === "run" && req.method === "POST") {
          const b = await readBody(req);
          if (!Object.hasOwn(ALLOWED_JOBS, b.job)) return json(res, { error: `job not allowed: ${String(b.job).slice(0, 40)}` }, 400);
          return json(res, await runJob(entry, b.job));
        }
      }
      return json(res, { error: "not found" }, 404);
    } catch (e) { return json(res, { error: String(e.message || e).slice(0, 300) }, 500); }
  };
}

export async function startUi({ port = 4747, open = false } = {}) {
  const token = randomBytes(24).toString("hex");
  const server = createServer(createApp({ token, port }));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const link = `http://127.0.0.1:${port}/?token=${token}`;
  console.log(`seo-autopilot app running (this computer only)\n\n  ${link}\n\nKeep this link private. Press Ctrl+C to stop.`);
  if (open) {
    const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", link]] : process.platform === "darwin" ? ["open", [link]] : ["xdg-open", [link]];
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
  }
  return { server, link, token };
}
