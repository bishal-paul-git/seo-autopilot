// Small Web Crypto helpers (the same API in Cloudflare Workers and Node 20+). No dependencies.
const enc = new TextEncoder(), dec = new TextDecoder();

export const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** An unguessable token (256 bits by default). */
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** SHA-256 of a string as base64url: PKCE S256, and the KV key for tokens (raw tokens are never stored). */
export const sha256 = async (s) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(String(s))));

/** Compare two strings in time that does not depend on where they differ. */
export function same(a, b) {
  a = String(a ?? ""); b = String(b ?? "");
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

// AES-256-GCM with the TOKEN_KEY secret (32 random bytes, base64). GitHub tokens are stored only in this form.
const keys = new Map();
const keyOf = (secret) => {
  if (!keys.has(secret)) {
    const raw = Uint8Array.from(atob(String(secret || "")), (c) => c.charCodeAt(0));
    if (raw.length !== 32) throw new Error("TOKEN_KEY must be 32 random bytes, base64-encoded.");
    keys.set(secret, crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]));
  }
  return keys.get(secret);
};
export async function seal(secret, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await keyOf(secret), enc.encode(JSON.stringify(value)));
  return `${b64url(iv)}.${b64url(ct)}`;
}
export async function unseal(secret, sealed) {
  try {
    const [iv, ct] = String(sealed).split(".");
    return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64url(iv) }, await keyOf(secret), unb64url(ct))));
  } catch { return null; }
}
