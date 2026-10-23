// MCP server: lets an AI assistant (Claude Desktop, Claude Code, ChatGPT or any MCP client) read this project's SEO reports
// and run its analysis jobs. Dependency-free: newline-delimited JSON-RPC 2.0 over stdio, per the Model Context Protocol.
//   seo-autopilot mcp [--project <folder>]
//
// The protocol and the read tools live in ./core.mjs, shared with the hosted connector (cloud/connector).
// Safety: read-only by default. Tools read files inside the state folder only (no path escapes). run_job runs only analysis
// jobs from a fixed allowlist, as a child process of this CLI with no shell; jobs that publish, open issues, submit or
// merge are not exposed. Jobs that spend the user's paid API credits need confirm_cost: true. Report text is data from
// the web and from search engines: the server tells the client so, and never follows it.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, pickSites } from "../core/config.mjs";
import { fail, handle as coreHandle, READ_TOOLS, readHandlers, S, text } from "./core.mjs";

const CLI = fileURLToPath(new URL("../../bin/seo-autopilot.mjs", import.meta.url));

// Analysis jobs only. Each writes reports into the state folder and changes nothing on the site or on GitHub.
export const SAFE_JOBS = {
  audit: "Crawl the site and report technical and on-page issues",
  links: "Internal links to add for weakly linked pages",
  linkgraph: "Internal PageRank, click depth, orphans and under-linked pages",
  quality: "Top query vs title, H1 and description; headings per section",
  facts: "Claims that need a verified fact or a source",
  priorities: "Ranked list of what to do (report only)",
  team: "Which agents to run next (report only with dry)",
  experiments: "Evaluate logged experiments",
  profile: "Detect the platform and edit or advise mode",
  keywords: "Keyword explorer (positional: seed terms)",
  rank: "Rank tracker from Search Console",
  gap: "Competitor and keyword gap",
  optimize: "Score a page or draft against top results (flags: query, url or file, compare)",
  authority: "Backlink and authority profile",
  forecast: "Is traffic inside its normal range (Python)",
  vitals: "Real-user Core Web Vitals history (CrUX)",
  schema: "Structured data suggestions and checks",
  changes: "What changed on watched pages since last time",
  entity: "How Google's Knowledge Graph and Wikidata see the business",
  local: "Local business: name, address and phone consistency, location pages (local pack)",
  shop: "Online shop: Product markup and prices, stock, categories, filter-parameter crawl traps (e-commerce pack)",
  speed: "PageSpeed Insights for top pages",
  consent: "Consent and measurement check",
  ymyl: "Sensitive-topic review gate",
};
const DRY_JOBS = new Set(["team", "priorities"]);
// Jobs that call paid APIs when their keys are set.
export const COSTLY = new Set(["ai-visibility", "citations"]);
const RUNNABLE = { ...SAFE_JOBS, "ai-visibility": "Ask AI engines your questions (paid API calls)", citations: "Search and AI citations for your questions (SERP credits)" };

/** A file inside the state folder, or null when the name would leave it. */
export function safePath(stateDir, file) {
  const p = resolve(stateDir, String(file || ""));
  return p.startsWith(resolve(stateDir) + sep) && existsSync(p) && statSync(p).isFile() ? p : null;
}

function listFiles(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name), base) : [relative(base, join(dir, e.name)).split(sep).join("/")]));
}

export const TOOLS = [...READ_TOOLS,
  { name: "run_job", description: `Run one analysis job and return its report. Allowed: ${Object.keys(RUNNABLE).join(", ")}. Jobs that call paid APIs (${[...COSTLY].join(", ")}) need confirm_cost: true. Nothing publishes or merges.`, inputSchema: { type: "object", properties: { job: S("Job name", { enum: Object.keys(RUNNABLE) }), args: { type: "array", items: { type: "string" }, description: "Positional arguments (for keywords: seed terms)" }, flags: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] }, description: "Flags such as {\"query\": \"...\", \"url\": \"...\"}" }, site: S("Site id"), confirm_cost: { type: "boolean" } }, required: ["job"] } },
];

/** Run one CLI job in a child process (no shell), capturing its output. */
export function runCli(cwd, job, { args = [], flags = {}, site, timeoutMs = 600000, node = process.execPath } = {}) {
  const argv = [CLI, "run", job, ...args.map(String)];
  for (const [k, v] of Object.entries(flags || {})) {
    if (!/^[a-z][a-z0-9-]*$/.test(k)) continue;
    if (v === true) argv.push(`--${k}`); else if (v !== false && v != null) argv.push(`--${k}`, String(v));
  }
  if (site) argv.push("--site", String(site));
  return new Promise((done) => {
    const child = spawn(node, argv, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (b) => { out += b; if (out.length > 400000) out = out.slice(-400000); });
    child.stderr.on("data", (b) => { err += b; });
    child.on("close", (code) => { clearTimeout(timer); done({ code, out, err }); });
  });
}

/** Reports on disk: the state folder of each site in this project. */
export function fileStore(cwd) {
  const cfg = () => loadConfig({ cwd });
  return {
    sites: async () => cfg().sites.map((s) => ({ id: s.id, name: s.name, url: s.url })),
    open: async (id) => {
      const s = pickSites(cfg(), id)[0], d = s.paths.state;
      return {
        site: { id: s.id, name: s.name, url: s.url },
        list: async () => { const now = Date.now(); return listFiles(d).map((f) => ({ file: f, ageHours: Math.round((now - statSync(join(d, f)).mtimeMs) / 36e5) })); },
        read: async (f) => { const p = safePath(d, f); return p ? readFileSync(p, "utf8") : null; },
      };
    },
  };
}

/** Handlers bound to one project folder: the shared read tools plus run_job. */
export function makeHandlers(cwd, { run = runCli } = {}) {
  return {
    ...readHandlers(fileStore(cwd)),
    run_job: async ({ job, args = [], flags = {}, site, confirm_cost = false }) => {
      if (!RUNNABLE[job]) return fail(`"${job}" is not available here. Allowed: ${Object.keys(RUNNABLE).join(", ")}.`);
      if (COSTLY.has(job) && !confirm_cost) return fail(`${job} calls paid APIs with the project's keys. Ask the user, then call again with confirm_cost: true.`);
      // These two can open a GitHub issue when a token is present; from an assistant they only write their report.
      const f = DRY_JOBS.has(job) ? { ...flags, dry: true } : flags;
      const r = await run(cwd, job, { args, flags: f, site });
      const body = `${r.out.trim()}${r.err.trim() ? `\n\n[stderr]\n${r.err.trim().slice(-4000)}` : ""}`;
      return r.code === 0 ? text(body || "(no output)") : fail(`${job} failed (exit ${r.code}).\n${body.slice(-8000)}`);
    },
  };
}

/** Handle one JSON-RPC message with this server's tools (the read tools and run_job). */
export const handle = (msg, handlers) => coreHandle(msg, handlers, TOOLS);

/** stdio loop. Logs go to stderr; stdout carries only protocol messages. */
export function serve({ cwd = process.cwd(), input = process.stdin, output = process.stdout } = {}) {
  const handlers = makeHandlers(cwd);
  let buf = "", queue = Promise.resolve();
  input.setEncoding("utf8");
  input.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      // One message at a time, in order: a slow job must not let a later reply overtake an earlier one.
      queue = queue.then(async () => {
        let msg;
        try { msg = JSON.parse(line); } catch { output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n"); return; }
        const res = await handle(msg, handlers);
        if (res) output.write(JSON.stringify(res) + "\n");
      });
    }
  });
  process.stderr.write(`seo-autopilot MCP server ready (${cwd})\n`);
  return () => queue;
}
