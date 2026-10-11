// IndexNow: tells Bing, Yandex, Seznam and Naver about up to N new or changed URLs per day.
// IMPORTANT: Google does NOT use IndexNow. For Google rely on the sitemap, internal links and the manual
// "Request indexing" button (the Indexing API is not allowed for ordinary pages).
//
// Setup per site (one time): choose a key (8-128 chars, letters, digits, dashes), host a plain-text file at
// <site>/<key>.txt containing only the key, and export the key in the env var named by site.indexNow.keyEnv.
import { readJson, writeJson } from "../core/util.mjs";

export const description = "Send up to N URLs a day to Bing, Yandex and others through IndexNow";

export async function run({ site, flags }) {
  const key = process.env[site.indexNow.keyEnv];
  if (!key) { console.log(`${site.id}: set ${site.indexNow.keyEnv} (see docs/indexnow.md). Skipped.`); return; }
  const host = new URL(site.url).host;
  const keyLocation = `${site.url}${key}.txt`;
  const check = await fetch(keyLocation).then((r) => (r.ok ? r.text() : "")).catch(() => "");
  if (check.trim() !== key) { console.log(`${site.id}: key file not live at ${keyLocation}. Skipped.`); return; }

  const stateFile = `${site.paths.state}/indexnow-state.json`;
  const state = readJson(stateFile, { sent: {} });
  const sm = await (await fetch(site.sitemap)).text();
  const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const batch = urls.sort((a, b) => (state.sent[a] || "").localeCompare(state.sent[b] || "")).slice(0, site.indexNowPerDay ?? 10);
  if (flags.dry) { console.log(`${site.id} would submit:\n` + batch.join("\n")); return; }

  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation, urlList: batch }),
  });
  console.log(`${site.id}: IndexNow HTTP ${res.status} for ${batch.length} URLs`);
  if (res.status === 200 || res.status === 202) {
    const now = new Date().toISOString();
    for (const u of batch) state.sent[u] = now;
    writeJson(stateFile, state);
  }
}
