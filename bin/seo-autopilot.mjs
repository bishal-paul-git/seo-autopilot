#!/usr/bin/env node
// seo-autopilot command line.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runJob, describeJobs } from "../src/jobs/index.mjs";
import { init, exportKnowledge } from "../src/cli/init.mjs";
import { doctor } from "../src/cli/doctor.mjs";
import { upgrade } from "../src/cli/upgrade.mjs";
import { restore, save } from "../src/cli/state.mjs";
import { parseArgs } from "../src/cli/args.mjs";
import { addProject, removeProject, listSites } from "../src/core/projects.mjs";
import { startUi } from "../src/ui/server.mjs";

const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

async function help() {
  console.log(`seo-autopilot ${pkg.version}

Usage
  seo-autopilot init --url https://example.com/    scaffold config, data files and GitHub workflows
  seo-autopilot doctor                              check the setup and say what to fix
  seo-autopilot upgrade [--apply] [--diff] [--force]  bring workflows, playbooks and agents up to date (reports only without flags)
  seo-autopilot run <job> [--site id] [--dry]       run one job
  seo-autopilot knowledge                           copy/refresh the SEO playbooks into your project (the drafting agent reads them)
  seo-autopilot ui [--port 4747] [--open]           local app to manage every project on this computer
  seo-autopilot projects add|list|remove [path]     choose which website folders the app shows
  seo-autopilot state restore|save                  load/save memory on the "seo-data" branch (used by the workflows)
  seo-autopilot redirects [check|generate|smoke]    the redirect map: check it, write server rules, test the live site
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
  else if (cmd === "upgrade") console.log(upgrade({ flags }));
  else if (cmd === "doctor") process.exitCode = await doctor();
  else if (cmd === "state") {
    const sub = positional[0];
    if (sub === "restore") restore(); else if (sub === "save") save(); else throw new Error("usage: state restore|save");
  } else if (cmd === "knowledge") {
    const { loadConfig } = await import("../src/core/config.mjs");
    const cfg = loadConfig();
    const rel = (await import("node:path")).relative(cfg.root, cfg.dataDir) || "seo-autopilot";
    console.log(exportKnowledge({ cwd: cfg.root, dataDir: rel }).join(String.fromCharCode(10)));
  } else if (cmd === "ui") {
    await startUi({ port: Number(flags.port || 4747), open: Boolean(flags.open) });
  } else if (cmd === "projects") {
    const [sub, path] = positional;
    if (sub === "add") console.log(`added ${addProject(path || ".")}`);
    else if (sub === "remove") { removeProject(path || "."); console.log("removed"); }
    else if (sub === "list") {
      const { sites, problems } = listSites();
      for (const x of sites) console.log(`${x.id}  ${x.site.name}  ${x.root}`);
      for (const p of problems) console.log(`PROBLEM ${p.root}: ${p.error}`);
      if (!sites.length && !problems.length) console.log("No projects yet. Run: seo-autopilot projects add <folder>");
    } else throw new Error("usage: projects add|list|remove [path]");
  } else if (cmd === "redirects") {
    await runJob("redirects", { site: flags.site, flags, positional });
  } else if (cmd === "run") {
    const [job, ...args] = positional;
    if (!job) throw new Error("usage: run <job>. See: seo-autopilot help");
    await runJob(job, { site: flags.site, flags, positional: args });
  } else throw new Error(`Unknown command "${cmd}". Try: seo-autopilot help`);
} catch (e) {
  console.error(`seo-autopilot: ${e.message}`);
  process.exitCode = 1;
}
