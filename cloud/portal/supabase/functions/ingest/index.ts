// Ingest: a website's daily snapshot, sent by `seo-autopilot run portal --push` with the site's token as a bearer token.
// The token is checked by public.ingest_snapshot (only its hash is stored). This function only forwards the request with
// the service role, so the token and snapshot never touch the anon key. No dependencies.
const MAX_BYTES = 4 * 1024 * 1024;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST a JSON body: { snapshot }" }, 405);
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!/^spt_[a-f0-9]{64}$/.test(token)) return json({ error: "missing or malformed site token" }, 401);
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json({ error: "snapshot larger than 4 MB" }, 413);
  let snapshot: unknown;
  try { snapshot = JSON.parse(raw).snapshot; } catch { return json({ error: "body is not JSON" }, 400); }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return json({ error: "body must be { snapshot: {...} }" }, 400);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "portal is not configured" }, 500);
  const r = await fetch(`${url}/rest/v1/rpc/ingest_snapshot`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token, p_data: snapshot }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: "could not save the snapshot" }, 502);
  if (out?.error) return json({ error: out.error }, out.error === "unknown token" ? 401 : 400);
  return json(out);
});
