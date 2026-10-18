// Builds the demo dashboard for the landing site from SAMPLE data (clearly labelled, not a real website).
//   node scripts/build-site.mjs        writes site/demo/index.html
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { renderDashboard } from "../src/jobs/dashboard.mjs";
import { RULES } from "../src/audit/rules.mjs";
import { markdown, frontMatter, inline } from "./md.mjs";
import { listAgents, DEPARTMENTS } from "../src/core/agents.mjs";

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

// Sample expert-layer data (clearly part of the labelled demo; the example.com site does not exist).
const ex = (u, detail) => ({ url: `https://example.com${u}`, detail });
const rule = (id, count, examples) => ({ rule: id, severity: RULES[id].severity, title: RULES[id].title, why: RULES[id].why, fix: RULES[id].fix, count, examples });
Object.assign(data, {
  priorities: [
    { rank: 1, title: "Fix 3 pages that redirect through a chain", type: "audit", score: 38, effort: "S", confidence: "high", why: RULES["redirect-chain"].why, how: RULES["redirect-chain"].fix, evidence: ["3 sample pages with 2 hops each"] },
    { rank: 2, title: "Rewrite the title and description of 'crm for small teams' (position 11.4)", type: "striking-distance", score: 24, effort: "S", confidence: "medium", why: "The page already ranks near the first page; a clearer snippet is the cheapest way to earn more of the impressions it gets.", how: "Lead with the query, state what the reader gets, log the change in the experiments file.", evidence: ["33 impressions, average position 11.4", "estimated 4 extra clicks a month (from this site's own click-through data)"] },
    { rank: 3, title: "Two pages compete for 'crm migration checklist'", type: "cannibalization", score: 19, effort: "M", confidence: "medium", why: "When two of your pages target one query they split the signals and neither ranks as well as one stronger page would.", how: "Pick the stronger page, merge the useful parts of the other into it, and redirect the weaker URL.", evidence: ["/guides/crm-migration and /blog/crm-data-migration-checklist both appear for it"] },
    { rank: 4, title: "Allow AI search crawlers that are currently blocked", type: "ai-search", score: 17, effort: "S", confidence: "low", why: "Blocked crawlers cannot fetch your pages to answer a user's question, so you cannot be cited by those products.", how: "Allow these in robots.txt unless blocking is a deliberate choice.", evidence: ["PerplexityBot (Perplexity)"] },
  ],
  audit: { generatedAt: "sample", summary: { pagesCrawled: 86, bySeverity: { high: 1, medium: 4, low: 9 } }, opportunities: [], rules: [
    rule("canonical-broken", 1, [ex("/blog/old-post", "target https://example.com/blog/removed -> HTTP 404")]),
    rule("redirect-chain", 3, [ex("/pricing-old", "2 hops: /pricing-old > /plans > /pricing")]),
    rule("schema-required-missing", 1, [ex("/guides/crm-faq", "FAQPage: missing mainEntity")]),
    rule("og-missing", 4, [ex("/use-cases/sales", ""), ex("/use-cases/support", "")]),
    rule("thin-content", 5, [ex("/tools/roi-calculator", "112 words")]),
  ] },
  insights: { brand: { brand: { impressions: 210 }, nonBrand: { impressions: 994 } },
    strikingDistance: [{ query: "crm for small teams", position: 11.4, impressions: 33, page: "https://example.com/blog/crm-for-small-teams", estimatedExtraClicks: 4 }, { query: "how to choose a crm", position: 18.2, impressions: 41, page: "https://example.com/blog/how-to-choose-a-crm", estimatedExtraClicks: 3 }],
    cannibalization: [{ query: "crm migration checklist", impressions: 52, pages: [{ page: "https://example.com/guides/crm-migration", position: 14.2 }, { page: "https://example.com/blog/crm-data-migration-checklist", position: 17.9 }] }],
    contentGaps: [{ topic: "crm pricing models", impressions: 36, queries: 4 }] },
  geo: { pages: new Array(20).fill(0), llms: { present: true, links: 41 }, robots: [
    { name: "OAI-SearchBot", owner: "OpenAI", purpose: "search", state: "allowed", blocked: false },
    { name: "Claude-SearchBot", owner: "Anthropic", purpose: "search", state: "allowed", blocked: false },
    { name: "PerplexityBot", owner: "Perplexity", purpose: "search", state: "blocked", blocked: true },
    { name: "GPTBot", owner: "OpenAI", purpose: "training", state: "allowed", blocked: false },
  ], findings: [
    { severity: "high", title: "1 AI search or assistant crawler(s) are blocked", why: "Blocked crawlers cannot fetch your pages to answer a user's question, so you cannot be cited by those products.", fix: "Allow these in robots.txt unless blocking is a deliberate choice." },
    { severity: "low", title: "Most long pages have no question-style headings", why: "People ask assistants in questions; headings phrased the same way make sections easy to match and quote.", fix: "Where it reads naturally, phrase section headings as the question the section answers." },
  ] },
  speed: { results: [
    { url: "https://example.com/", lab: { score: 91, lcp: 1900 }, field: { lcp: null, inp: null }, opportunities: [] },
    { url: "https://example.com/blog/how-to-choose-a-crm", lab: { score: 62, lcp: 3300 }, field: { lcp: 3100, inp: 180 }, opportunities: ["Properly size images (about 900 ms)"] },
  ] },
});

let html = renderDashboard(data).replace("<title>SEO dashboard</title>", "<title>seo-autopilot dashboard (sample data)</title>")
  .replace("<main id=\"app\"><p>Loading…</p></main>", "<div style=\"background:#14120e;color:#f3efe7;padding:10px 16px;font:14px system-ui\">This is a <b>demo with sample data</b>, not a real website. <a style=\"color:#10b981\" href=\"../\">Back to seo-autopilot</a></div><main id=\"app\"><p>Loading…</p></main>");
const out = fileURLToPath(new URL("../site/demo/index.html", import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out}`);

// ---- Agents and playbooks pages (rendered from agents/*.md and knowledge/*.md, so the site never drifts from the product) ----
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const readDir = (d) => readdirSync(new URL(`../${d}/`, import.meta.url)).filter((f) => f.endsWith(".md")).sort();
const read = (d, f) => readFileSync(new URL(`../${d}/${f}`, import.meta.url), "utf8");
const slug = (f) => f.replace(/\.md$/, "");
const title = (md, fallback) => (md.match(/^#\s+(.+)$/m) || [])[1] || fallback;
const REPO = "https://github.com/bishal-paul-git/seo-autopilot";

const CSS = `:root{--paper:#f6f1e9;--ink:#14120e;--soft:#5b574d;--line:#e3dccf;--green:#10b981;--deep:#0a6e3e;--card:#fffdf9}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:17px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--deep)}.wrap{max-width:860px;margin:0 auto;padding:0 20px}header{background:var(--ink);color:#f3efe7}header .wrap{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;max-width:1080px}header a{color:#cfd8d1;text-decoration:none;margin-left:18px;font-size:15px}header a.logo{margin:0;font-weight:800;font-size:18px;color:#f3efe7}h1{font-size:clamp(30px,4.6vw,44px);line-height:1.1;margin:36px 0 10px;letter-spacing:-.02em}h2{font-size:26px;margin:0 0 8px}h3{font-size:19px;margin:22px 0 6px}.lead{color:var(--soft);margin:0 0 22px}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 30px}.chips a{border:1px solid var(--line);background:var(--card);border-radius:99px;padding:5px 13px;font-size:14.5px;text-decoration:none}article{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px 24px;margin:0 0 18px}article>h2{scroll-margin-top:12px}.meta{font-size:14px;color:var(--soft);margin:0 0 12px}.meta code{white-space:normal}code{background:#efe8dc;border-radius:5px;padding:1px 5px;font-size:.9em}pre{background:#0e1511;color:#d7efe0;border-radius:12px;padding:16px 18px;overflow-x:auto;font:14px/1.6 ui-monospace,Consolas,monospace}pre code{background:none;padding:0;color:inherit}.tbl{overflow-x:auto;margin:12px 0}table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:8px 10px;border-top:1px solid var(--line);vertical-align:top}th{font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--deep)}details>summary{cursor:pointer;font-weight:800;font-size:20px;list-style:none}details>summary::-webkit-details-marker{display:none}details>summary::after{content:"+";float:right;color:var(--deep)}details[open]>summary::after{content:"–"}.body{margin-top:12px}footer{padding:30px 0 50px;color:var(--soft);font-size:14.5px;border-top:1px solid var(--line);margin-top:30px}@media(max-width:640px){header a:not(.logo):not(.keep){display:none}}`;
const shell = (pageTitle, desc, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${pageTitle} | seo-autopilot</title><meta name="description" content="${desc}"><style>${CSS}</style></head><body><header><div class="wrap"><a class="logo" href="../">seo-autopilot</a><nav><a href="../#how">How it works</a><a href="../agents/">Agents</a><a href="../playbooks/">Playbooks</a><a href="../demo/">Demo</a><a class="keep" href="${REPO}">GitHub</a></nav></div></header><main class="wrap">${inner}</main><footer><div class="wrap">Rendered from the files in the repository, so it always matches the product. <a href="${REPO}">Source</a> · MIT licence · made by <a href="https://erudience.com">Erudience</a></div></footer></body></html>`;

// Agents, grouped by department (departments/<dept>/agents/*.md)
{
  const agents = listAgents();
  // Links inside the org chart and agent files: agents and departments jump within this page, playbooks go to theirs.
  const map = (h) => {
    const agent = h.match(/(?:^|\/)(seo-[a-z-]+)\.md$/);
    if (agent) return "#" + agent[1];
    const dept = h.match(/^([a-z-]+)\/README\.md$/);
    if (dept && DEPARTMENTS.includes(dept[1])) return "#dept-" + dept[1];
    if (/^\.\.\/docs\//.test(h)) return `${REPO}/blob/main/${h.slice(3)}`;
    return /^[a-z0-9-]+\.md$/.test(h) && h !== "README.md" ? "../playbooks/#" + slug(h) : h;
  };
  const intro = frontMatter(read("departments", "README.md")).body.replace(/^#\s+.*\n/, "");
  const card = ({ name, file }) => {
    const { meta, body } = frontMatter(readFileSync(file, "utf8"));
    return `<article id="${name}"><details><summary>${inline(name)}</summary><p class="meta">${inline(meta.description || "")}</p><p class="meta"><b>Tools:</b> <code>${(meta.tools || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></p><div class="body">${markdown(body.replace(/^#\s+.*\n/, ""), { linkMap: map, headingOffset: 1 })}</div></details></article>`;
  };
  const sections = DEPARTMENTS.map((d) => {
    const charter = read(`departments/${d}`, "README.md");
    return `<h2 id="dept-${d}">${inline(title(charter, d))}</h2>${agents.filter((a) => a.department === d).map(card).join("\n")}`;
  }).join("\n");
  const inner = `<h1>The agent team</h1><p class="lead">Twenty-eight agents in eight departments, each with one job, a fixed set of tools, required reading, a quality bar and a defined hand-off. The full text of each agent is below, exactly as it ships in the repository.</p><div class="chips">${DEPARTMENTS.map((d) => `<a href="#dept-${d}">${d}</a>`).join("")}</div><article>${markdown(intro, { linkMap: map, headingOffset: 1 })}</article>${sections}`;
  mkdirSync(new URL("../site/agents/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../site/agents/index.html", import.meta.url), shell("The agent team", "The twenty-eight seo-autopilot agents, from strategist and drafter to coordinator, onboarder, fact-checker, schema engineer and reporter, built to work on any kind of website, with their full instructions.", inner));
  console.log("wrote site/agents/index.html");
}

// Playbooks
{
  const files = readDir("knowledge").filter((f) => f !== "README.md");
  const map = (h) => (/^[a-z0-9-]+\.md$/.test(h) ? "#" + slug(h) : h);
  const intro = frontMatter(read("knowledge", "README.md")).body.replace(/^#\s+.*\n/, "");
  const cards = files.map((f) => { const md = read("knowledge", f); return `<article id="${slug(f)}"><details><summary>${inline(title(md, slug(f)))}</summary><div class="body">${markdown(md.replace(/^#\s+.*\n/, ""), { linkMap: map, headingOffset: 1 })}</div></details></article>`; }).join("\n");
  const inner = `<h1>The SEO playbooks</h1><p class="lead">What an experienced SEO checks before changing a page. The agents read these before they act, and the audit and priority reports link their advice back to them. Guidance, not search-engine rules.</p><article>${markdown(intro, { linkMap: map, headingOffset: 1 })}</article>${cards}`;
  mkdirSync(new URL("../site/playbooks/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../site/playbooks/index.html", import.meta.url), shell("The SEO playbooks", "The twenty-six SEO playbooks that seo-autopilot's agents read: intent, technical SEO, content quality, structured data, AI search and more.", inner));
  console.log("wrote site/playbooks/index.html");
}
