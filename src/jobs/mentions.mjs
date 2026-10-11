// Finds pages that mention your brand but do not link to your site (the easiest, most natural backlinks to ask for).
// Reads <data>/backlinks/mentions.json (Google Alerts RSS or a Google News search feed), fetches each new page once, and if
// it names the brand without linking to your domain, opens one issue with a polite, true, ready-to-send note.
// It never sends anything: you copy the note and decide. At most 2 issues per run.
import { parseFeed } from "../lib/feed.mjs";
import { readJson, writeJson, today, clean } from "../core/util.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";
import { ask, NO_FAKE_RULES } from "../lib/llm.mjs";

export const description = "Find pages that mention your brand without linking to it, and draft a polite request";

export async function run({ site }) {
  const cfg = readJson(`${site.paths.backlinks}/mentions.json`, { feeds: [], brandTerms: [], ownDomains: [] });
  const brandTerms = cfg.brandTerms?.length ? cfg.brandTerms : site.brandTerms;
  const own = cfg.ownDomains?.length ? cfg.ownDomains : [new URL(site.url).hostname];
  if (!cfg.feeds?.length || !brandTerms?.length) { console.log("mentions: add feeds and brandTerms to mentions.json. Skipped."); return; }
  const seenFile = `${site.paths.state}/mentions-seen.json`;
  const seen = readJson(seenFile, {});
  const brand = new RegExp("\\b(" + brandTerms.map((t) => t.replace(/[^\w ]/g, "")).join("|") + ")\\b", "i");
  const found = [];

  for (const f of cfg.feeds) {
    try {
      const res = await fetch(f.url, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) { console.log(`${f.id}: HTTP ${res.status}`); continue; }
      for (const it of parseFeed(await res.text()).slice(0, 15)) {
        if (seen[it.link]) continue;
        seen[it.link] = today();
        if (!brand.test(it.title + " " + it.summary)) continue;
        try {
          const page = await fetch(it.link, { redirect: "follow", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Mozilla/5.0 (compatible; seo-autopilot-link-check)" } });
          const html = await page.text();
          const final = page.url;
          if (own.some((d) => new URL(final).hostname.endsWith(d))) continue;
          const mentions = brand.test(html.replace(/<[^>]+>/g, " "));
          const links = own.some((d) => new RegExp(`href=["'][^"']*${d.replace(/\./g, "\\.")}`, "i").test(html));
          console.log(`${final}: mentions=${mentions} links=${links}`);
          if (mentions && !links) found.push({ title: clean(it.title, 100), url: final, source: f.name });
        } catch (e) { console.log(`fetch ${it.link}: ${e.message}`); }
      }
    } catch (e) { console.log(`${f.id}: ${e.message}`); }
  }
  writeJson(seenFile, Object.fromEntries(Object.entries(seen).slice(-3000)));

  if (!found.length || !ghAvailable()) { console.log(`mentions: ${found.length} unlinked mention(s)`); return; }
  await ensureLabel(site.labels.backlink, "F59E0B", "Backlink opportunity for the owner to act on");
  const titles = await existingTitles(site.labels.backlink);
  const signoff = cfg.signoff || "Thanks,\n" + (cfg.contactName || site.name);
  let made = 0;
  for (const x of found) {
    if (made >= 2) break;
    const title = `Link opportunity: ${new URL(x.url).hostname} mentions ${site.name} without a link`;
    if (titles.has(title)) continue;
    const draft = (await ask(
      `You write short, polite, honest outreach notes. ${NO_FAKE_RULES} Never flatter, never claim anything about the page you were not told, never offer payment or a swap.`,
      `A page titled "${x.title}" (${x.url}) mentions ${site.name} (${site.url}) but does not link to it. Write a 3-sentence email asking, politely, whether they could link the mention to the site. Plain text only. End with the sign-off: ${signoff}`,
      { maxTokens: 300 })) || `Hello,\n\nThank you for mentioning ${site.name} in "${x.title}". Would you be able to link the mention to ${site.url} so readers can find us easily?\n\n${signoff}`;
    const body = `**Page:** ${x.url}\n**Found via:** ${x.source}\n\nThe page names ${site.name} but has no link to ${new URL(site.url).hostname}.\n\n**Draft note (check the facts, then send it yourself):**\n\n> ${draft.replace(/\n/g, "\n> ")}\n\n_Nothing is sent automatically. Close this issue when done or if the page is not worth chasing._`;
    if (await openIssue(title, body, [site.labels.backlink])) made++;
  }
}
