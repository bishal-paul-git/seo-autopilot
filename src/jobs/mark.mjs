// Record the outcome of a backlink listing that was done by hand.
//   npx seo-autopilot run mark <target-id> done|skipped|submitted [listing-url]
import { readJson, writeJson, today } from "../core/util.mjs";

export const description = "Record a hand-done backlink listing: mark <target-id> done|skipped|submitted [listing-url]";

export async function run({ site, positional }) {
  const [id, status, listingUrl] = positional;
  if (!id || !["done", "skipped", "submitted"].includes(status)) throw new Error("usage: run mark <target-id> done|skipped|submitted [listing-url]");
  const file = `${site.paths.state}/backlinks-state.json`;
  const state = readJson(file, { targets: {}, dayCounts: {} });
  const rec = (state.targets[id] ||= { status: "pending", attempts: 0, history: [] });
  rec.status = status; rec.markedBy = "owner"; rec.markedOn = today();
  if (listingUrl) rec.listingUrl = listingUrl;
  rec.history.push({ day: today(), kind: status, reason: "marked by the owner" });
  writeJson(file, state);
  console.log(`${id}: ${status}`);
}
