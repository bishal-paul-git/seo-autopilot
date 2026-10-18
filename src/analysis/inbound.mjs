// Inbound links (backlinks) from an export you download: Search Console's Links report, or a CSV from a backlink tool.
// Pure: parse the CSV text, match it to your crawl, and say what is worth acting on. It never contacts anyone and never
// writes a disavow file: Google's guidance is that most sites never need one, so risky patterns go to a person to review.
//
// Columns are found by name, case-insensitively, because exports differ between tools and change over time. Tested on
// sample files shaped like these exports, not yet on a real download.

const COLUMNS = {
  source: ["linking page", "referring page url", "referring page", "source url", "source", "from url", "url from", "backlink url"],
  target: ["target page", "target url", "linked page", "to url", "url to", "destination"],
  anchor: ["anchor text", "anchor"],
  site: ["site", "linking site", "referring domain", "domain"],
  links: ["linking pages", "incoming links", "links", "backlinks"],
  date: ["last crawled", "first seen", "last seen", "date"],
};

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, commas, tabs or semicolons, CRLF. Returns rows of strings. */
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] || "";
  const sep = [",", "\t", ";"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** Map a header row to known columns. Returns { source, target, anchor, site, links, date } as column indexes (or -1). */
export function matchColumns(header) {
  const h = header.map((x) => String(x).trim().toLowerCase());
  return Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, h.findIndex((x) => names.includes(x))]));
}

const host = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const path = (u, siteHost) => { try { const x = new URL(u); return host(x.href) === siteHost ? x.pathname : null; } catch { return u.startsWith("/") ? u : null; } };

/**
 * Read one export. Returns { kind, rows } where kind is "links" (one row per linking page, maybe with target and anchor),
 * "sites" (one row per linking domain with a count), "targets" (one row per page of yours with a count) or "unknown".
 */
export function readExport(text, siteHost) {
  const rows = parseCsv(text);
  if (!rows.length) return { kind: "unknown", rows: [] };
  const c = matchColumns(rows[0]);
  const body = rows.slice(1);
  const cell = (r, k) => (c[k] >= 0 ? String(r[c[k]] ?? "").trim() : "");
  const num = (r) => Number(cell(r, "links").replace(/[^0-9.]/g, "")) || 0;
  if (c.source >= 0) return { kind: "links", rows: body.map((r) => ({ source: cell(r, "source"), domain: host(cell(r, "source")), target: c.target >= 0 ? path(cell(r, "target"), siteHost) : null, anchor: cell(r, "anchor") || null, date: cell(r, "date") || null })).filter((r) => r.domain && r.domain !== siteHost) };
  if (c.target >= 0 && c.links >= 0) return { kind: "targets", rows: body.map((r) => ({ target: path(cell(r, "target"), siteHost), links: num(r) })).filter((r) => r.target) };
  if (c.site >= 0) return { kind: "sites", rows: body.map((r) => ({ domain: host(cell(r, "site")), links: num(r) })).filter((r) => r.domain && r.domain !== siteHost) };
  return { kind: "unknown", rows: [], header: rows[0] };
}

/**
 * What to act on. `exports` are readExport results; `pages` are audit.json pages ({ url, status, finalUrl }); `previous` is the
 * last snapshot ({ domains: [] }) to report new and lost linking domains.
 *   reclaim: links pointing at a page of yours that errors (404/410/5xx): redirect it, or ask for the link to be updated
 *   redirected: links pointing at a URL that redirects: fine, but the linker could point at the final URL
 *   review: patterns a person should look at (one domain linking from very many pages, one anchor on most links). Never
 *           an instruction to disavow.
 */
export function analyseInbound(exports, { siteHost, pages = [], previous = null, sitewideAt = 50, anchorShare = 0.5 } = {}) {
  const links = exports.filter((e) => e.kind === "links").flatMap((e) => e.rows);
  const domainCounts = new Map();
  for (const l of links) domainCounts.set(l.domain, (domainCounts.get(l.domain) || 0) + 1);
  for (const e of exports.filter((x) => x.kind === "sites")) for (const r of e.rows) domainCounts.set(r.domain, Math.max(domainCounts.get(r.domain) || 0, r.links || 1));
  const targetCounts = new Map();
  for (const l of links) if (l.target) targetCounts.set(l.target, (targetCounts.get(l.target) || 0) + 1);
  for (const e of exports.filter((x) => x.kind === "targets")) for (const r of e.rows) targetCounts.set(r.target, Math.max(targetCounts.get(r.target) || 0, r.links));

  const pageAt = new Map(pages.map((p) => [path(p.url, siteHost) ?? p.url, p]));
  const reclaim = [], redirected = [];
  for (const [t, n] of targetCounts) {
    const p = pageAt.get(t) || pageAt.get(t.replace(/\/$/, "")) || pageAt.get(t + "/");
    if (!p || p.status == null) continue;
    const sources = links.filter((l) => l.target === t).slice(0, 5).map((l) => l.source);
    if (p.status >= 400) reclaim.push({ target: t, status: p.status, links: n, sources });
    else if (p.status >= 300 || (p.finalUrl && path(p.finalUrl, siteHost) !== t)) redirected.push({ target: t, to: p.finalUrl ? path(p.finalUrl, siteHost) : null, links: n });
  }

  const review = [];
  for (const [d, n] of domainCounts) if (n >= sitewideAt) review.push({ kind: "sitewide", domain: d, links: n, note: `${n} linking pages from one site, often a footer or sidebar link. Fine if it is a real partner; review if you did not arrange it.` });
  const anchors = links.filter((l) => l.anchor);
  if (anchors.length >= 20) {
    const by = new Map();
    for (const l of anchors) { const a = l.anchor.toLowerCase(); by.set(a, (by.get(a) || 0) + 1); }
    const [top, n] = [...by].sort((a, b) => b[1] - a[1])[0];
    if (n / anchors.length >= anchorShare) review.push({ kind: "anchor-concentration", anchor: top, share: Math.round((n / anchors.length) * 100), note: `"${top}" is the anchor on ${n} of ${anchors.length} links. Natural profiles mix brand, URL and descriptive anchors; a dominant keyword anchor can look arranged.` });
  }

  const domains = [...domainCounts.keys()].sort();
  const prev = new Set(previous?.domains || []);
  return {
    totals: { links: links.length, domains: domains.length, targets: targetCounts.size },
    topDomains: [...domainCounts].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([domain, links]) => ({ domain, links })),
    topTargets: [...targetCounts].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([target, links]) => ({ target, links })),
    reclaim: reclaim.sort((a, b) => b.links - a.links),
    redirected: redirected.sort((a, b) => b.links - a.links).slice(0, 20),
    review,
    newDomains: previous ? domains.filter((d) => !prev.has(d)) : [],
    lostDomains: previous ? [...prev].filter((d) => !domainCounts.has(d)).sort() : [],
    domains,
  };
}
