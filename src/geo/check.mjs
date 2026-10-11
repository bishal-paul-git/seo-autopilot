// GEO / AEO checks: how ready is a site to be read, quoted and cited by AI search and answer engines?
// Pure functions over robots.txt, llms.txt and page HTML so they are easy to test. Everything here is "practice that tends
// to help", not a ranking guarantee, and every finding says so through its `why`.
import { extractPage } from "../audit/extract.mjs";

/** AI crawlers worth deciding about on purpose. `purpose` separates training collection from live answers/search. */
export const AI_BOTS = [
  { name: "GPTBot", owner: "OpenAI", purpose: "training" },
  { name: "OAI-SearchBot", owner: "OpenAI", purpose: "search" },
  { name: "ChatGPT-User", owner: "OpenAI", purpose: "user-requested fetch" },
  { name: "ClaudeBot", owner: "Anthropic", purpose: "training" },
  { name: "Claude-SearchBot", owner: "Anthropic", purpose: "search" },
  { name: "Claude-User", owner: "Anthropic", purpose: "user-requested fetch" },
  { name: "PerplexityBot", owner: "Perplexity", purpose: "search" },
  { name: "Google-Extended", owner: "Google", purpose: "training (Gemini); does not affect Search" },
  { name: "Applebot-Extended", owner: "Apple", purpose: "training" },
  { name: "CCBot", owner: "Common Crawl", purpose: "training" },
];

/** For one user agent, is the whole site blocked? Specific group beats "*"; an empty Disallow means allowed. */
export function botAccess(robotsTxt, bot) {
  if (robotsTxt == null) return { state: "no robots.txt", blocked: false };
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of String(robotsTxt).split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else { lastWasAgent = false; if (cur && (k === "disallow" || k === "allow")) cur.rules.push({ allow: k === "allow", path: v }); }
  }
  const name = bot.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(name));
  const group = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  if (!group.length) return { state: "allowed (no matching rule)", blocked: false };
  const rules = group.flatMap((g) => g.rules);
  const root = rules.filter((r) => r.path === "/" || r.path === "/*");
  const rootAllow = rules.some((r) => r.allow && (r.path === "/" || r.path === "/*"));
  const blocked = root.some((r) => !r.allow) && !rootAllow;
  const partial = !blocked && rules.some((r) => !r.allow && r.path && r.path !== "/");
  return { state: blocked ? "blocked" : partial ? "allowed with some paths blocked" : "allowed", blocked, via: specific.length ? "its own rule" : "the * rule" };
}

export function checkRobots(robotsTxt) {
  return AI_BOTS.map((b) => ({ ...b, ...botAccess(robotsTxt, b.name) }));
}

/** llms.txt: present, and whether it has a title and links (the proposed format is Markdown with an H1 and link lists). */
export function checkLlmsTxt(text, status) {
  if (status !== 200 || !text) return { present: false };
  const links = (text.match(/\]\(https?:\/\/[^)]+\)/g) || []).length;
  return { present: true, hasTitle: /^#\s+\S/m.test(text), links, bytes: text.length };
}

const QUESTION = /^(what|why|how|when|where|who|which|can|do|does|is|are|should|will|vs|versus)\b|\?$/i;

/** One page: answer-first structure, extractability, entity and trust signals. */
export function checkPage(html, url) {
  const x = extractPage(html, url);
  const body = String(html || "").replace(/<(script|style|nav|footer|header|aside)[\s\S]*?<\/\1>/gi, " ");
  const paras = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter((t) => t.split(" ").length >= 6);
  const first = paras[0] || "";
  const firstWords = first ? first.split(" ").length : 0;
  const headings = [...String(html || "").matchAll(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const questionHeadings = headings.filter((h) => QUESTION.test(h)).length;
  const lists = (body.match(/<(ul|ol)\b/gi) || []).length, tables = (body.match(/<table\b/gi) || []).length;
  const types = new Set(x.jsonld.types);
  const sameAs = /"sameAs"\s*:\s*\[?\s*"https?:/i.test(html);
  const hasDate = types.has("Article") || types.has("BlogPosting") || /datePublished|dateModified/.test(html) || /<time\b/i.test(body);
  const hasAuthor = /"author"\s*:/.test(html) || /rel=["']author["']/i.test(html) || /<meta[^>]+name=["']author["']/i.test(html);
  const outbound = x.links.filter((l) => { try { return new URL(l.url).host !== new URL(url).host; } catch { return false; } }).length;
  return {
    url, words: x.words, h1: x.h1s[0] || "", firstParagraphWords: firstWords,
    answerFirst: firstWords >= 15 && firstWords <= 70,
    headings: headings.length, questionHeadings, lists, tables,
    schemaTypes: [...types], hasFaqSchema: types.has("FAQPage"), hasOrgSchema: types.has("Organization") || types.has("LocalBusiness") || types.has("ProfessionalService"), sameAs,
    hasDate, hasAuthor, outboundLinks: outbound,
    contentInInitialHtml: x.words >= 150,
  };
}

/** Roll page results and site-level facts into findings, each with why and fix. */
export function summariseGeo({ robots, llms, pages }) {
  const f = [];
  const add = (id, severity, title, why, fix, detail) => f.push({ id, severity, title, why, fix, detail });
  const blocked = robots.filter((b) => b.blocked);
  const searchBlocked = blocked.filter((b) => /search|user-requested/.test(b.purpose));
  if (searchBlocked.length) add("ai-search-blocked", "high", `${searchBlocked.length} AI search or assistant crawler(s) are blocked`, "Blocked crawlers cannot fetch your pages to answer a user's question, so you cannot be cited by those products.", "Allow these in robots.txt unless blocking is a deliberate choice.", searchBlocked.map((b) => `${b.name} (${b.owner})`).join(", "));
  if (blocked.length && !searchBlocked.length) add("ai-training-blocked", "low", `${blocked.length} AI training crawler(s) are blocked`, "This is a legitimate choice: it keeps your content out of model training and, for most of these, does not affect search or citations.", "Nothing to do unless you changed your mind.", blocked.map((b) => `${b.name} (${b.purpose})`).join(", "));
  if (!llms.present) add("no-llms-txt", "low", "No llms.txt", "llms.txt is a proposed convention for pointing AI tools at your key pages. It is not known to be used by major search engines, so this is low cost and unproven.", "Optional: add /llms.txt with a short description and links to your most important pages.");
  const n = pages.length || 1, pct = (k) => Math.round((pages.filter(k).length / n) * 100);
  const noInitial = pages.filter((p) => !p.contentInInitialHtml);
  if (noInitial.length) add("thin-initial-html", noInitial.length / n > 0.3 ? "high" : "medium", `${noInitial.length} of ${pages.length} sampled pages have little text in the HTML the server sends`, "Many AI crawlers do not run JavaScript. If the text only appears after scripts run, they see an almost empty page.", "Server-render or prerender the full page content, not just a shell.", noInitial.slice(0, 5).map((p) => `${p.url} (${p.words} words)`).join("; "));
  const noAnswer = pages.filter((p) => !p.answerFirst && p.words >= 300);
  if (noAnswer.length / n > 0.4) add("not-answer-first", "medium", `${pct((p) => !p.answerFirst && p.words >= 300)}% of longer pages do not open with a short direct answer`, "Answer engines quote clear, self-contained answers. A page that opens with a long preamble is harder to extract from.", "Open each page with a 2 to 3 sentence answer to the main question, then give detail.", noAnswer.slice(0, 5).map((p) => p.url).join("; "));
  const noQ = pages.filter((p) => p.words >= 500 && p.questionHeadings === 0);
  if (noQ.length / n > 0.5) add("no-question-headings", "low", "Most long pages have no question-style headings", "People ask assistants in questions; headings phrased the same way make sections easy to match and quote.", "Where it reads naturally, phrase section headings as the question the section answers.");
  if (!pages.some((p) => p.hasOrgSchema)) add("no-org-schema", "medium", "No Organization (or LocalBusiness) structured data found on the sampled pages", "Entity data tells machines who you are. Without it they infer your identity from scattered text.", "Add Organization JSON-LD with name, url, logo and real sameAs profile links on at least the home page.");
  else if (!pages.some((p) => p.sameAs)) add("no-sameas", "low", "Organization data has no sameAs links", "sameAs ties your site to your real profiles, which helps systems recognise the same entity across the web.", "Add links to your real, active profiles (LinkedIn, GitHub, Crunchbase and so on) only if they exist.");
  const articleLike = pages.filter((p) => p.schemaTypes.some((t) => /Article|BlogPosting/.test(t)));
  const noDate = articleLike.filter((p) => !p.hasDate), noAuthor = articleLike.filter((p) => !p.hasAuthor);
  if (noDate.length) add("no-dates", "low", `${noDate.length} article page(s) show no publish or update date`, "Freshness is a trust signal and assistants prefer to cite content they can date.", "Add datePublished and dateModified in structured data and a visible date.");
  if (noAuthor.length) add("no-author", "low", `${noAuthor.length} article page(s) name no author`, "Visible authorship supports trust, especially on advice content.", "Add a real author byline and author structured data. Do not invent people.");
  const hasFaqContent = pages.filter((p) => p.questionHeadings >= 3 && !p.hasFaqSchema);
  if (hasFaqContent.length) add("faq-without-schema", "low", `${hasFaqContent.length} page(s) answer several questions but have no FAQPage markup`, "FAQ markup is rarely shown as a rich result now, but it states the question and answer pairs explicitly for machines.", "Optional: add FAQPage JSON-LD only for questions and answers that appear on the page.");
  const order = { high: 0, medium: 1, low: 2 };
  return f.sort((a, b) => order[a.severity] - order[b.severity]);
}
