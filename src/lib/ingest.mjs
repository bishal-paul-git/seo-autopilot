// Optional dashboard sync. If a site config has  "ingest": { "urlEnv": "SEO_INGEST_URL", "tokenEnv": "SEO_INGEST_TOKEN" }
// and both env vars are set, results are POSTed to your own endpoint (see templates/dashboard for a Supabase one).
export function ingestEnabled(site) {
  const c = site.ingest;
  return Boolean(c && process.env[c.urlEnv] && process.env[c.tokenEnv]);
}

export async function ingest(site, payload) {
  if (!ingestEnabled(site)) return null;
  const c = site.ingest;
  const res = await fetch(process.env[c.urlEnv], {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-ingest-token": process.env[c.tokenEnv] },
    body: JSON.stringify(payload),
  });
  console.log(`${site.id}: ingest HTTP ${res.status}`);
  return res.status;
}
