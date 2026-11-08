// Email through Supabase (D40). The Cloudflare scheduler calls this every run with the shared scan secret.
// - Invitations: Supabase Auth's own invite email (POST /auth/v1/invite with the service role), so it goes out through the
//   project's Auth SMTP and its "Invite user" template. The invitee sets a password from the link and lands in the portal.
// - Daily summaries: sent through SMTP with the function secrets SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//   (use the same server as Authentication -> SMTP). Without them, summaries are skipped and the reason is returned.
// PORTAL_URL (function secret) is where links point, e.g. https://seo.erudience.com/
import nodemailer from "npm:nodemailer@6.9.16";
import { runNotify } from "./core.mjs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "not configured" }, 500);
  const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
  };
  const secret = req.headers.get("x-scan-secret") || "";
  if (!secret || !(await rpc("scan_secret_ok", { p_secret: secret }).catch(() => false))) return json({ error: "forbidden" }, 403);

  const portalUrl = Deno.env.get("PORTAL_URL") || "https://seo.erudience.com/";
  const invite = async (email: string, { redirectTo }: { redirectTo: string }) => {
    const r = await fetch(`${url}/auth/v1/invite`, { method: "POST", headers, body: JSON.stringify({ email, redirect_to: redirectTo }) });
    if (r.ok) return { ok: true };
    const t = await r.text();
    return /already been registered|already registered|email_exists/i.test(t) ? { alreadyRegistered: true } : { error: `HTTP ${r.status} ${t.slice(0, 120)}` };
  };
  const host = Deno.env.get("SMTP_HOST"), user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS"), from = Deno.env.get("SMTP_FROM") || user;
  const port = Number(Deno.env.get("SMTP_PORT") || 465);
  const transport = host && user && pass ? nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }) : null;
  const sendMail = transport ? (m: { to: string; subject: string; text: string; html: string }) => transport.sendMail({ from, ...m }) : null;
  try { return json({ ok: true, ...(await runNotify({ rpc, invite, sendMail, portalUrl })) }); }
  catch (e) { return json({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 500); }
});
