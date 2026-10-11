#!/usr/bin/env node
// seo-autopilot command line.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runJob, describeJobs } from "../src/jobs/index.mjs";
import { init } from "../src/cli/init.mjs";
import { doctor } from "../src/cli/doctor.mjs";
import { restore, save } from "../src/cli/state.mjs";
import { parseArgs } from "../src/cli/args.mjs";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

async function help() {
  console.log(`seo-autopilot ${pkg.version}

Usage
  seo-autopilot init --url https://example.com/    scaffold config, data files and GitHub workflows
  seo-autopilot doctor                              check the setup and say what to fix
  seo-autopilot run <job> [--site id] [--dry]       run one job
  seo-autopilot state restore|save                  load/save memory on the "seo-data" branch (used by the workflows)
  seo-autopilot version

Jobs`);
  for (const [name, d] of await describeJobs()) console.log(`  ${name.padEnd(16)} ${d}`);
  console.log("\nDocs: https://github.com/bishal-paul-git/seo-autopilot#readme");
}

const [cmd, ...rest] = process.argv.slice(2);
const { flags, positional } = parseArgs(rest);
try {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") await help();
  else if (cmd === "version" || cmd === "--version" || cmd === "-v") console.log(pkg.version);
  else if (cmd === "init") await init({ flags });
  else if (cmd === "doctor") process.exitCode = await doctor();
  else if (cmd === "state") {
    const sub = positional[0];
    if (sub === "restore") restore(); else if (sub === "save") save(); else throw new Error("usage: state restore|save");
  } else if (cmd === "run") {
    const [job, ...args] = positional;
    if (!job) throw new Error("usage: run <job>. See: seo-autopilot help");
    await runJob(job, { site: flags.site, flags, positional: args });
  } else throw new Error(`Unknown command "${cmd}". Try: seo-autopilot help`);
} catch (e) {
  console.error(`seo-autopilot: ${e.message}`);
  process.exitCode = 1;
}
