// An in-memory stand-in for the EmDash 0.1.0 content API, with the behaviour the mirror depends on (read in EmDash's
// source): data saves on a "revisions" collection go to a draft revision and leave the live row alone; publish copies
// the draft into the row; SEO writes go live at once; _rev = base64(version:updatedAt). Synthetic content only.

export function fakeEmDash({ revisions = true, seo = true, schemaReadable = false, previewSecret = false, posts = [] } = {}) {
  let clock = Date.parse("2026-01-01T00:00:00Z");
  let n = 0;
  const now = () => new Date((clock += 1000)).toISOString();
  const id = () => `01FAKE${String(++n).padStart(20, "0")}`;
  const rows = new Map();
  const revs = new Map();
  const seoRows = new Map();
  const log = [];
  for (const p of posts) {
    const rid = id();
    const row = { id: rid, type: "posts", slug: p.slug, status: p.status || "published", data: structuredClone(p.data), authorId: "u1", primaryBylineId: null, createdAt: now(), updatedAt: now(), publishedAt: p.publishedAt === undefined ? now() : p.publishedAt, scheduledAt: null, liveRevisionId: null, draftRevisionId: null, version: 1, locale: "en", translationGroup: rid, terms: p.terms || {} };
    rows.set(rid, row);
    if (seo) seoRows.set(rid, { title: null, description: null, image: null, canonical: null, noIndex: false, ...(p.seo || {}) });
  }
  const find = (k) => rows.get(k) || [...rows.values()].find((r) => r.slug === k);
  const view = (r) => { const { terms, ...v } = structuredClone(r); if (seo) v.seo = { ...seoRows.get(r.id) }; return v; };
  const rev = (r) => Buffer.from(`${r.version}:${r.updatedAt}`).toString("base64");
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const ok = (data, status = 200) => json(status, { data });
  const err = (status, code, message = code) => json(status, { error: { code, message } });

  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : undefined;
    log.push({ method, path: u.pathname + u.search, auth: !!init.headers?.authorization });
    const p = u.pathname;
    if (p.startsWith("/_emdash/api/") && !init.headers?.authorization) return err(401, "NOT_AUTHENTICATED");
    if (p === "/_emdash/api/schema/collections/posts") return schemaReadable ? ok({ item: { slug: "posts", supports: revisions ? ["drafts", "revisions", "seo"] : ["drafts"] } }) : err(403, "INSUFFICIENT_SCOPE");
    let m;
    if (p === "/_emdash/api/content/posts" && method === "GET") {
      const status = u.searchParams.get("status");
      const items = [...rows.values()].filter((r) => !status || r.status === status).map(view);
      return ok({ items });
    }
    if (p === "/_emdash/api/content/posts" && method === "POST") {
      const rid = id();
      const row = { id: rid, type: "posts", slug: body.slug, status: body.status || "draft", data: structuredClone(body.data), authorId: "u1", primaryBylineId: null, createdAt: now(), updatedAt: now(), publishedAt: null, scheduledAt: null, liveRevisionId: null, draftRevisionId: null, version: 1, locale: "en", translationGroup: rid, terms: {} };
      rows.set(rid, row);
      if (seo) seoRows.set(rid, { title: null, description: null, image: null, canonical: null, noIndex: false, ...(body.seo || {}) });
      return ok({ item: view(row), _rev: rev(row) }, 201);
    }
    if ((m = p.match(/^\/_emdash\/api\/content\/posts\/([^/]+)(?:\/(.+))?$/))) {
      const r = find(decodeURIComponent(m[1]));
      if (!r) return err(404, "NOT_FOUND");
      const sub = m[2];
      if (!sub && method === "GET") return ok({ item: view(r), _rev: rev(r) });
      if (!sub && method === "PUT") {
        if (body._rev && body._rev !== rev(r)) return err(409, "CONFLICT", "Content has been modified since last read (version conflict)");
        if (body.seo && !seo) return err(400, "VALIDATION_ERROR");
        if (body.data) {
          if (revisions) {
            const baseData = r.draftRevisionId ? revs.get(r.draftRevisionId).data : r.data;
            const rid = id();
            revs.set(rid, { id: rid, data: { ...baseData, ...structuredClone(body.data) } });
            r.draftRevisionId = rid;
          } else r.data = { ...r.data, ...structuredClone(body.data) };
        }
        if (body.status) r.status = body.status;
        if (body.seo) { const s = seoRows.get(r.id); for (const [k, v] of Object.entries(body.seo)) if (v !== undefined) s[k] = v; }
        r.updatedAt = now();
        r.version++;
        return ok({ item: view(r), _rev: rev(r) });
      }
      if (sub === "publish" && method === "POST") {
        let pick = r.draftRevisionId || r.liveRevisionId;
        if (!pick) { pick = id(); revs.set(pick, { id: pick, data: structuredClone(r.data) }); }
        const { _slug, ...data } = revs.get(pick).data;
        r.data = structuredClone(data);
        r.liveRevisionId = pick; r.draftRevisionId = null; r.status = "published";
        r.publishedAt = r.publishedAt || now(); r.updatedAt = now();
        return ok({ item: view(r) });
      }
      if (sub === "compare") return ok({ hasChanges: !!r.draftRevisionId && r.draftRevisionId !== r.liveRevisionId, live: r.liveRevisionId ? revs.get(r.liveRevisionId).data : null, draft: r.draftRevisionId ? revs.get(r.draftRevisionId).data : null });
      const t = sub?.match(/^terms\/(.+)$/);
      if (t) return ok({ terms: (r.terms[t[1]] || []).map((s) => ({ id: s, name: t[1], slug: s, label: s, parentId: null })) });
      if (sub === "preview-url") {
        if (!previewSecret) return err(500, "NOT_CONFIGURED", "Preview not configured. Set EMDASH_PREVIEW_SECRET environment variable.");
        const path = (body?.pathPattern || "/{collection}/{id}").replace("{collection}", "posts").replace("{id}", decodeURIComponent(m[1]));
        return ok({ url: `${path}?_preview=signed-${r.id}`, expiresAt: 0 });
      }
    }
    // Public site: published posts only, drafts with a valid preview token.
    if ((m = p.match(/^\/posts\/(.+)$/))) {
      const r = find(decodeURIComponent(m[1]));
      const previewing = r && u.searchParams.get("_preview") === `signed-${r.id}`;
      if (!r || (r.status !== "published" && !previewing)) return new Response("<html><main>Not found</main></html>", { status: 404 });
      const data = previewing && r.draftRevisionId ? revs.get(r.draftRevisionId).data : r.data;
      const text = (data.content || []).map((b) => (b.children || []).map((s) => s.text).join("")).join(" ");
      return new Response(`<html><head><title>x</title></head><body><nav>Home Blog</nav><main><h1>${data.title}</h1><p>${text}</p></main></body></html>`, { status: 200 });
    }
    if (p === "/sitemap.xml") return new Response(`<urlset>${[...rows.values()].filter((r) => r.status === "published").map((r) => `<url><loc>${u.origin}/posts/${encodeURIComponent(r.slug)}</loc></url>`).join("")}</urlset>`);
    if (p === "/rss.xml") return new Response(`<rss>${[...rows.values()].filter((r) => r.status === "published" && r.publishedAt).map((r) => `<link>${u.origin}/posts/${r.slug}</link>`).join("")}</rss>`);
    return err(404, "NOT_FOUND");
  }
  return { fetch, rows, revs, seoRows, log, find };
}
