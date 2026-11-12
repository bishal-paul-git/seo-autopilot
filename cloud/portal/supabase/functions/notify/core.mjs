// Email for SEO Autopilot (D40), shared by the notify Edge Function and its tests. No I/O of its own: the caller passes
// rpc (the service-role database calls), invite (Supabase Auth's invite email) and sendMail (SMTP, or null when the
// SMTP secrets are not set). Everything in an email comes from the database's email_queue; text is escaped for HTML.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LABEL = { approval: "Waiting for your approval", stuck: "Needs a person", request: "Client request", verified: "Change verified", change_failed: "Change stopped", integration: "Integration error", planning: "Planning error", answer: "Your agency answered" };

/** Portal link for one item: agency pages for agency items, the client view for answers to a client's own request. */
export function itemLink(portalUrl, it) {
  const base = String(portalUrl || "").replace(/#.*$/, "").replace(/\/?$/, "/");
  const site = encodeURIComponent(String(it.site || "")), page = encodeURIComponent(String(it.page || "overview"));
  return it.kind === "answer" ? `${base}#/k/${site}/requests` : `${base}#/s/${site}/${page}`;
}

/** One summary email for one person. items: [{ kind, siteName, title, at, site, page }]. */
export function composeSummary(items, portalUrl) {
  const n = items.length;
  const subject = `SEO Autopilot: ${n} ${n === 1 ? "thing needs" : "things need"} your attention`;
  const lines = items.map((it) => `- ${LABEL[it.kind] || it.kind} · ${it.siteName || ""}: ${it.title}\n  ${itemLink(portalUrl, it)}`);
  const text = `Since you last looked:\n\n${lines.join("\n")}\n\nOpen your notifications: ${String(portalUrl || "").replace(/#.*$/, "")}#/notes\n\nYou get this summary at most once a day. Turn it off on the Notifications page.`;
  const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:14px;color:#111"><p>Since you last looked:</p><ul>${items.map((it) => `<li style="margin:0 0 8px"><b>${esc(LABEL[it.kind] || it.kind)}</b> · ${esc(it.siteName || "")}<br>${esc(it.title)}<br><a href="${esc(itemLink(portalUrl, it))}">Open</a></li>`).join("")}</ul>
<p><a href="${esc(String(portalUrl || "").replace(/#.*$/, ""))}#/notes">Open your notifications</a></p><p style="color:#666;font-size:12px">You get this summary at most once a day. Turn it off on the Notifications page.</p></div>`;
  return { subject, text, html };
}

/**
 * One run: invite emails first (through Supabase Auth), then summaries (through SMTP when configured).
 * Returns counts, errors and notes (settings, not failures); never throws for one bad address, so one failure does not block the rest.
 * @param {{ rpc: (fn: string, args?: any) => Promise<any>, invite: (email: string, o: any) => Promise<any>,
 *   sendMail?: ((m: { to: string, subject: string, text: string, html: string }) => Promise<any>) | null, portalUrl: string, limit?: number }} o
 */
export async function runNotify({ rpc, invite, sendMail = null, portalUrl, limit = 50 }) {
  const out = { invited: 0, summaries: 0, skippedSummaries: 0, errors: [], notes: [] };
  const q = (await rpc("email_queue", { p_limit: limit })) || {};
  for (const i of q.invites || []) {
    try {
      const r = await invite(i.email, { redirectTo: portalUrl, agency: i.agency, kind: i.kind });
      // Someone who registered meanwhile needs no invitation email: record it, so it is not tried again.
      if (r?.ok || r?.alreadyRegistered) { await rpc("email_sent", { p_kind: i.kind, p_id: i.id }); if (r.ok) out.invited++; }
      else out.errors.push(`invite ${i.kind}: ${String(r?.error || "failed").slice(0, 160)}`);
    } catch (e) { out.errors.push(`invite ${i.kind}: ${String(e.message || e).slice(0, 160)}`); }
  }
  for (const s of q.summaries || []) {
    if (!(s.items || []).length) continue;
    if (!sendMail) { out.skippedSummaries++; continue; }
    try {
      await sendMail({ to: s.email, ...composeSummary(s.items, portalUrl) });
      await rpc("email_sent", { p_kind: "summary", p_id: s.user_id });
      out.summaries++;
    } catch (e) { out.errors.push(`summary: ${String(e.message || e).slice(0, 160)}`); }
  }
  // Not an error: running without SMTP is a supported setting (the owner may add it later), so the run log stays clean.
  if (!sendMail && out.skippedSummaries) out.notes.push("summaries not sent: set the SMTP_* function secrets");
  return out;
}
