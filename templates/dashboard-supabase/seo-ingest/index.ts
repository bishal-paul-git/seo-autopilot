// Receives the daily SEO results from the GitHub Actions job and stores them for /admin/seo.
// Auth: header x-ingest-token must equal the secret SEO_INGEST_TOKEN (no Supabase JWT, hence verify_jwt=false).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

const same = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const expected = Deno.env.get("SEO_INGEST_TOKEN");
  if (!expected) return json({ error: "not_configured" }, 503);
  if (!same(req.headers.get("x-ingest-token") ?? "", expected)) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "bad_json" }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const s = body.summary;
  if (s?.day) {
    const { error } = await db.from("seo_daily_summary").upsert({
      day: String(s.day).slice(0, 10), clicks: Number(s.clicks) || 0, impressions: Number(s.impressions) || 0,
      ctr: Number(s.ctr) || 0, position: Number(s.position) || 0,
      inspected: Number(s.inspected) || 0, not_indexed: Number(s.not_indexed) || 0,
    });
    if (error) return json({ error: "summary_failed" }, 500);
  }

  const rows = (Array.isArray(body.inspections) ? body.inspections : []).slice(0, 500).map((r: Record<string, unknown>) => ({
    url: String(r.url).slice(0, 500), checked_at: r.checked_at ?? new Date().toISOString(),
    coverage: r.coverage ?? null, fetch_state: r.fetch_state ?? null,
    last_crawl: r.last_crawl ?? null, google_canonical: r.google_canonical ?? null,
  }));
  if (rows.length) {
    const { error } = await db.from("seo_inspections").upsert(rows);
    if (error) return json({ error: "inspections_failed" }, 500);
  }
  // Autopilot payloads (all optional).
  const trim = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));
  const backlinks = (Array.isArray(body.backlinks) ? body.backlinks : []).slice(0, 200).map((r: Record<string, unknown>) => ({
    target_id: String(r.target_id).slice(0, 80), name: String(r.name ?? r.target_id).slice(0, 120), submit_url: trim(r.submit_url, 500),
    mode: trim(r.mode, 20), status: String(r.status ?? "pending").slice(0, 30), attempts: Number(r.attempts) || 0,
    last_attempt: trim(r.last_attempt, 10), next_attempt: trim(r.next_attempt, 10), note: trim(r.note, 300), updated_at: new Date().toISOString(),
  }));
  if (backlinks.length) {
    const { error } = await db.from("seo_backlinks").upsert(backlinks);
    if (error) return json({ error: "backlinks_failed" }, 500);
  }
  if (body.digest?.week && body.digest?.markdown) {
    const { error } = await db.from("seo_digests").upsert({ week: String(body.digest.week).slice(0, 10), markdown: String(body.digest.markdown).slice(0, 20000) });
    if (error) return json({ error: "digest_failed" }, 500);
  }
  const topics = (Array.isArray(body.topics) ? body.topics : []).slice(0, 300).map((r: Record<string, unknown>) => ({
    query: String(r.query).slice(0, 120), kind: trim(r.kind, 60), impressions: Number(r.impressions) || 0,
    position: r.position == null ? null : Number(r.position), status: String(r.status ?? "new").slice(0, 20), unverified: r.unverified === true, updated_at: new Date().toISOString(),
  }));
  if (topics.length) {
    const { error } = await db.from("seo_topics").upsert(topics);
    if (error) return json({ error: "topics_failed" }, 500);
  }
  return json({ ok: true, inspections: rows.length, backlinks: backlinks.length, topics: topics.length });
});
