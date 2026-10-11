// Release check: which pages are due (publishAt reached) but not yet live on the site? A static site only includes
// scheduled pages when it is built, so on a day with nothing else to deploy nothing would rebuild and the page would
// wait. This job finds due-but-missing pages and, if you set site.release.deployHookEnv, pings that deploy hook to
// rebuild. Without a hook the workflow pushes an empty commit instead (your host rebuilds on push).
//   Prints  due=N  and, inside GitHub Actions, writes it to the step output "due".
import { loadPages } from "../adapters/index.mjs";
import { today } from "../core/util.mjs";

export const description = "Find pages that are due but not yet live, and trigger a rebuild (deploy hook or empty commit)";

export async function run({ site, flags }) {
  const pages = await loadPages(site);
  const day = today();
  let live = new Set();
  try {
    const xml = await (await fetch(site.sitemap)).text();
    live = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/\/$/, "")));
  } catch { /* sitemap unreachable: treat everything as not live */ }
  const due = pages.filter((p) => p.publishAt && String(p.publishAt).slice(0, 10) <= day && !p.queued && !p.hold && p.url && !live.has(p.url.replace(/\/$/, "")));
  for (const p of due) console.log(`due: ${p.url} (publishAt ${String(p.publishAt).slice(0, 10)})`);
  console.log(`due=${due.length}`);
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `due=${due.length}\n`);
  }
  const hookEnv = site.release?.deployHookEnv;
  if (due.length && hookEnv && process.env[hookEnv] && !flags.dry) {
    const r = await fetch(process.env[hookEnv], { method: "POST" });
    console.log(`deploy hook: HTTP ${r.status}`);
  }
}
