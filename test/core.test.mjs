import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globToRegExp, findFiles, clean, addDays } from "../src/core/util.mjs";
import { validate, loadConfig, CONFIG_NAME } from "../src/core/config.mjs";
import { parseArgs } from "../src/cli/args.mjs";
import { slugId, init } from "../src/cli/init.mjs";
import { renderDashboard } from "../src/jobs/dashboard.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "seo-ap-"));

test("globs match nested and flat paths", () => {
  assert.ok(globToRegExp("src/content/**/*.json").test("src/content/a/b/c.json"));
  assert.ok(globToRegExp("src/content/**/*.json").test("src/content/c.json"));
  assert.ok(!globToRegExp("src/content/*.json").test("src/content/a/c.json"));
  assert.ok(globToRegExp("content/**/*.md").test("content/blog/post.md"));
});

test("findFiles walks a folder and skips node_modules", () => {
  const d = tmp();
  mkdirSync(join(d, "content/a"), { recursive: true }); mkdirSync(join(d, "node_modules/x"), { recursive: true });
  writeFileSync(join(d, "content/a/one.json"), "[]"); writeFileSync(join(d, "node_modules/x/two.json"), "[]");
  const found = findFiles(d, ["**/*.json"]).map((f) => f.replace(d, "").replace(/\\/g, "/"));
  assert.deepEqual(found, ["/content/a/one.json"]);
});

test("clean strips risky characters and caps length", () => {
  assert.equal(clean("hello <script>alert(1)</script> world"), "hello script alert(1) /script world");
  assert.equal(clean("x".repeat(500), 10).length, 10);
});

test("addDays handles month ends", () => { assert.equal(addDays("2026-10-31", 1), "2026-11-01"); });

test("validate flags the common mistakes", () => {
  assert.ok(validate({}).length);
  const ok = { sites: [{ id: "a", url: "https://a.com/", searchConsoleProperty: "https://a.com/", sitemap: "https://a.com/sitemap.xml" }] };
  assert.deepEqual(validate(ok), []);
  const bad = { sites: [{ id: "A B", url: "http://a.com", searchConsoleProperty: "", sitemap: "x", content: { type: "json" } }] };
  const errs = validate(bad).join("\n");
  assert.match(errs, /lowercase/); assert.match(errs, /https/); assert.match(errs, /slash/); assert.match(errs, /searchConsoleProperty/); assert.match(errs, /include/);
});

test("init scaffolds files, never overwrites, and loadConfig reads the result", async () => {
  const d = tmp();
  await init({ cwd: d, flags: { url: "https://www.example.com", name: "Example", spec: "github:me/seo-autopilot#v2" }, interactive: false });
  const cfg = loadConfig({ cwd: d });
  assert.equal(cfg.sites[0].id, "example-com");
  assert.equal(cfg.sites[0].url, "https://www.example.com/");
  assert.match(readFileSync(join(d, ".github/workflows/seo-daily.yml"), "utf8"), /github:me\/seo-autopilot#v2/);
  assert.ok(!readFileSync(join(d, ".github/workflows/seo-daily.yml"), "utf8").includes("{{SPEC}}"));
  writeFileSync(join(d, CONFIG_NAME), JSON.stringify({ ...JSON.parse(readFileSync(join(d, CONFIG_NAME), "utf8")), marker: 1 }));
  await init({ cwd: d, flags: { url: "https://www.example.com" }, interactive: false });
  assert.equal(JSON.parse(readFileSync(join(d, CONFIG_NAME), "utf8")).marker, 1, "existing config is kept");
  assert.match(readFileSync(join(d, ".gitignore"), "utf8"), /\.seo-autopilot\//);
});

test("init needs an https URL", async () => {
  await assert.rejects(() => init({ cwd: tmp(), flags: { url: "http://x.com" }, interactive: false }), /https/);
  await assert.rejects(() => init({ cwd: tmp(), flags: {}, interactive: false }), /Missing --url/);
  assert.equal(slugId("https://www.My-Site.co.uk/"), "my-site-co-uk");
});

test("parseArgs handles flags, values and positionals", () => {
  const { flags, positional } = parseArgs(["mark", "uneed", "done", "--site", "a", "--dry", "--per-day=2"]);
  assert.deepEqual(positional, ["mark", "uneed", "done"]);
  assert.deepEqual(flags, { site: "a", dry: true, "per-day": "2" });
});

test("dashboard embeds data safely", () => {
  const html = renderDashboard({ site: { id: "a", name: "A </script><b>", url: "https://a.com/", property: "https://a.com/" }, generated: "2026-10-11", history: [], inspect: {}, backlog: {}, backlinks: [], digest: "", news: "", pipeline: { tracked: false, schedule: [] } });
  assert.ok(html.includes("<!doctype html>"));
  assert.ok(!html.includes("</script><b>"), "script-closing text in data must be escaped");
  assert.ok(html.includes("\\u003c/script>"));
});
