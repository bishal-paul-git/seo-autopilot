// A cost guard for tests that go through a DataForSEO caller with an injected fetch: in-memory ledger, a fixed balance, no alerts.
import { createCostGuard, memoryLedger } from "../src/lib/dataforseo.mjs";

export const DFS_ENV = { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" };
export function testGuard({ fetch, env = DFS_ENV, balance = 100, cfg = {}, job = "test", ledger = memoryLedger(), notify = async () => ({ sent: false, reason: "test" }), now } = {}) {
  return createCostGuard({ cfg, job, env, fetch, ledger, getBalance: async () => balance, notify, now });
}
