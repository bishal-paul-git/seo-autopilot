// Runs a tool-using agent (Python runtime, Claude model) over your saved SEO data.
//   npx seo-autopilot run agent seo-strategist [--task "..."] [--issue]
//   npx seo-autopilot run agent seo-researcher [--task "..."] [--issues]
//
// Needs: Python 3.10+, `pip install claude-agent-sdk`, and a Claude login in the environment (ANTHROPIC_API_KEY or
// CLAUDE_CODE_OAUTH_TOKEN). The agent can read your reports, fetch public pages safely, run read-only analysis jobs and save a
// report or topic proposals. It cannot edit your site, publish, or open issues. This job, not the agent, opens GitHub issues:
//   --issue    posts the agent's report as one issue (label seo-plan)
//   --issues   turns the agent's topic proposals into issues labelled for approval (seo-topic + proposal); nothing is drafted
//              until a person adds the label `approved`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { runEngine } from "../lib/python.mjs";
import { readJson, writeJson, today } from "../core/util.mjs";
import { ghAvailable, ensureLabel, existingTitles, openIssue } from "../lib/gh.mjs";

export const description = "Run a tool-using AI agent (strategist or researcher) over your SEO data; proposals go to you for approval";

const DEFAULT_TASK = {
  "seo-strategist": "Plan this week for the site. Read priorities, audit, search insights, AI search readiness, speed, experiments and the digest, check the traffic anomalies and query topics, and produce a ranked plan of at most five actions with evidence, owner, effort and confidence, plus what you are deliberately not doing. Save the report.",
  "seo-researcher": "Find up to three topics this site could credibly rank for and does not already cover. Check coverage in the saved reports, look at the live results for each candidate, record each with propose_topic, then save a short research report.",
};

export async function run({ site, cfg, flags, positional }) {
  const name = positional[0];
  if (!name || !DEFAULT_TASK[name]) { console.log(`agent: name an agent to run: ${Object.keys(DEFAULT_TASK).join(", ")}. (The drafter, refresher and editor run in GitHub Actions; the technical fixer runs in Claude Code.)`); return; }
  const task = typeof flags.task === "string" ? flags.task : DEFAULT_TASK[name];
  const r = await runEngine(["agent", name, "--task", task, "--state-dir", site.paths.state, "--data-dir", site.paths.data, "--site-url", site.url, "--site-id", site.id, "--project-root", cfg.root], { cwd: cfg.root });
  if (r.code === 127) { console.log(`agent: skipped. ${r.stderr}`); return; }
  console.log(r.stdout.trim());
  if (r.stderr.trim()) console.error(r.stderr.trim().slice(-800));
  if (r.code !== 0) throw new Error(`the ${name} run did not finish cleanly (exit ${r.code}). Check that claude-agent-sdk is installed and a Claude login is set.`);

  if (flags.issue && ghAvailable()) {
    const dir = `${site.paths.state}/agent-reports`;
    const file = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith(`${name}-`)).sort().at(-1) : null;
    if (file) {
      await ensureLabel("seo-plan", "0EA5E9", "Weekly plan from the strategist agent");
      const title = `SEO plan from the ${name.replace("seo-", "")} agent, ${today()}`;
      if (!(await existingTitles("seo-plan")).has(title)) await openIssue(title, `${readFileSync(`${dir}/${file}`, "utf8").slice(0, 60000)}\n\n---\nWritten by an AI agent from the saved reports. Check anything you act on against the data. Nothing has been changed on your site.`, ["seo-plan"]);
    }
  }
  if (flags.issues && ghAvailable()) {
    const file = `${site.paths.state}/agent-proposals.json`;
    const items = readJson(file, []);
    const have = await existingTitles(site.labels.topic);
    let n = 0;
    for (const it of items.filter((x) => x.status === "new").slice(0, 5)) {
      if (have.has(it.title)) { it.status = "duplicate"; continue; }
      await ensureLabel(site.labels.topic, "0A6E3E", "Topic proposal");
      await ensureLabel(site.labels.proposal, "0A6E3E", "SEO proposal awaiting approval");
      const body = `**Primary query:** ${it.primaryQuery}\n**Page type:** ${it.pageType}\n\n**Why:** ${it.why}\n\n**Evidence:** ${it.evidence}\n\n_Proposed by the ${it.agent} agent from your saved search data. Check the live results before approving. Add the label \`${site.labels.approved}\` to have the page drafted as a pull request; close this issue to decline._`;
      if (await openIssue(it.title, body, [site.labels.topic, site.labels.proposal])) { it.status = "issued"; n++; }
    }
    writeJson(file, items);
    console.log(`agent: opened ${n} topic issue(s) for approval`);
  }
}
