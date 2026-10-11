// Minimal Google service-account auth (no dependencies).
// Cloud runs pass the key as a secret in GOOGLE_KEY_JSON; local runs use GOOGLE_KEY_FILE (a path OUTSIDE the repository).
// Never commit key files.
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const b64 = (b) => Buffer.from(b).toString("base64url");

export const googleKeyAvailable = () => Boolean(process.env.GOOGLE_KEY_JSON || process.env.GOOGLE_KEY_FILE);

export async function getToken(scopes) {
  const file = process.env.GOOGLE_KEY_FILE;
  if (!file && !process.env.GOOGLE_KEY_JSON) {
    throw new Error("Set GOOGLE_KEY_JSON (cloud secret) or GOOGLE_KEY_FILE (path to the service-account JSON, outside the repo).");
  }
  const key = JSON.parse(process.env.GOOGLE_KEY_JSON || readFileSync(file, "utf8"));
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({ iss: key.client_email, scope: scopes.join(" "), aud: key.token_uri, iat: now, exp: now + 3600 }));
  const sig = createSign("RSA-SHA256").update(`${head}.${claim}`).sign(key.private_key, "base64url");
  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Google token error: " + JSON.stringify(j));
  return { token: j.access_token, email: key.client_email };
}

export const SCOPES = {
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
};

/** Search Console searchAnalytics.query helper bound to one site. */
export function searchAnalytics(site, token) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return async (startDate, endDate, dimensions, rowLimit) => {
    const r = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(site.searchConsoleProperty)}/searchAnalytics/query`, {
      method: "POST", headers, body: JSON.stringify({ startDate, endDate, dimensions, rowLimit }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`Search Console: ${j.error.message}`);
    return j.rows || [];
  };
}
