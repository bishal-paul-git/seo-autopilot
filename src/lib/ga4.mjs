// GA4 reads for the conversions job. Two calls, both read-only with the analytics.readonly scope:
//   Data API   properties/{id}:runReport          event names and counts (the same API the digest uses in production)
//   Admin API  properties/{id}/keyEvents          which events are marked as key events
// The Admin API call follows Google's public reference and has only been tested with mocked responses so far.
// `fetchFn` is injectable so tests never touch the network. The token is never logged or put in an error.

const DATA = "https://analyticsdata.googleapis.com/v1beta";
const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";

async function getJson(fetchFn, name, url, init) {
  let r;
  try { r = await fetchFn(url, { ...init, signal: AbortSignal.timeout(30000) }); } catch (e) { throw new Error(`${name}: request failed (${e.name || "error"})`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}${r.status === 403 ? " (give the service account Viewer access to the GA4 property)" : ""}${j.error?.message ? `: ${String(j.error.message).slice(0, 200)}` : ""}`);
  return j;
}

/** [{ name, count }] for every event GA4 received from `days` days ago to yesterday. */
export async function eventCounts(propertyId, token, { days = 28, fetchFn = fetch } = {}) {
  const j = await getJson(fetchFn, "GA4 Data API", `${DATA}/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }], dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }], limit: 500 }),
  });
  return (j.rows || []).map((r) => ({ name: r.dimensionValues?.[0]?.value || "", count: Number(r.metricValues?.[0]?.value || 0) })).filter((e) => e.name);
}

/** Names of the events marked as key events, following page tokens. */
export async function keyEvents(propertyId, token, { fetchFn = fetch } = {}) {
  const names = [];
  let page = "";
  for (let i = 0; i < 20; i++) {
    const q = new URLSearchParams({ pageSize: "200", ...(page ? { pageToken: page } : {}) });
    const j = await getJson(fetchFn, "GA4 Admin API", `${ADMIN}/properties/${encodeURIComponent(propertyId)}/keyEvents?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    for (const k of j.keyEvents || []) if (k.eventName) names.push(k.eventName);
    if (!j.nextPageToken) break;
    page = j.nextPageToken;
  }
  return names;
}
