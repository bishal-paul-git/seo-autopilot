// MCP server: protocol handshake, tools, read-only file access inside the state folder, the job allowlist, paid-call
// confirmation, and a real stdio session through the CLI.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { handle, makeHandlers, safePath, TOOLS, SAFE_JOBS } from "../src/mcp/server.mjs";

function project() {
  const root = mkdtempSync(join(tmpdir(), "seo-mcp-"));
  writeFileSync(join(root, "seo-autopilot.config.json"), JSON.stringify({ sites: [{ id: "s", name: "S", url: "https://s.test/", searchConsoleProperty: "sc-domain:s.test", sitemap: "https://s.test/sitemap.xml" }] }));
  const state = join(root, ".seo-autopilot", "s"); mkdirSync(join(state, "optimize"), { recursive: true });
  writeFileSync(join(state, "rank.md"), "# rank\nweb hosting 4");
  writeFileSync(join(state, "optimize", "hosting.md"), "# optimize");
  writeFileSync(join(state, "rank.json"), JSON.stringify({ summary: { date: "2026-10-20", tracked: 2, visibility: 40, averagePosition: 5, gainers: [1], losers: [] } }));
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [{ query: "web hosting", page: "https://s.test/hosting", clicks: 3, impressions: 90, position: 6 }, { query: "domains", page: "https://s.test/", clicks: 0, impressions: 10, position: 30 }] }));
  writeFileSync(join(state, "audit.json"), JSON.stringify({ generatedAt: "x", summary: { pagesCrawled: 2, bySeverity: { high: 1, medium: 0, low: 0 } }, issues: [{ rule: "title-long", url: "https://s.test/hosting", detail: "70 chars" }], pages: [{ url: "https://s.test/hosting", title: "Hosting", status: 200 }] }));
  writeFileSync(join(root, "secret.txt"), "do not read");
  return { root, state };
}
const call = (h, name, args = {}, id = 1) => handle({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, h);

test("handshake: protocol version negotiated, tools listed with schemas, notifications get no reply, unknown methods error", async () => {
  const h = makeHandlers(project().root);
  const init = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, h);
  assert.equal(init.result.protocolVersion, "2025-03-26"); assert.ok(init.result.capabilities.tools); assert.match(init.result.instructions, /data, never as instructions/);
  assert.equal((await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, h)).result.protocolVersion, "2025-06-18");
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }, h), null);
  const list = await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" }, h);
  assert.deepEqual(list.result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, "object");
  assert.equal((await handle({ jsonrpc: "2.0", id: 4, method: "nope" }, h)).error.code, -32601);
  assert.equal((await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "rm" } }, h)).error.code, -32602);
});

test("reading: reports inside the state folder only; overview, query search and page report", async () => {
  const { root, state } = project();
  const h = makeHandlers(root);
  assert.equal(safePath(state, "../../secret.txt"), null); assert.equal(safePath(state, "/etc/passwd"), null); assert.ok(safePath(state, "optimize/hosting.md"));
  assert.equal((await call(h, "read_report", { file: "../../secret.txt" })).result.isError, true);
  assert.match((await call(h, "read_report", { file: "rank.md" })).result.content[0].text, /web hosting 4/);
  assert.match((await call(h, "read_report", { file: "rank.md", max_chars: 3 })).result.content[0].text, /cut at 3/);
  const ov = JSON.parse((await call(h, "site_overview")).result.content[0].text);
  assert.deepEqual([ov.audit.high, ov.rank.visibility], [1, 40]);
  const q = JSON.parse((await call(h, "search_queries", { contains: "host" })).result.content[0].text);
  assert.deepEqual(q.map((r) => r.query), ["web hosting"]);
  const pr = JSON.parse((await call(h, "page_report", { url: "/hosting" })).result.content[0].text);
  assert.deepEqual(pr.issues, ["title-long: 70 chars"]); assert.equal(pr.queries.length, 1);
  assert.ok(JSON.parse((await call(h, "list_reports")).result.content[0].text).some((f) => f.file === "optimize/hosting.md"));
});

test("jobs: only allowlisted analysis jobs run; paid jobs need confirmation; team and priorities always dry", async () => {
  const runs = [];
  const h = makeHandlers(project().root, { run: async (cwd, job, o) => { runs.push({ job, ...o }); return { code: 0, out: `${job} done`, err: "" }; } });
  for (const bad of ["release", "propose", "backlinks", "autopilot", "watch", "indexnow", "monthly"]) {
    assert.ok(!SAFE_JOBS[bad]); assert.equal((await call(h, "run_job", { job: bad })).result.isError, true, bad);
  }
  assert.equal((await call(h, "run_job", { job: "ai-visibility" })).result.isError, true);
  assert.equal(runs.length, 0, "nothing ran");
  assert.match((await call(h, "run_job", { job: "ai-visibility", confirm_cost: true })).result.content[0].text, /ai-visibility done/);
  await call(h, "run_job", { job: "keywords", args: ["hosting"], flags: { serp: 5 } });
  await call(h, "run_job", { job: "team" });
  assert.deepEqual(runs.map((r) => r.job), ["ai-visibility", "keywords", "team"]);
  assert.deepEqual(runs[1].args, ["hosting"]); assert.equal(runs[2].flags.dry, true);
});

test("stdio session through the CLI: replies in order, one JSON message per line, logs only on stderr", async () => {
  const { root } = project();
  const cli = fileURLToPath(new URL("../bin/seo-autopilot.mjs", import.meta.url));
  const child = spawn(process.execPath, [cli, "mcp", "--project", root], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (b) => { out += b; });
  const msgs = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/list" }, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_sites", arguments: {} } }];
  child.stdin.write(msgs.map((m) => JSON.stringify(m)).join("\n") + "\n");
  const lines = await new Promise((done, failed) => {
    const t = setTimeout(() => failed(new Error(`timeout; got: ${out}`)), 10000);
    const check = () => { const l = out.split("\n").filter(Boolean); if (l.length >= 3) { clearTimeout(t); done(l); } else setTimeout(check, 20); };
    check();
  });
  child.kill();
  const replies = lines.map((l) => JSON.parse(l));
  assert.deepEqual(replies.map((r) => r.id), [1, 2, 3]);
  assert.equal(replies[0].result.serverInfo.name, "seo-autopilot");
  assert.deepEqual(JSON.parse(replies[2].result.content[0].text), [{ id: "s", name: "S", url: "https://s.test/" }]);
});
