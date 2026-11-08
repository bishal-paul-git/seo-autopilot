// A fetch for crawling addresses that users type in (D25 hosted scan). Every request, and every redirect hop, is checked
// before it is sent: http(s) only, default ports only, no IP literals or names in private, loopback, link-local or
// metadata ranges, and (where the runtime can resolve names) no hostname that resolves into them. Bodies are capped.
// Residual risk: the name is resolved again by the runtime when it connects (DNS rebinding); see docs/security.md.

const V4_BLOCKED = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const v4num = (ip) => ip.split(".").reduce((n, o) => n * 256 + Number(o), 0);
export function isBlockedIPv4(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split(".").some((o) => Number(o) > 255)) return false;
  const n = v4num(ip);
  return V4_BLOCKED.some(([base, bits]) => { const size = 2 ** (32 - bits); return n >= v4num(base) && n < v4num(base) + size; });
}
export function isBlockedIPv6(ip) {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (!a.includes(":")) return false;
  if (a === "::" || a === "::1") return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return isBlockedIPv4(mapped[1]);
  if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(a)) return true; // mapped IPv4 in hex form: refuse rather than decode
  return /^(fc|fd|fe[89ab]|ff)/.test(a) || /^(64:ff9b|2001:db8|2001:10|2002)/.test(a);
}
const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa|localdomain)$|^metadata(\.google\.internal)?$|^instance-data$/i;

/** Why a URL may not be fetched, or "" when it may. Checks the URL only (no DNS). */
export function urlProblem(raw) {
  let u; try { u = new URL(raw); } catch { return "not a valid URL"; }
  if (!/^https?:$/.test(u.protocol)) return `scheme ${u.protocol} is not allowed`;
  if (u.username || u.password) return "credentials in the URL are not allowed";
  if (u.port && !["80", "443"].includes(u.port)) return `port ${u.port} is not allowed`;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") && !host.includes(":")) return "single-label hostnames are not allowed";
  if (isBlockedIPv4(host) || isBlockedIPv6(host)) return `address ${host} is private or reserved`;
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || /^[\d.]+$/.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "numeric hostnames are not allowed";
  if (BLOCKED_NAMES.test(host)) return `hostname ${host} is internal`;
  return "";
}

/** The runtime's resolver, when it has one (Deno or Node); null when names cannot be resolved here. */
export async function defaultResolver() {
  if (typeof Deno !== "undefined" && Deno.resolveDns) {
    return async (h) => { const out = []; for (const t of ["A", "AAAA"]) { try { out.push(...(await Deno.resolveDns(h, t))); } catch { /* none of this type */ } } return out; };
  }
  try { const dns = await import("node:dns"); return async (h) => (await dns.promises.lookup(h, { all: true })).map((x) => x.address); } catch { return null; }
}

/**
 * Wrap a fetch so every request and every redirect hop passes urlProblem() and, with a resolver, a DNS check.
 * opts: { resolve (async host -> addresses, or null to skip DNS), maxBytes (default 5 MB), maxHops (default 5) }
 * A refused request throws, so callers that already catch network errors (the crawler) record it as "no response".
 */
export function guardedFetch(fetchImpl = fetch, { resolve = null, maxBytes = 5_000_000, maxHops = 5 } = {}) {
  const checked = new Map();
  const check = async (url) => {
    const p = urlProblem(url); if (p) throw new Error(`refused: ${p}`);
    if (!resolve) return;
    const host = new URL(url).hostname.toLowerCase();
    if (!checked.has(host)) checked.set(host, (async () => {
      let addrs = []; try { addrs = await resolve(host); } catch { addrs = []; }
      const bad = addrs.find((a) => isBlockedIPv4(a) || isBlockedIPv6(a));
      return bad ? `refused: ${host} resolves to private address ${bad}` : "";
    })());
    const why = await checked.get(host); if (why) throw new Error(why);
  };
  const capped = async (res) => {
    const len = Number(res.headers.get("content-length") || 0);
    if (len > maxBytes) { try { await res.body?.cancel(); } catch { /* ignore */ } throw new Error(`refused: response of ${len} bytes is larger than ${maxBytes}`); }
    if (!res.body) return res;
    const reader = res.body.getReader(); const chunks = []; let total = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength; if (total > maxBytes) { try { await reader.cancel(); } catch { /* ignore */ } break; }
      chunks.push(value);
    }
    const body = new Uint8Array(Math.min(total, maxBytes)); let off = 0;
    for (const c of chunks) { body.set(c.subarray(0, body.length - off), off); off += c.byteLength; if (off >= body.length) break; }
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
  return async (input, init = {}) => {
    let url = String(input), hops = 0;
    for (;;) {
      await check(url);
      const res = await fetchImpl(url, { ...init, redirect: "manual" });
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!loc || init.redirect === "manual") return init.method === "HEAD" ? res : capped(res);
      if (++hops > maxHops) throw new Error("refused: too many redirects");
      try { await res.body?.cancel(); } catch { /* ignore */ }
      url = new URL(loc, url).toString();
    }
  };
}
