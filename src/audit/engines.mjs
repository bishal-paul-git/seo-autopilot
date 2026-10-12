// Optional fast crawl engine written in Go (engines/go). It does the fetching half of the audit with a worker pool and returns
// the same page records as the built-in Node crawler; the link graph and every audit rule still run in Node, so the findings
// are identical. Used when you ask for it (`--engine go`, or "audit": { "engine": "go" } in the config) or with "auto".
//
// Where the engine comes from, first match wins:
//   1. SEO_CRAWL_BIN                      an already built seo-crawl binary
//   2. engines/go/seo-crawl(.exe)         built next to the package
//   3. seo-crawl on your PATH
//   4. the Go toolchain on your PATH      runs `go run .` in engines/go (needs Go 1.21 or newer; GitHub's Ubuntu runners have it)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GO_DIR = fileURLToPath(new URL("../../engines/go/", import.meta.url));
const exe = process.platform === "win32" ? ".exe" : "";

const works = (cmd, args = ["--version"]) => { const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 20000 }); return !r.error && r.status === 0; };

/** How to start the Go crawler on this machine, or null. */
export function findGoEngine() {
  if (process.env.SEO_CRAWL_BIN && existsSync(process.env.SEO_CRAWL_BIN)) return { cmd: process.env.SEO_CRAWL_BIN, args: [], cwd: process.cwd(), how: "SEO_CRAWL_BIN" };
  const built = join(GO_DIR, `seo-crawl${exe}`);
  if (existsSync(built)) return { cmd: built, args: [], cwd: process.cwd(), how: "built binary" };
  if (works("seo-crawl")) return { cmd: "seo-crawl", args: [], cwd: process.cwd(), how: "PATH" };
  if (existsSync(join(GO_DIR, "main.go")) && works("go", ["version"])) return { cmd: "go", args: ["run", "."], cwd: GO_DIR, how: "go run" };
  return null;
}

/** Run the crawler and return what crawlSite returns: { pages, ctx }. The link graph is added by the caller. */
export async function crawlWithGo(site, opts = {}) {
  const eng = findGoEngine();
  if (!eng) throw new Error("no Go engine available");
  const dir = mkdtempSync(join(tmpdir(), "seo-crawl-"));
  const out = join(dir, "crawl.json");
  const args = [...eng.args, "--url", site.url, "--sitemap", site.sitemap, "--out", out, "--max-pages", String(opts.maxPages ?? site.audit?.maxPages ?? 300), "--concurrency", String(opts.concurrency ?? site.audit?.concurrency ?? 8)];
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(eng.cmd, args, { cwd: eng.cwd, stdio: ["ignore", "inherit", "pipe"] });
      let err = "";
      child.stderr.on("data", (d) => { err += d; });
      const timer = setTimeout(() => { child.kill(); reject(new Error("the Go crawler took longer than 20 minutes")); }, 20 * 60 * 1000);
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`seo-crawl exited with ${code}: ${err.trim().slice(0, 300)}`)); });
    });
    const j = JSON.parse(readFileSync(out, "utf8"));
    console.log(`audit: crawled ${j.pages.length} pages with the Go engine (${eng.how}) in ${Math.round(j.seconds)}s`);
    return {
      pages: j.pages,
      ctx: { robotsTxt: j.robotsTxt, sitemapUrls: j.sitemapUrls || [], brokenTargets: new Map(Object.entries(j.brokenTargets || {}).map(([u, s]) => [u, s])), siteHost: new URL(site.url).host },
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
