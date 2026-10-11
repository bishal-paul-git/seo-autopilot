// Backlink submitter: fills free listing forms with the facts in <data>/backlinks/profile.json, a few per day, and logs
// every outcome. Dry run by default: it fills the form and takes a screenshot but submits nothing. Real submission needs
// BACKLINK_LIVE=1 (or --live).
//
// Browser: set BROWSER_WS_ENDPOINT to a cloud browser (a wss:// CDP endpoint, for example Browserless, Browserbase or
// Steel) and the page runs there; without it a local headless Chromium is used (npm i playwright). Do NOT enable a vendor's
// CAPTCHA-solving feature: this job stops at any bot check by design and a person finishes that listing.
//
// Hard limits (see src/backlinks/rules.mjs): at most config.maxPerDay attempts a day (default 5, retries count), one retry
// the next day, then the target is logged as failed. It never solves CAPTCHAs or maths checks, never creates accounts,
// never pays, never adds a reciprocal link, never ticks marketing opt-ins, and only touches targets marked mode "auto".
import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { readJson, writeJson, today, sleep } from "../core/util.mjs";
import { ingest, ingestEnabled } from "../lib/ingest.mjs";
import { DEFAULT_CONFIG, pickBatch, applyOutcome, fieldValue, isBotCheckText, BOT_CHECK_SELECTORS, shouldTick, looksSuccessful, looksFailed, robotsAllows } from "../backlinks/rules.mjs";

export const description = "Fill and (when live) submit up to 5 free listing forms a day, with one retry; logs everything";

export async function run({ site, flags }) {
  const live = process.env.BACKLINK_LIVE === "1" || flags.live === true;
  const bdir = site.paths.backlinks;
  const config = { ...DEFAULT_CONFIG, ...readJson(`${bdir}/config.json`, {}) };
  const profile = readJson(`${bdir}/profile.json`, null);
  const targets = readJson(`${bdir}/targets.json`, []);
  if (!profile) { console.log(`backlinks: no profile at ${bdir}/profile.json. Skipped.`); return; }
  if (!profile.name || /^YOUR_/i.test(profile.name)) { console.log("backlinks: profile.json still has placeholder values. Fill it in first. Skipped."); return; }
  const shots = `${site.paths.state}/backlink-shots`; mkdirSync(shots, { recursive: true });
  const stateFile = `${site.paths.state}/backlinks-state.json`;
  const state = readJson(stateFile, { targets: {}, dayCounts: {} });
  const day = today();

  let batch = pickBatch(targets, state, day, config);
  if (flags.only) batch = targets.filter((t) => t.id === flags.only);
  console.log(`${live ? "LIVE" : "DRY RUN"}: ${batch.length} target(s) today (cap ${config.maxPerDay}): ${batch.map((t) => t.id).join(", ") || "none"}`);

  const log = [];
  if (batch.length) {
    let chromium;
    try { ({ chromium } = await import("playwright")); } catch { console.log("playwright is not installed (npm i --no-save playwright && npx playwright install chromium). Nothing done."); return; }
    const browser = process.env.BROWSER_WS_ENDPOINT ? await chromium.connectOverCDP(process.env.BROWSER_WS_ENDPOINT) : await chromium.launch({ headless: true });

    async function attempt(t) {
      const origin = new URL(t.submitUrl).origin;
      try {
        const rb = await fetch(origin + "/robots.txt", { signal: AbortSignal.timeout(10000) });
        if (rb.ok && !robotsAllows(await rb.text(), new URL(t.submitUrl).pathname)) return { kind: "needs_human", reason: "robots.txt disallows automated access to the submit page" };
      } catch { /* no robots.txt reachable: carry on */ }
      const ctx = browser.contexts()[0] || await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-GB" });
      const page = await ctx.newPage();
      try {
        await page.goto(t.submitUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(2500);
        const text = (await page.innerText("body").catch(() => "")) || "";
        for (const sel of BOT_CHECK_SELECTORS) if (await page.locator(sel).count()) return { kind: "needs_human", reason: `bot check on page (${sel})` };
        if (isBotCheckText(text)) return { kind: "needs_human", reason: "bot check wording on page (captcha or maths question)" };
        if (await page.locator('input[type="password"]').count()) return { kind: "needs_human", reason: "password field present: account required" };

        const forms = page.locator("form");
        const n = await forms.count();
        let best = null, bestN = 0;
        for (let i = 0; i < Math.max(n, 1); i++) {
          const scope = n ? forms.nth(i) : page.locator("body");
          if (n && await scope.evaluate((el) => el.getAttribute("role") === "search" || !!el.querySelector('input[type="search"]') || /search/i.test((el.id || "") + (el.className || "") + (el.getAttribute("action") || ""))).catch(() => false)) continue; // never the site-search form
          const c = await scope.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select').count();
          if (c > bestN) { best = scope; bestN = c; }
        }
        if (!best || bestN === 0) return { kind: "needs_human", reason: "no fillable form found (page may need a sign-in or has changed)" };

        const fields = best.locator('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea, select');
        const total = await fields.count();
        const unknownRequired = []; let filled = 0;
        for (let i = 0; i < total; i++) {
          const f = fields.nth(i);
          if (!(await f.isVisible().catch(() => false))) continue; // hidden fields and honeypots are left alone
          const meta = await f.evaluate((el) => {
            const lab = el.labels && el.labels[0] ? el.labels[0].innerText : "";
            const prev = el.closest("label") ? el.closest("label").innerText : "";
            return { tag: el.tagName.toLowerCase(), type: el.type || "", name: el.name || "", id: el.id || "", ph: el.placeholder || "", aria: el.getAttribute("aria-label") || "", lab: lab || prev, required: el.required || el.getAttribute("aria-required") === "true", tabindex: el.tabIndex };
          });
          if (meta.tabindex < 0 && /honey|trap|hp|bot/i.test(meta.name + meta.id)) continue;
          const hint = [meta.lab, meta.aria, meta.ph, meta.name, meta.id].filter(Boolean).join(" ");
          if (/^search$|search|where\?|^q$/i.test(hint.trim()) || meta.type === "search") continue;
          if (isBotCheckText(hint)) return { kind: "needs_human", reason: `bot check field: ${hint.slice(0, 80)}` };
          const v = fieldValue(hint, profile);
          if (meta.tag === "select") {
            const opts = await f.locator("option").allInnerTexts();
            const pick = opts.find((o) => /ai|automation|business|software|other/i.test(o) && !/select|choose|^$/i.test(o.trim()));
            if (pick) { await f.selectOption({ label: pick }); filled++; } else if (meta.required) unknownRequired.push(hint.slice(0, 60));
            continue;
          }
          if (v == null || v === "") { if (meta.required) unknownRequired.push(hint.slice(0, 60)); continue; }
          await f.fill(String(v)); filled++;
        }
        if (unknownRequired.length) return { kind: "needs_human", reason: `required field(s) we have no true answer for: ${unknownRequired.join("; ")}` };
        if (filled < 2) return { kind: "needs_human", reason: `only ${filled} field(s) matched the profile: this does not look like a listing form` };

        const boxes = best.locator('input[type="checkbox"]');
        for (let i = 0; i < await boxes.count(); i++) {
          const b = boxes.nth(i);
          const label = await b.evaluate((el) => (el.labels && el.labels[0] ? el.labels[0].innerText : (el.closest("label") || {}).innerText || el.name || ""));
          if (shouldTick(label)) await b.check().catch(() => {}); else if (await b.getAttribute("required") !== null) return { kind: "needs_human", reason: `required checkbox we will not tick: ${label.slice(0, 60)}` };
        }

        await page.screenshot({ path: `${shots}/${t.id}-${day}-filled.png`, fullPage: true }).catch(() => {});
        if (!live) return { kind: "dry", reason: `dry run: filled ${filled} field(s), nothing submitted` };

        const submit = best.locator('button[type="submit"], input[type="submit"], button:has-text("Submit"), button:has-text("Add"), button:has-text("List"), button:has-text("Send"), button:has-text("Register"), button:has-text("Continue")').first();
        if (!(await submit.count())) return { kind: "needs_human", reason: "no submit button found" };
        await Promise.all([page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}), submit.click()]);
        await page.waitForTimeout(3000);
        const after = (await page.innerText("body").catch(() => "")) || "";
        await page.screenshot({ path: `${shots}/${t.id}-${day}-result.png`, fullPage: true }).catch(() => {});
        if (isBotCheckText(after)) return { kind: "needs_human", reason: "bot check appeared after submitting" };
        if (looksSuccessful(after) && !looksFailed(after)) return { kind: "submitted", reason: "confirmation text seen (listing may still need review or an email confirmation)" };
        return { kind: "transient", reason: looksFailed(after) ? "form reported an error" : "no confirmation text seen after submitting" };
      } catch (e) {
        return { kind: "transient", reason: `${e.name}: ${String(e.message).split("\n")[0]}`.slice(0, 200) };
      } finally { await page.close().catch(() => {}); }
    }

    for (const [i, t] of batch.entries()) {
      const out = await attempt(t);
      console.log(`${t.id}: ${out.kind} - ${out.reason}`);
      log.push({ id: t.id, name: t.name, ...out });
      if (out.kind !== "dry") applyOutcome(state, t.id, out, day, config);
      if (i < batch.length - 1) await sleep((config.delaySeconds[0] + Math.random() * (config.delaySeconds[1] - config.delaySeconds[0])) * 1000);
    }
    await browser.close().catch(() => {});
  }

  writeJson(stateFile, state);
  if (log.length) appendFileSync(`${site.paths.state}/backlinks-log.md`, log.map((e) => `- ${day} ${e.name}: **${e.kind}** - ${e.reason}`).join("\n") + "\n");
  const rows = targets.map((t) => {
    const r = state.targets[t.id] || {};
    return { target_id: t.id, name: t.name, submit_url: t.submitUrl, mode: t.mode, status: r.status || (t.mode === "auto" ? "pending" : t.mode), attempts: r.attempts || 0,
      last_attempt: r.lastAttempt || null, next_attempt: r.nextAttemptAfter || null, note: (r.history?.at(-1)?.reason || t.notes || "").slice(0, 300) };
  });
  writeFileSync(`${site.paths.state}/backlinks-summary.md`, `# Backlinks ${day}\n\n${rows.map((r) => `- ${r.name}: ${r.status}${r.attempts ? ` (${r.attempts} attempt${r.attempts > 1 ? "s" : ""})` : ""} - ${r.note}`).join("\n")}\n`);
  if (ingestEnabled(site) && (live || log.some((e) => e.kind !== "dry"))) await ingest(site, { backlinks: rows });
}
