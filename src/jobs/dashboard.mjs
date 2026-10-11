// Builds a self-contained dashboard (one HTML file, no server, no database, no tracking) from the saved state:
// <state>/<site>/dashboard/index.html. Open it in a browser, or let the workflow attach it to each run as an artifact.
// The page is marked noindex. It lists real queries and URLs, so publish it only somewhere private.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { writeText } from "../core/util.mjs";
import { collectSiteData } from "../core/collect.mjs";

export const description = "Build a single-file HTML dashboard from the saved data (open it in a browser)";

const TEMPLATE = fileURLToPath(new URL("../dashboard/template.html", import.meta.url));

export function renderDashboard(data) {
  const json = JSON.stringify(data).replace(/</g, String.fromCharCode(92) + "u003c").replace(new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]", "g"), " ");
  return readFileSync(TEMPLATE, "utf8").replace("/*__DATA__*/null", json);
}

export async function run({ site }) {
  const data = await collectSiteData(site);
  const out = `${site.paths.state}/dashboard/index.html`;
  writeText(out, renderDashboard(data));
  console.log(`dashboard: wrote ${out} (${data.history.length} days of history, ${Object.keys(data.inspect).length} inspected pages)`);
}
