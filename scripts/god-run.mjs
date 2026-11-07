#!/usr/bin/env node
// Run SEO God scheduler ticks (src/god/tick.mjs).
//   Against Supabase (production shape): SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set; node scripts/god-run.mjs
//   Dry run in memory on real websites:  node scripts/god-run.mjs --memory https://example.com [more URLs] [--approve]
// --approve only exists in memory mode: it plays the agency (approves each waiting job) to show the full flow. It is
// refused against Supabase, where approvals only come from agency people in the portal.
// Settings: SEO_GOD_PAUSED=true (kill switch), SEO_GOD_DAILY_BUDGET_USD (per site, default 0: free work only),
// SEO_GOD_AGENT_RUN_USD (estimate per agent run, default 0.5), SEO_GOD_MAX_JOBS (per tick, default 5).
// Prints one JSON report per tick. Nothing is scheduled by this script; it is not deployed anywhere.
import { MemoryStore, SupabaseStore } from "../src/god/stores.mjs";
import { makeHandlers } from "../src/god/handlers.mjs";
import { tick } from "../src/god/tick.mjs";

const args = process.argv.slice(2);
const env = process.env;
const opts = {
  paused: /^(1|true|yes)$/i.test(env.SEO_GOD_PAUSED || ""),
  dailyBudgetUsd: Number(env.SEO_GOD_DAILY_BUDGET_USD || 0), agentRunUsd: Number(env.SEO_GOD_AGENT_RUN_USD || 0.5), maxJobs: Number(env.SEO_GOD_MAX_JOBS || 5),
  log: (m) => console.error(m),
};

if (args[0] === "--memory") {
  const urls = args.slice(1).filter((a) => !a.startsWith("--")), approve = args.includes("--approve");
  if (!urls.length) { console.error("usage: node scripts/god-run.mjs --memory <url> [url...] [--approve]"); process.exit(2); }
  const store = new MemoryStore();
  store.sites = urls.map((url, i) => ({ id: `site-${i + 1}`, name: new URL(url).hostname, url }));
  const handlers = makeHandlers({ store, siteOf: async (id) => store.sites.find((s) => s.id === id) });
  for (let round = 1; round <= (approve ? 4 : 1); round++) {
    const t0 = Date.now(), r = await tick({ store, handlers, ...opts });
    console.log(JSON.stringify({ round, ms: Date.now() - t0, ...r }, null, 1));
    if (!approve) break;
    for (const j of store.jobs.values()) if (j.status === "awaiting_approval") store.approve(j.id, "approve", "dry-run agency");
  }
  for (const s of store.sites) console.log(JSON.stringify({ site: s.url, strategy: store.readMemory(s.id, "strategy")[0]?.value?.status ?? null, facts: store.readMemory(s.id, "identity").length, questions: store.readMemory(s.id, "question").length, jobs: store.listJobs(s.id).map((j) => `${j.kind}:${j.status}`) }));
} else {
  if (args.includes("--approve")) { console.error("--approve is only for --memory dry runs: approvals come from the agency in the portal"); process.exit(2); }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use --memory"); process.exit(2); }
  const store = new SupabaseStore({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY });
  const sites = await store.listSites();
  const handlers = makeHandlers({ store, siteOf: async (id) => sites.find((s) => s.id === id) });
  console.log(JSON.stringify(await tick({ store, sites, handlers, ...opts }), null, 1));
}
