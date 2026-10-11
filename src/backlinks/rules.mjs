// Pure rules for the backlink submitter (no browser, no network) so they can be unit-tested.
//
// Policy, in plain words:
// - Never more than `maxPerDay` submission attempts per day (retries count).
// - Only targets marked mode "auto" are ever tried. "manual" and "skip" targets are left for a person.
// - Each target gets at most `maxAttempts` tries (first try + one retry the next day). After that it is logged as failed.
// - Bot checks (CAPTCHA, maths questions), account creation, payment, unknown required fields and reciprocal-link
//   requirements are NEVER worked around: the target becomes "needs_human" and is logged with the reason.

export const DEFAULT_CONFIG = { maxPerDay: 5, maxAttempts: 2, retryAfterDays: 1, delaySeconds: [8, 20] };

const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export function attemptsToday(state, day) { return (state.dayCounts && state.dayCounts[day]) || 0; }

// Which targets to try now, most relevant first, never exceeding today's cap.
export function pickBatch(targets, state, day, config = DEFAULT_CONFIG) {
  const room = Math.max(0, config.maxPerDay - attemptsToday(state, day));
  const eligible = targets.filter((t) => {
    if (t.mode !== "auto" || t.paid) return false;
    const rec = (state.targets || {})[t.id];
    if (!rec) return true;
    if (rec.status === "retry") return !rec.nextAttemptAfter || rec.nextAttemptAfter <= day;
    return rec.status === "pending";
  });
  // Retries first (they are already in progress), then by relevance.
  eligible.sort((a, b) => {
    const ra = (state.targets || {})[a.id]?.status === "retry" ? 1 : 0, rb = (state.targets || {})[b.id]?.status === "retry" ? 1 : 0;
    return rb - ra || (b.relevance || 0) - (a.relevance || 0);
  });
  return eligible.slice(0, room);
}

// outcome: { kind: "submitted" | "needs_human" | "transient", reason }
export function applyOutcome(state, id, outcome, day, config = DEFAULT_CONFIG) {
  state.targets ||= {}; state.dayCounts ||= {};
  const rec = (state.targets[id] ||= { status: "pending", attempts: 0, history: [] });
  rec.attempts += 1;
  rec.lastAttempt = day;
  state.dayCounts[day] = attemptsToday(state, day) + 1;
  rec.history.push({ day, kind: outcome.kind, reason: String(outcome.reason || "").slice(0, 300) });
  if (outcome.kind === "submitted") { rec.status = "submitted"; delete rec.nextAttemptAfter; }
  else if (outcome.kind === "needs_human") { rec.status = "needs_human"; delete rec.nextAttemptAfter; }
  else if (rec.attempts >= config.maxAttempts) { rec.status = "failed"; delete rec.nextAttemptAfter; }
  else { rec.status = "retry"; rec.nextAttemptAfter = addDays(day, config.retryAfterDays); }
  return rec;
}

// Which profile value belongs in a field? `hint` is the label, placeholder, name and id joined together.
const RULES = [
  [/e-?mail/i, "email"],
  [/(your|contact|full|first)\s*name|^name$|\bname\b.*(contact|person)|owner/i, "contactName", { not: /(business|company|product|tool|startup|site|organi[sz]ation|brand)/i }],
  [/(business|company|organi[sz]ation|product|tool|startup|brand|site)\s*name|^name$|title/i, "name"],
  [/tag\s*line|headline|slogan|one[- ]?line|short\s*(description|summary)|summary/i, "tagline"],
  [/(long|full|detailed)?\s*description|about|overview|details/i, "longDescription"],
  [/website|url|link|web\s*address|domain|homepage/i, "url"],
  [/post\s*code|zip/i, "postcode"],
  [/\bcity|town/i, "city"],
  [/country/i, "country"],
  [/address|street/i, "address"],
  [/pricing|price/i, "pricing"],
  [/categor|industry|sector|type/i, "category"],
  [/tags?|keywords?/i, "tags"],
  [/logo/i, "logoUrl"],
];

export function fieldValue(hint, profile) {
  for (const [re, key, opt] of RULES) {
    if (re.test(hint) && !(opt?.not && opt.not.test(hint))) {
      const v = profile[key];
      return Array.isArray(v) ? v.join(", ") : v ?? null;
    }
  }
  return null;
}

export function isBotCheckText(text) {
  return /captcha|i am not a robot|i'm not a robot|verify you are human|are you human|security question|what is \d+\s*[+\-x*]\s*\d+|quick check/i.test(text);
}
export const BOT_CHECK_SELECTORS = ['iframe[src*="recaptcha"]', 'iframe[src*="hcaptcha"]', 'iframe[src*="turnstile"]', ".g-recaptcha", ".h-captcha", ".cf-turnstile", '[name="g-recaptcha-response"]'];

// A checkbox is ticked only when it is plainly the terms/consent needed to submit, never marketing opt-ins.
export function shouldTick(label) {
  if (/newsletter|marketing|promotion|offers|updates|subscribe|partner|sponsor/i.test(label)) return false;
  return /terms|agree|accept|privacy|authori[sz]ed|permission|confirm/i.test(label);
}

export function looksSuccessful(text) {
  return /thank you|thanks for|submitted|received your|pending (review|approval)|under review|success|check your (e-?mail|inbox)|confirm your e-?mail|we will review|has been (added|received|sent)/i.test(text);
}
export function looksFailed(text) {
  return /(this field is required|please (fill|enter|complete)|is required|invalid|error occurred|something went wrong)/i.test(text);
}

// Very small robots.txt reader: does a Disallow rule for "*" cover this path?
export function robotsAllows(robotsTxt, path) {
  let applies = false; const disallow = [];
  for (const raw of String(robotsTxt || "").split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") applies = v === "*";
    else if (applies && k === "disallow" && v) disallow.push(v);
  }
  return !disallow.some((d) => path.startsWith(d));
}
