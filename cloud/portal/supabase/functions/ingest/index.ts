// Ingest: a website's daily snapshot, sent by `seo-autopilot run portal --push` with the site's token as a bearer token,
// and the decisions people made in the portal on its proposals, handed back so the site's own run applies them on GitHub.
// Body: { snapshot?: {...}, applied?: [decision ids the run applied] }. The token is checked by the database functions
// (only its hash is stored); this function forwards with the service role. No dependencies.
const MAX_BYTES = 4 * 1024 * 1024;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST a JSON body: { snapshot, applied }" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^spt_[a-f0-9]{64}$/.test(token)) return json({ error: "missing or malformed site token" }, 401);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: "snapshot larger than 4 MB" }, 413);
  let body: { snapshot?: unknown; applied?: unknown };
  try { body = JSON.parse(raw); } catch { return json({ error: "body is not JSON" }, 400); }
  const { snapshot } = body;
  if (snapshot !== undefined && (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))) return json({ error: "snapshot must be an object" }, 400);
  const applied = Array.isArray(body.applied) ? body.applied.filter((x) => Number.isInteger(x) && x > 0).slice(0, 500) : [];
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "portal is not configured" }, 500);
  const rpc = async (fn: string, args: unknown) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    return { ok: r.ok, out: await r.json().catch(() => ({})) };
  };
  let saved: Record<string, unknown> = {};
  if (snapshot) {
    const { ok, out } = await rpc("ingest_snapshot", { p_token: token, p_data: snapshot });
    if (!ok) return json({ error: "could not save the snapshot" }, 502);
    if (out?.error) return json({ error: out.error }, out.error === "unknown token" ? 401 : 400);
    saved = out;
  }
  const { ok, out } = await rpc("sync_decisions", { p_token: token, p_applied: applied });
  if (!ok) return json({ ...saved, decisions: [], warning: "could not read decisions" });
  if (out?.error) return json({ error: out.error }, out.error === "unknown token" ? 401 : 400);
  return json({ ok: true, ...saved, decisions: out.decisions || [] });
});
