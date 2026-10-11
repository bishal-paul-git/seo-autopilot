import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = () => mkdtempSync(join(tmpdir(), "seo-ui-"));

// Point the registry at a throw-away folder BEFORE importing the modules.
process.env.SEO_AUTOPILOT_HOME = tmp();
const { addProject, listSites, removeProject, getSettings, saveSettings } = await import("../src/core/projects.mjs");
const { createApp, ALLOWED_JOBS } = await import("../src/ui/server.mjs");

function makeProject() {
  const d = tmp();
  writeFileSync(join(d, "seo-autopilot.config.json"), JSON.stringify({ sites: [{ id: "demo", name: "Demo", url: "https://demo.test/", searchConsoleProperty: "https://demo.test/", sitemap: "https://demo.test/sitemap.xml" }] }));
  mkdirSync(join(d, ".seo-autopilot/demo"), { recursive: true });
  writeFileSync(join(d, ".seo-autopilot/demo/history.json"), JSON.stringify([{ day: "2026-10-01", clicks: 3, impressions: 40, position: 12.5 }]));
  writeFileSync(join(d, ".seo-autopilot/demo/inspect-state.json"), JSON.stringify({ results: { "https://demo.test/": { coverage: "Submitted and indexed", checkedAt: "2026-10-01T00:00:00Z" } } }));
  return d;
}

test("projects registry adds, lists and removes, and refuses folders without a config", () => {
  const d = makeProject();
  assert.throws(() => addProject(tmp()), /seo-autopilot init/);
  addProject(d); addProject(d);
  const { sites } = listSites();
  assert.equal(sites.length, 1);
  assert.equal(sites[0].site.name, "Demo");
  removeProject(d);
  assert.equal(listSites().sites.length, 0);
});

test("settings store only the key file path", () => {
  assert.deepEqual(saveSettings({ googleKeyFile: "/keys/a.json", secret: "nope" }), { googleKeyFile: "/keys/a.json" });
  assert.equal(getSettings().googleKeyFile, "/keys/a.json");
});

test("the app may not run backlink submissions or anything live", () => {
  assert.ok(!("backlinks" in ALLOWED_JOBS));
  assert.ok(!Object.values(ALLOWED_JOBS).flat().includes("--live"));
  for (const j of ["indexing-queue", "schedule", "release", "indexnow"]) assert.deepEqual(ALLOWED_JOBS[j], ["--dry"]);
});

function call(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, text: t }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

test("the local server enforces token, host and origin, and serves project data", async () => {
  const d = makeProject(); addProject(d);
  const token = "t".repeat(48);
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  server.on("request", createApp({ token, port }));
  try {
    assert.equal((await call(port, "/")).status, 403, "page needs the token");
    assert.equal((await call(port, `/?token=${token}`)).status, 200);
    assert.equal((await call(port, "/api/projects")).status, 401, "api needs the token");
    assert.equal((await call(port, "/api/projects", { headers: { "x-ui-token": "wrong" } })).status, 401);
    assert.equal((await call(port, "/api/projects", { headers: { "x-ui-token": token, Host: "evil.example" } })).status, 403, "foreign host refused");
    const list = JSON.parse((await call(port, "/api/projects", { headers: { "x-ui-token": token } })).text);
    assert.equal(list.sites[0].name, "Demo");
    const id = list.sites[0].id;
    const data = JSON.parse((await call(port, `/api/site/${id}/data`, { headers: { "x-ui-token": token } })).text);
    assert.equal(data.history[0].clicks, 3);
    assert.equal(Object.keys(data.inspect).length, 1);
    const bad = await call(port, `/api/site/${id}/run`, { method: "POST", headers: { "x-ui-token": token, "Content-Type": "application/json" }, body: { job: "backlinks" } });
    assert.equal(bad.status, 400, "unlisted job refused");
    const cross = await call(port, `/api/site/${id}/run`, { method: "POST", headers: { "x-ui-token": token, Origin: "https://evil.example", "Content-Type": "application/json" }, body: { job: "dashboard" } });
    assert.equal(cross.status, 403, "cross-site POST refused");
  } finally { server.close(); }
});
