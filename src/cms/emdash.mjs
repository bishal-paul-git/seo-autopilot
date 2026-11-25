// EmDash content API client (https://github.com/emdash-cms/emdash), written against EmDash 0.1.0's REST routes.
// Auth: a personal access token (scopes content:read, content:write) sent as a Bearer header. The token is never
// logged or put in an error message. Responses are { data } on success and { error: { code, message } } on failure.
//
// Things 0.1.0 does that callers must respect (read in its source):
// - On a collection with "revisions", PUT with data writes a draft revision; the live row changes only on publish.
//   Without "revisions", PUT overwrites the live post. Check revisionsSupported() before any PUT on a live post.
// - SEO fields are written straight to the live SEO table on every PUT that carries them, even for a draft, so send
//   seo only when publishing.
// - PUT must not carry "status": that changes the live status at once.
// - POST /_emdash/api/revisions/{id}/restore writes the live row and skips the cache purge. Do not use it; to go back,
//   save the old content as a draft and publish it.

export class EmDashError extends Error {
  constructor(status, code, message, path) {
    super(`EmDash ${status} ${code}: ${message} (${path})`);
    this.status = status;
    this.code = code;
    this.path = path;
  }
}

/** opts: { url, token, fetch (for tests), userAgent } */
export function createClient({ url, token, fetch: f = globalThis.fetch, userAgent = "seo-autopilot-cms-mirror" } = {}) {
  if (!url) throw new Error("EmDash URL is missing (set EMDASH_URL or pass --url)");
  const base = String(url).replace(/\/+$/, "");
  const u = new URL(base);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) throw new Error(`EmDash URL must use https (got ${u.protocol}//${u.host})`);
  const calls = [];

  async function call(method, path, body) {
    const headers = { accept: "application/json", "user-agent": userAgent };
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await f(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    calls.push({ method, path, status: res.status });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok || json?.error) {
      const e = json?.error || {};
      throw new EmDashError(res.status, e.code || "HTTP_ERROR", e.message || (text ? text.slice(0, 120) : res.statusText), `${method} ${path}`);
    }
    return json && "data" in json ? json.data : json;
  }

  const enc = encodeURIComponent;
  const c = (collection) => `/_emdash/api/content/${enc(collection)}`;
  return {
    base,
    /** Every request made so far: [{ method, path, status }] (no headers, no bodies). */
    calls,
    async list(collection, { status, limit = 100, all = true } = {}) {
      const items = [];
      let cursor;
      do {
        const q = new URLSearchParams({ limit: String(limit) });
        if (status) q.set("status", status);
        if (cursor) q.set("cursor", cursor);
        const page = await call("GET", `${c(collection)}?${q}`);
        items.push(...(page?.items || []));
        cursor = all ? page?.nextCursor : undefined;
      } while (cursor);
      return items;
    },
    /** { item, _rev } or null when the id or slug does not exist. */
    async get(collection, idOrSlug) {
      try { return await call("GET", `${c(collection)}/${enc(idOrSlug)}`); }
      catch (e) { if (e.status === 404 || e.code === "NOT_FOUND") return null; throw e; }
    },
    async terms(collection, id, taxonomy) {
      return (await call("GET", `${c(collection)}/${enc(id)}/terms/${enc(taxonomy)}`))?.terms || [];
    },
    /** Live and draft data of an entry: { hasChanges, live, draft }. */
    compare: (collection, id) => call("GET", `${c(collection)}/${enc(id)}/compare`),
    revisions: (collection, id) => call("GET", `${c(collection)}/${enc(id)}/revisions`),
    /** Collection settings; needs the schema:read scope (403 with a content-only token). */
    schema: (collection) => call("GET", `/_emdash/api/schema/collections/${enc(collection)}`),
    /** Create a draft. Never sends seo or a status other than draft. */
    createDraft(collection, { slug, data }) {
      if (!slug) throw new Error("an explicit slug is required (EmDash's automatic slug drops non-Latin letters)");
      return call("POST", c(collection), { slug, status: "draft", data });
    },
    /** Save data as a draft revision of an existing entry. _rev: the token from the get() just before. */
    saveDraft(collection, id, { data, _rev }) {
      const body = { data };
      if (_rev) body._rev = _rev;
      return call("PUT", `${c(collection)}/${enc(id)}`, body);
    },
    /** Write the five SEO fields (they go live at once). Only for the publish step. */
    setSeo(collection, id, { seo, _rev }) {
      const body = { seo };
      if (_rev) body._rev = _rev;
      return call("PUT", `${c(collection)}/${enc(id)}`, body);
    },
    publish: (collection, id) => call("POST", `${c(collection)}/${enc(id)}/publish`, {}),
    /** A signed preview link for the draft; fails with NOT_CONFIGURED when the site has no EMDASH_PREVIEW_SECRET. */
    previewUrl: (collection, id, { expiresIn = "1d", pathPattern } = {}) =>
      call("POST", `${c(collection)}/${enc(id)}/preview-url`, pathPattern ? { expiresIn, pathPattern } : { expiresIn }),
  };
}

/**
 * Does the collection keep drafts apart from the live post? true / false when the schema could be read, or null when
 * the token cannot read the schema (then a probe on a non-live draft is the only safe proof; see preview-check).
 */
export async function revisionsSupported(client, collection) {
  try {
    const s = await client.schema(collection);
    const col = s?.item || s?.collection || s;
    return Array.isArray(col?.supports) ? col.supports.includes("revisions") : null;
  } catch (e) {
    if (e instanceof EmDashError && (e.status === 401 || e.status === 403)) return null;
    throw e;
  }
}
