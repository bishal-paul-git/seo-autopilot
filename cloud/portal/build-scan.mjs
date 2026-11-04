// Copies the product modules the `scan` Edge Function runs into supabase/functions/scan/lib, keeping their relative
// paths, so the function runs the same crawler, audit rules and snapshot builder as the CLI. Run before deploying:
//   node cloud/portal/build-scan.mjs        (then deploy supabase/functions/scan with verify_jwt off)
import { cpSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const out = join(root, "cloud/portal/supabase/functions/scan/lib");
export const FILES = ["hosted/scan.mjs", "audit/crawl.mjs", "audit/extract.mjs", "audit/rules.mjs", "analysis/scope.mjs", "analysis/site-profile.mjs", "analysis/discover.mjs", "analysis/portal.mjs", "core/util.mjs"];

/** Relative imports of a module, so a test can check the list above is complete. */
export const importsOf = (src) => [...src.matchAll(/^import\s[^;]*?from\s+"(\.[^"]+)"/gm)].map((m) => m[1]);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  rmSync(out, { recursive: true, force: true });
  for (const f of FILES) { mkdirSync(dirname(join(out, f)), { recursive: true }); cpSync(join(root, "src", f), join(out, f)); }
  console.log(`copied ${FILES.length} modules to ${out}`);
  for (const f of FILES) for (const i of importsOf(readFileSync(join(root, "src", f), "utf8"))) {
    const target = join(dirname(f), i).replace(/\\/g, "/");
    if (!FILES.includes(target)) console.log(`warning: ${f} imports ${target}, which is not copied`);
  }
}
