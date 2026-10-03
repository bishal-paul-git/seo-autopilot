// Minimal Google service-account auth (no dependencies). The key file path comes from
// GOOGLE_KEY_FILE and must live OUTSIDE the repository. Never commit key files.
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const b64 = (b) => Buffer.from(b).toString("base64url");

export async function getToken(scopes) {
  // Cloud runs pass the key as a secret in GOOGLE_KEY_JSON; local runs use a file path.
  const file = process.env.GOOGLE_KEY_FILE;
  if (!file && !process.env.GOOGLE_KEY_JSON) throw new Error("Set GOOGLE_KEY_JSON (cloud secret) or GOOGLE_KEY_FILE (path outside the repo).");
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
  if (!j.access_token) throw new Error("Token error: " + JSON.stringify(j));
  return { token: j.access_token, email: key.client_email };
}
