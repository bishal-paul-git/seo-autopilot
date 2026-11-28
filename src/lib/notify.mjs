// A small, generic alert channel: one Telegram message through the Bot API. Used by the cost guard (src/lib/dataforseo.mjs) and
// usable by any job. Bring your own bot: nothing here is specific to one project.
//   TELEGRAM_BOT_TOKEN   the bot token (secret: sent only to api.telegram.org, never logged, never in a message)
//   TELEGRAM_CHAT_ID     the chat or group id
//   TELEGRAM_THREAD_ID   optional: the forum topic (message_thread_id) inside that group
// Not configured is not an error: sendTelegram returns { sent: false, reason: "not-configured" } and sends nothing.
// `fetch` is injectable so tests never touch the network.

/** Telegram HTML mode only needs these three escaped. */
export const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const telegramConfigured = (env = process.env) => Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

/**
 * Send one message. `text` is plain text and is HTML-escaped here (pass html: true only for text you built and escaped yourself).
 * Returns { sent, messageId?, reason? }. Never throws and never includes the token in what it returns.
 */
export async function sendTelegram(text, { env = process.env, fetch: f = globalThis.fetch, silent = false, html = false, timeoutMs = 15000 } = {}) {
  if (!telegramConfigured(env)) return { sent: false, reason: "not-configured" };
  const body = { chat_id: /^-?\d+$/.test(env.TELEGRAM_CHAT_ID) ? Number(env.TELEGRAM_CHAT_ID) : env.TELEGRAM_CHAT_ID, parse_mode: "HTML", disable_notification: silent, text: (html ? String(text) : escapeHtml(text)).slice(0, 4096) };
  if (env.TELEGRAM_THREAD_ID) body.message_thread_id = Number(env.TELEGRAM_THREAD_ID);
  try {
    const r = await f(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json().catch(() => ({}));
    // An error text that echoes the request URL would carry the token: it is cut out before the reason is returned.
    if (!r.ok || j.ok === false) return { sent: false, reason: `telegram HTTP ${r.status}${j.description ? `: ${String(j.description).split(env.TELEGRAM_BOT_TOKEN).join("<token>").slice(0, 120)}` : ""}` };
    return { sent: true, messageId: j.result?.message_id ?? null };
  } catch (e) {
    return { sent: false, reason: `telegram request failed (${e.name || "error"})` };
  }
}
