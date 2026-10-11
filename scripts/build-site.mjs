// Builds the demo dashboard for the landing site from SAMPLE data (clearly labelled, not a real website).
//   node scripts/build-site.mjs        writes site/demo/index.html
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { renderDashboard } from "../src/jobs/dashboard.mjs";

const day = (n) => new Date(Date.UTC(2026, 9, 1) + n * 864e5).toISOString().slice(0, 10);
const history = Array.from({ length: 28 }, (_, i) => ({
  day: day(i), clicks: Math.round(4 + i * 0.9 + (i % 5)), impressions: Math.round(180 + i * 31 + (i % 7) * 9), position: Number((34 - i * 0.35).toFixed(1)),
  inspected: 60, indexed: 20 + Math.floor(i * 1.2), notIndexed: 40 - Math.floor(i * 1.2),
}));
const inspect = {};
const cov = ["Submitted and indexed", "Submitted and indexed", "Submitted and indexed", "Discovered - currently not indexed", "URL is unknown to Google", "Crawled - currently not indexed"];
for (let i = 0; i < 24; i++) inspect[`https://example.com/${["guides", "services", "blog", "use-cases"][i % 4]}/sample-page-${i + 1}`] = { coverage: cov[i % cov.length], checkedAt: "2026-10-28T05:17:00Z" };

const data = {
  site: { id: "sample", name: "SAMPLE DATA: Example Co (not a real site)", url: "https://example.com/", property: "https://example.com/" },
  generated: "sample",
  history, inspect,
  backlog: {
    "how to choose a crm": { query: "how to choose a crm", kinds: ["question", "uncovered"], impressions: 41, position: 18.2, status: "proposed", score: 41 },
    "crm for small teams": { query: "crm for small teams", kinds: ["near-miss"], impressions: 33, position: 11.4, status: "new", score: 49 },
    "crm data migration checklist": { query: "crm data migration checklist", kinds: ["rising", "uncovered"], impressions: 18, position: 24.0, status: "new", score: 27 },
  },
  backlinks: [
    { name: "Example Directory A", submit_url: "https://example.com/a", mode: "manual", status: "done", attempts: 0, note: "Listed by hand." },
    { name: "Example Directory B", submit_url: "https://example.com/b", mode: "manual", status: "manual", attempts: 0, note: "Needs an account. Do by hand." },
    { name: "Example Directory C", submit_url: "https://example.com/c", mode: "auto", status: "needs_human", attempts: 1, note: "Bot check on page. Left for a person." },
  ],
  digest: "# Example Co SEO weekly digest (sample)\n\n- Clicks: 63 (+24%)\n- Impressions: 1,204 (+31%)\n- Average position: 24.1 (was 27.6)\n\n## What to do next\n- Request indexing by hand for the 10 pages in the list above.\n- 2 topic proposals are waiting for your approval.\n",
  news: "# News and trends (sample)\n\n- A platform changed how it reports a metric (score 8)\n  https://example.com/news/1\n",
  pipeline: { tracked: true, liveThisWeek: 3, upcoming: 6, queued: 1, held: 0, schedule: [
    { date: "2026-11-02", title: "How to choose a CRM", url: "https://example.com/blog/how-to-choose-a-crm" },
    { date: "2026-11-02", title: "CRM data migration checklist", url: "https://example.com/blog/crm-data-migration-checklist" },
    { date: "2026-11-03", title: "CRM for small teams", url: "https://example.com/blog/crm-for-small-teams" },
  ] },
};

let html = renderDashboard(data).replace("<title>SEO dashboard</title>", "<title>seo-autopilot dashboard (sample data)</title>")
  .replace("<main id=\"app\"><p>Loading…</p></main>", "<div style=\"background:#14120e;color:#f3efe7;padding:10px 16px;font:14px system-ui\">This is a <b>demo with sample data</b>, not a real website. <a style=\"color:#10b981\" href=\"../\">Back to seo-autopilot</a></div><main id=\"app\"><p>Loading…</p></main>");
const out = fileURLToPath(new URL("../site/demo/index.html", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out}`);
