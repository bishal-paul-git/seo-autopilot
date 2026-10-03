// IndexNow: tells Bing, Yandex, Seznam and Naver about up to N changed or new URLs per day.
// IMPORTANT: Google does NOT use IndexNow. For Google, rely on sitemap + internal links + manual
// "Request indexing" in Search Console (the Indexing API is not allowed for ordinary pages).
//
//   INDEXNOW_KEY_EXAMPLE=<key> node indexnow.mjs [siteId] [--dry]
//
// Setup per site (one time): choose a key (8-128 chars, letters/digits/dashes), host a plain-text
// file at <site>/<key>.txt containing only the key, and export it in the env var named by
// sites.json -> indexNowKeyEnv. The key is public by design, but keep it out of this repo anyway.
// Picks URLs not yet submitted (or submitted longest ago) and records them in reports/<id>/indexnow-state.json.
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const cfg = JSON.parse(readFileSync(new URL("./sites.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const only = args.find((a) => !a.startsWith("--"));

for (const site of cfg.sites.filter((s) => !only || s.id === only)) {
  const key = process.env[site.indexNowKeyEnv];
  if (!key) { console.log(`${site.id}: set ${site.indexNowKeyEnv} (see header of this file). Skipped.`); continue; }
  const host = new URL(site.url).host;
  const keyLocation = `${site.url}${key}.txt`;
  const check = await fetch(keyLocation).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (check.trim() !== key) { console.log(`${site.id}: key file not live at ${keyLocation}. Skipped.`); continue; }

  const dir = fileURLToPath(new URL(`./reports/${site.id}`, import.meta.url));
  mkdirSync(dir, { recursive: true });
  const stateFile = `${dir}/indexnow-state.json`;
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { sent: {} };
  const sm = await (await fetch(site.sitemap)).text();
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const batch = urls.sort((a, b) => (state.sent[a] || "").localeCompare(state.sent[b] || "")).slice(0, site.indexNowPerDay ?? cfg.defaults.indexNowPerDay);
  if (dry) { console.log(`${site.id} would submit:\n` + batch.join("\n")); continue; }

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
  });
  console.log(`${site.id}: IndexNow HTTP ${res.status} for ${batch.length} URLs`);
  if (res.status === 200 || res.status === 202) {
    const now = new Date().toISOString();
    for (const u of batch) state.sent[u] = now;
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
}
