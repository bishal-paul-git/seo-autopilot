// YouTube video results for how-to, review and comparison topics: request shape, parsing, quota errors without the key,
// the pure summary and the keywords job with recorded-style responses. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { youtube } from "../src/lib/youtube.mjs";
import { videoCandidates, videoSummary, videoMarkdown } from "../src/analysis/keywords.mjs";
import { validate } from "../src/core/config.mjs";

const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const SEARCH = { items: [{ id: { videoId: "a1" }, snippet: { title: "How to set up web hosting &amp; DNS", channelTitle: "Acme Hosting", publishedAt: "2025-03-01T10:00:00Z" } }, { id: { videoId: "b2" }, snippet: { title: "Web hosting tutorial", channelTitle: "Other", publishedAt: "2024-01-01T00:00:00Z" } }, { id: { kind: "youtube#channel" } }] };
const STATS = { items: [{ id: "a1", statistics: { viewCount: "12000" } }, { id: "b2", statistics: { viewCount: "3000" } }] };

test("videos: search then statistics; titles decoded; region and language from the market", async () => {
  const urls = [];
  const f = async (u) => { urls.push(String(u)); return res(String(u).includes("/search?") ? SEARCH : STATS); };
  const v = await youtube.videos("how to set up web hosting", "DE", { fetch: f, env: { YOUTUBE_API_KEY: "yt-key" } });
  assert.deepEqual(v[0], { title: "How to set up web hosting & DNS", url: "https://www.youtube.com/watch?v=a1", channel: "Acme Hosting", published: "2025-03-01", views: 12000 });
  assert.equal(v.length, 2, "channel results are left out");
  assert.match(urls[0], /youtube\/v3\/search\?.*type=video.*regionCode=DE.*relevanceLanguage=de/);
  assert.match(urls[1], /youtube\/v3\/videos\?part=statistics&id=a1%2Cb2/);
  assert.deepEqual(await youtube.videos("x", "GB", { fetch: async () => res({ items: [] }), env: { YOUTUBE_API_KEY: "k" } }), []);
});

test("errors: quota and bad key are explained; the key never appears", async () => {
  const env = { YOUTUBE_API_KEY: "yt-secret" };
  await assert.rejects(youtube.videos("x", "GB", { fetch: async () => res({ error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } }, 403), env }), (e) => /daily quota used up/.test(e.message) && !e.message.includes("yt-secret"));
  await assert.rejects(youtube.videos("x", "GB", { fetch: async () => res({ error: { message: "API key not valid", errors: [{ reason: "keyInvalid" }] } }, 400), env }), /youtube: key rejected/);
  assert.equal(youtube.enabled({}), false);
});

test("summary: video topics picked by wording, median views, own channel rank", () => {
  assert.deepEqual(videoCandidates([{ parent: "web hosting" }, { parent: "how to set up web hosting" }, { parent: "hosting vs vps" }], 5), ["how to set up web hosting", "hosting vs vps"]);
  const s = videoSummary("q", [{ title: "a", url: "u1", channel: "Other", views: 10 }, { title: "b", url: "u2", channel: "Acme Hosting", views: 30 }, { title: "c", url: "u3", channel: "X", views: null }], "acme hosting");
  assert.deepEqual([s.results, s.medianViews, s.ownRank], [3, 20, 2]);
  assert.equal(videoSummary("q", [{ channel: "Other", views: 1 }], "Acme").ownRank, null);
  assert.match(videoMarkdown([s], "Acme Hosting"), /\| q \| \[a\]\(u1\) \(Other; 10 views\) \| 20 \| #2 \|/);
  assert.match(videoMarkdown([videoSummary("q", [], "Acme")], "Acme"), /not in the top 10/);
  assert.equal(videoMarkdown([]), "");
});

test("config: research.youtubeChannel must be text", () => {
  const base = (r) => ({ sites: [{ id: "s", name: "S", url: "https://s.test/", research: r }] });
  assert.ok(validate(base({ youtubeChannel: 5 })).some((e) => /youtubeChannel/.test(e)));
  assert.ok(!validate(base({ youtubeChannel: "Acme" })).some((e) => /youtubeChannel/.test(e)));
});

test("keywords job: with a key, video topics get results; without, no call is made", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-yt-")), state = join(root, "state"); mkdirSync(state);
  writeFileSync(join(state, "gsc-rows.json"), JSON.stringify({ rows: [{ query: "how to set up web hosting", impressions: 300, clicks: 3, position: 9, page: "https://s.test/a" }] }));
  const site = { id: "s", name: "S", url: "https://s.test/", research: { youtubeChannel: "Acme Hosting" }, paths: { state, root, data: root } };
  const { run } = await import("../src/jobs/keywords.mjs");
  const hits = [];
  const f = async (u) => { u = String(u); hits.push(u); return u.includes("youtube/v3/search") ? res(SEARCH) : u.includes("youtube/v3/videos") ? res(STATS) : res({}, 404); };
  const log = console.log; console.log = () => {};
  try {
    await run({ site, flags: {}, positional: [] }, { env: { YOUTUBE_API_KEY: "k" }, fetch: f, delayMs: 0 });
    const r = JSON.parse(readFileSync(join(state, "keywords.json"), "utf8"));
    assert.equal(r.video[0].query, "how to set up web hosting"); assert.equal(r.video[0].ownRank, 1);
    assert.match(readFileSync(join(state, "keywords.md"), "utf8"), /Video results \(YouTube\)/);
    hits.length = 0;
    await run({ site, flags: {}, positional: [] }, { env: {}, fetch: f, delayMs: 0 });
    assert.ok(!hits.some((u) => u.includes("youtube")));
  } finally { console.log = log; }
});
