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

/**
 * Visits for the portal: sessions and users over the last `days` days against the `days` before, by channel (organic
 * search, direct, referral...), source, country and device. One runReport per dimension, both windows in one call.
 */
export async function traffic(propertyId, token, { days = 28, fetchFn = fetch } = {}) {
  const ranges = [{ startDate: `${days}daysAgo`, endDate: "yesterday", name: "cur" }, { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo`, name: "prev" }];
  const report = async (dimension) => {
    const j = await getJson(fetchFn, "GA4 Data API", `${DATA}/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ dateRanges: ranges, dimensions: dimension ? [{ name: dimension }] : [], metrics: [{ name: "sessions" }, { name: "totalUsers" }], limit: 50 }),
    });
    const out = { cur: [], prev: [] };
    for (const r of j.rows || []) {
      const dims = (r.dimensionValues || []).map((d) => d.value);
      // With two date ranges the API adds a dateRange dimension last; with none requested it is the only one.
      const range = dims.at(-1) === "prev" ? "prev" : "cur", key = dimension ? dims[0] : "total";
      out[range].push({ key, sessions: Number(r.metricValues?.[0]?.value || 0), users: Number(r.metricValues?.[1]?.value || 0) });
    }
    return out;
  };
  const total = await report(null), channels = await report("sessionDefaultChannelGroup"), sources = await report("sessionSource");
  const countries = await report("country"), devices = await report("deviceCategory");
  return { days, total, channels, sources, countries, devices };
}
