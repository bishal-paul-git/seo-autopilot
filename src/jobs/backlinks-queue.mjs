// Weekly "do these by hand" checklist for listings the autopilot is not allowed to complete (account, CAPTCHA, regional
// IP). Each item carries the exact text to paste from profile.json, so a listing takes about two minutes.
// Record a finished one with:  npx seo-autopilot run mark <target-id> done|skipped|submitted [listing-url]
import { readJson } from "../core/util.mjs";
import { today } from "../core/util.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";

export const description = "Open one issue listing up to 5 backlink listings for a person to do by hand, with paste-ready text";

export async function run({ site }) {
  const bdir = site.paths.backlinks;
  const targets = readJson(`${bdir}/targets.json`, []);
  const profile = readJson(`${bdir}/profile.json`, {});
  const state = readJson(`${site.paths.state}/backlinks-state.json`, { targets: {} });
  const open = targets
    .filter((t) => t.mode !== "skip")
    .filter((t) => {
      const s = state.targets[t.id]?.status;
      return t.mode === "manual" ? !["done", "skipped"].includes(s) : s === "needs_human";
    })
    .sort((a, b) => (b.relevance || 0) - (a.relevance || 0))
    .slice(0, 5);
  if (!open.length) { console.log("backlinks-queue: nothing to do"); return; }

  const why = (t) => state.targets[t.id]?.history?.at(-1)?.reason || t.notes;
  const body = `Up to 5 listings that need a person (an account, a CAPTCHA or a regional connection). Tick them off here, then record each so it stops appearing:\n\`npx seo-autopilot run mark <id> done\`\n\n` +
    open.map((t) => `- [ ] **${t.name}** (\`${t.id}\`): ${t.submitUrl}\n  - Why by hand: ${why(t)}`).join("\n") +
    `\n\n## Text to paste (all of it must already be public on your site)\n- Name: ${profile.name}\n- URL: ${profile.url}\n- Email: ${profile.email}\n- Contact: ${profile.contactName}\n- Tagline: ${profile.tagline}\n- Short description: ${profile.shortDescription}\n- Long description: ${profile.longDescription}\n- Category: ${profile.category}\n- Pricing: ${profile.pricing}\n\nOnly free listings. Decline paid upgrades, reciprocal-link requirements and marketing opt-ins.`;
  const title = `Backlinks to do by hand, week of ${today()}`;
  if (!ghAvailable()) { console.log(title + "\n\n" + body); return; }
  await ensureLabel(site.labels.backlink, "F59E0B", "Backlink opportunity for the owner to act on");
  if ((await existingTitles(site.labels.backlink)).has(title)) { console.log("backlinks-queue: already opened this week"); return; }
  await openIssue(title, body, [site.labels.backlink]);
}
