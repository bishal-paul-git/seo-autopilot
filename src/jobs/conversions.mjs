// Conversions check: which events GA4 received in the last 28 days, which are marked as key events, and whether the
// conversions you expect (config "conversions": { "events": ["generate_lead"] }) arrive and are marked. Read-only.
// Needs ga4PropertyId and Viewer access for the service account. Writes <state>/<site>/conversions.json and conversions.md.
//   npx seo-autopilot run conversions [--days 28]
import { getToken, SCOPES, googleKeyAvailable } from "../lib/google-auth.mjs";
import { eventCounts, keyEvents } from "../lib/ga4.mjs";
import { summarizeConversions, SUGGESTED } from "../analysis/conversions.mjs";
import { writeJson, writeText, today } from "../core/util.mjs";

export const description = "GA4 conversions: events received, which are key events, expected conversions missing or unmarked";

export async function run({ site, flags, fetchFn = fetch }) {
  if (!site.ga4PropertyId) { console.log("conversions: no ga4PropertyId in the config. Skipped."); return; }
  if (!googleKeyAvailable()) { console.log("conversions: no Google key (GOOGLE_KEY_JSON or GOOGLE_KEY_FILE). Skipped."); return; }
  const days = Number(flags.days ?? 28);
  const { token } = await getToken([SCOPES.analytics]);
  const events = await eventCounts(site.ga4PropertyId, token, { days, fetchFn });
  let marked = null, keyError = null;
  try { marked = await keyEvents(site.ga4PropertyId, token, { fetchFn }); } catch (e) { keyError = e.message; }
  const expected = site.conversions?.events?.length ? site.conversions.events : ["generate_lead"];
  const r = summarizeConversions(events, marked, expected);
  writeJson(`${site.paths.state}/conversions.json`, { generatedAt: new Date().toISOString(), property: site.ga4PropertyId, days, keyError, ...r });
  const md = `# ${site.name} conversions ${today()}

GA4 property ${site.ga4PropertyId}, last ${days} days to yesterday. ${r.received} event name(s) received.${keyError ? ` Key events could not be read (${keyError}), so marking was not checked.` : ""}

## Findings
${r.findings.map((f) => `- **${f.title}** (${f.severity}): ${f.evidence.join("; ")}. ${f.fix}`).join("\n") || "- none: the expected conversions arrive and are key events."}

## Events other than GA4's automatic ones
${r.custom.map((e) => `- ${e.name}: ${e.count}${r.keyEvents?.includes(e.name) ? " (key event)" : ""}`).join("\n") || "- none: only automatic events (page views, sessions, scrolls) were received."}

Suggested events for a lead-generating site: ${SUGGESTED.join(", ")}. How to send them without personal data: the conversion tracking recipe in the playbooks.
`;
  writeText(`${site.paths.state}/conversions.md`, md);
  console.log(md);
}
