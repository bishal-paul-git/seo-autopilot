// Structural and security checks on the workflow templates that `init` and `upgrade` write into other people's repositories.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { init } from "../src/cli/init.mjs";
import { upgrade, plan, lineDiff } from "../src/cli/upgrade.mjs";

const dir = fileURLToPath(new URL("../templates/workflows/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
const text = (f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n");

test("there are workflow templates", () => assert.ok(files.length >= 8));

for (const f of files) {
  test(`${f}: structure`, () => {
    const t = text(f);
    assert.ok(!/\t/.test(t), "no tab characters");
    assert.match(t, /^name:\s*\S+/m);
    assert.match(t, /^on:/m);
    assert.match(t, /^jobs:/m);
    assert.match(t, /^permissions:/m, "explicit permissions");
    // Block scalars (| and >-) may be indented freely; everything else must use 2-space steps.
    let block = -1;
    for (const line of t.split("\n")) {
      const ind = line.match(/^ */)[0].length;
      if (block >= 0) { if (!line.trim() || ind > block) continue; block = -1; }
      assert.equal(ind % 2, 0, `odd indentation: ${line.slice(0, 60)}`);
      if (/(:|-)\s+[|>][-+]?\s*$/.test(line)) block = ind;
    }
    assert.equal((t.match(/\$\{\{/g) || []).length, (t.match(/\}\}/g) || []).length - (t.match(/\{\{[A-Z_]+\}\}/g) || []).length, "balanced expressions");
  });

  test(`${f}: security rules`, () => {
    const t = text(f);
    assert.ok(!/pull_request_target/.test(t), "never pull_request_target");
    // Untrusted text must never be interpolated into a shell script.
    const runBlocks = [...t.matchAll(/^\s+run:\s*(\|[^\n]*\n((?:\s{10,}.*\n?)*)|[^\n]*)/gm)].map((m) => m[0]);
    for (const b of runBlocks) assert.ok(!/\$\{\{\s*github\.event\.(issue|pull_request|comment|review|head_commit)\.(title|body|message|label)/.test(b) && !/\$\{\{\s*github\.head_ref/.test(b), `untrusted value in run: ${b.slice(0, 80)}`);
    // Third-party actions must be pinned to a full commit SHA; first-party actions may use a version tag.
    for (const m of t.matchAll(/uses:\s*([^\s#]+)/g)) {
      const ref = m[1];
      if (/^(actions|github)\//.test(ref)) continue;
      if (/^\.\/\.github\/workflows\/seo-[a-z-]+\.yml$/.test(ref)) continue; // our own workflows, in the same repository
      assert.match(ref, /@[0-9a-f]{40}$/, `unpinned third-party action ${ref}`);
    }
  });
}

test("seo-check has no secrets and read-only permissions", () => {
  const t = text("seo-check.yml");
  assert.ok(!/secrets\./.test(t.replace(/#.*$/gm, "")));
  assert.match(t, /permissions:\n\s+contents: read/);
});

test("auto-merge and review are opt-in by repository variable and restricted to seo/ branches in the same repository", () => {
  const am = text("seo-automerge.yml"), rv = text("seo-review.yml");
  assert.match(am, /checks: read/, "needs checks: read to look up the seo-check result");
  assert.match(am, /vars\.SEO_AUTOMERGE == 'true'/);
  assert.match(am, /startsWith\(github\.event\.workflow_run\.head_branch, 'seo\/'\)/);
  assert.match(am, /head_repository\.full_name == github\.repository/);
  assert.match(am, /vars\.SEO_AUTOPILOT_PAUSED != 'true'/, "the kill switch stops auto-merge");
  assert.match(am, /run autopilot --decide/, "the policy decides, in tested code");
  assert.match(am, /check review\)" != "success"/, "the reviewer must have passed on this exact commit, not an earlier one");
  assert.match(am, /--match-head-commit "\$SHA"/, "the merge is pinned to the checked commit");
  assert.match(text("seo-release.yml"), /vars\.SEO_AUTOPILOT_PAUSED != 'true'/, "the kill switch stops publishing");
  assert.match(rv, /vars\.SEO_REVIEW == 'true'/);
  assert.match(rv, /startsWith\(github\.head_ref, 'seo\/'\)/);
});

test("the autopilot loop is opt-in and pausable, and the build check it calls never receives secrets", () => {
  const t = text("seo-autopilot.yml");
  assert.match(t, /vars\.SEO_AUTOPILOT == 'true' && vars\.SEO_AUTOPILOT_PAUSED != 'true'/);
  assert.match(t, /run autopilot --pick/, "the policy picks the work, in tested code");
  const check = t.slice(t.indexOf("\n  check:"), t.indexOf("\n  review:"));
  assert.match(check, /uses: \.\/\.github\/workflows\/seo-check\.yml/);
  assert.ok(!/secrets/.test(check), "seo-check is called without secrets");
  assert.match(check, /contents: read/);
  for (const job of ["draft", "review"]) assert.match(t.slice(t.indexOf(`\n  ${job}:`)), /secrets: inherit/, job);
  for (const f of ["seo-implement.yml", "seo-check.yml", "seo-review.yml", "seo-automerge.yml"]) assert.match(text(f), /workflow_call:/, `${f} can be called by the autopilot`);
  assert.match(text("seo-implement.yml"), /if: \$\{\{ !inputs\.issue \}\}/, "the approver check is skipped only when the autopilot calls it");
});

test("watch and undo: reverts go through a pull request and a no-secrets build, the pause leaves the merge to a person", () => {
  const t = text("seo-watch.yml");
  assert.match(t, /vars\.SEO_AUTOPILOT == 'true'/);
  // The revert goes through the tool: -m 1 for a merge commit, the whole range for a rebase merge (a plain git revert of a
  // merge commit fails).
  assert.match(t, /run watch --git-revert "\$n" --sha "\$sha" --commits/);
  assert.ok(!/git revert --no-edit "\$sha"/.test(t));
  // Merged unpublishes are checked: the reverts list carries state and merge time; a still-live page opens an issue.
  assert.match(t, /--json headRefName,state,mergedAt/);
  assert.match(t, /failed: \$\{\{ steps\.watch\.outputs\.failed \}\}/);
  const failed = t.slice(t.indexOf("\n  unpublish-failed:"), t.indexOf("\n  revert:"));
  assert.match(failed, /gh issue create/); assert.match(failed, /issues: write/); assert.match(failed, /SEO_AUTOPILOT_PAUSED != 'true'/);
  assert.match(t, /--json number,mergedAt,mergeCommit,files,headRefName,labels,commits/, "commits, to read rebase merges");
  assert.ok(!/git push origin (main|master|HEAD)\b/.test(t) && !/git push\s*$/m.test(t), "never pushes to the default branch");
  const check = t.slice(t.indexOf("\n  check:"), t.indexOf("\n  merge:"));
  assert.match(check, /seo-check\.yml/); assert.ok(!/secrets/.test(check));
  assert.match(t.slice(t.indexOf("\n  merge:")), /vars\.SEO_AUTOPILOT_PAUSED != 'true'/);
  assert.match(t, /--match-head-commit/);
  assert.match(text("seo-automerge.yml"), /--add-label seo-watch/, "auto-merge marks undo-level changes for the watch");
});

test("kill switch: SEO_AUTOPILOT_PAUSED stops backlink submissions (live or dry); recording a hand-done listing still works", () => {
  const t = text("seo-backlinks.yml");
  const step = (name) => { const i = t.indexOf(`- name: ${name}`); const j = t.indexOf("\n      - ", i + 1); return t.slice(i, j < 0 ? undefined : j); };
  for (const name of ["Install a local browser", "Install the Playwright client", "Submit listings", "Keep screenshots for review"]) assert.match(step(name), /vars\.SEO_AUTOPILOT_PAUSED != 'true'/, `${name} is skipped while paused`);
  assert.match(step("Submit listings"), /SEO_AUTOPILOT_PAUSED: \$\{\{ vars\.SEO_AUTOPILOT_PAUSED \}\}/, "the job sees the switch too");
  assert.ok(!/PAUSED/.test(step("Record a hand-done listing")), "marking a hand-done listing is bookkeeping, not outreach");
});

test("kill switch: the backlinks job opens no browser while paused, even with BACKLINK_LIVE=1", async () => {
  const root = mkdtempSync(join(tmpdir(), "seo-bl-paused-")); const state = join(root, "state"); const bdir = join(root, "backlinks"); mkdirSync(state); mkdirSync(bdir);
  writeFileSync(join(bdir, "profile.json"), JSON.stringify({ name: "Example Shop", url: "https://example.test/" }));
  writeFileSync(join(bdir, "targets.json"), JSON.stringify([{ id: "dir-1", url: "https://directory.test/add", mode: "auto" }]));
  const site = { id: "s", name: "S", url: "https://example.test/", paths: { state, backlinks: bdir, root, data: root } };
  const lines = []; const log = console.log; console.log = (...a) => lines.push(a.join(" "));
  process.env.SEO_AUTOPILOT_PAUSED = "true"; process.env.BACKLINK_LIVE = "1";
  try {
    const { run } = await import("../src/jobs/backlinks-submit.mjs");
    await run({ site, flags: { live: true } });
    delete process.env.SEO_AUTOPILOT_PAUSED;
    await run({ site: { ...site, autopilot: { paused: true } }, flags: { live: true } });
  } finally { console.log = log; delete process.env.SEO_AUTOPILOT_PAUSED; delete process.env.BACKLINK_LIVE; }
  assert.equal(lines.filter((l) => /paused/.test(l)).length, 2, lines.join("\n"));
  assert.ok(!lines.some((l) => /LIVE|DRY RUN|playwright/.test(l)), "stopped before picking targets or loading a browser");
  assert.deepEqual(readdirSync(state), [], "nothing written");
});

test("kill switch: SEO_AUTOPILOT_PAUSED stops every seo-watch job (judge, revert, merge); content reverts never merge by themselves", () => {
  const t = text("seo-watch.yml");
  const job = (name, next) => t.slice(t.indexOf(`\n  ${name}:`), next ? t.indexOf(`\n  ${next}:`) : undefined);
  assert.match(job("judge", "revert"), /if: vars\.SEO_AUTOPILOT_PAUSED != 'true'/, "paused: not even the check runs");
  assert.match(job("revert", "check"), /if: needs\.judge\.outputs\.revert != '' && vars\.SEO_AUTOPILOT_PAUSED != 'true'/);
  assert.match(job("merge"), /needs\.revert\.outputs\.automerge == 'true' && vars\.SEO_AUTOPILOT == 'true' && vars\.SEO_AUTOPILOT_PAUSED != 'true'/);
  assert.match(job("revert", "check"), /if \[ "\$kind" = "undo" \]; then automerge=true; else automerge=false; fi/, "only the autopilot's own undo-level changes are merged back automatically");
  assert.match(job("judge", "revert"), /run watch --prs .* --content .* --reverts/);
  assert.match(job("judge", "revert"), /state save/, "the watch list is kept on the state branch");
  assert.match(t, /group: seo-data/, "saves state in turn with the other jobs");
  assert.match(job("revert", "check"), /run watch --unpublish/, "new pages are unpublished through the adapter");
  assert.ok(!/git rm|rm -f|git mv/.test(t), "never deletes or moves a page");
  assert.match(job("revert", "check"), /--label seo-revert/);
  assert.match(job("revert", "check"), /gh pr comment "\$n"/, "alerts on the original pull request");
});

test("content-loss guard: runs in seo-check before install and build, and the override needs a person", () => {
  const t = text("seo-check.yml");
  const g = t.indexOf("run content-guard");
  assert.ok(g > 0 && g < t.indexOf("name: Install") && g < t.indexOf("run: npm run build"), "before any pull-request code runs");
  assert.match(t, /--base "origin\/\$BASE"/);
  // Runs from outside the checkout (no .npmrc, package.json or node_modules of the pull request is read), with the BASE
  // branch's config, pointing --repo at the checkout.
  const step = t.slice(t.indexOf("- name: Content-loss guard"), t.indexOf("- name: Install"));
  assert.match(step, /guard="\$RUNNER_TEMP\/content-guard"/);
  assert.match(step, /git -C "\$GITHUB_WORKSPACE" show "origin\/\$BASE:seo-autopilot\.config\.json" > "\$guard\/seo-autopilot\.config\.json"/);
  const cd = step.indexOf('cd "$guard"'), npx = step.indexOf("npx --yes");
  assert.ok(cd > 0 && cd < npx && step.indexOf("npx", 0) === npx, "the only npx runs after cd to the temp folder");
  assert.match(step, /--repo "\$GITHUB_WORKSPACE"/);
  // The override is tied to the latest push (event time), and a revert is checked against the pull request it undoes.
  assert.match(step, /created_at\}/);
  assert.match(step, /repos\/\$GH_REPO\/pulls\/\$n" --jq '\{number, merged, mergeCommit: \.merge_commit_sha, headRefName: \.head\.ref\}'/);
  assert.match(step, /--revert-of="\$revert_of"/);
  assert.match(t, /issues\/\$PR\/events/);
  assert.match(t, /contents: read/);
  for (const f of ["seo-implement.yml", "seo-autopilot.yml", "seo-automerge.yml", "seo-review.yml", "seo-agent.yml"]) assert.ok(!/allow-content-shrink/.test(text(f)), `${f} never applies the override`);
  // Revert provenance: when seo-watch calls the check there is no pull_request event, so the pull request (and its author)
  // is found by branch, and the label events are read for seo-revert too.
  assert.match(t, /pulls\?state=open&head=\$\{GH_REPO%%\/\*\}:\$BRANCH/);
  assert.match(t, /\*,allow-content-shrink,\*\|\*,seo-revert,\*\)/);
  assert.match(text("seo-watch.yml"), /gh pr create [^\n]*--label seo-revert/, "the watch labels its reverts itself (the same account that opens them)");
});

test("monthly report: runs on the 1st, reads merged pull requests and opens one report issue without touching the site", () => {
  const t = text("seo-monthly.yml");
  assert.match(t, /cron: "\d+ \d+ 1 \* \*"/);
  assert.match(t, /run monthly --prs/);
  assert.match(t, /pull-requests: read/);
  assert.ok(!/gh pr merge|git push/.test(t), "report only");
});

test("work orders: the weekly team step gets the autopilot switch, the implementer only follows the three content agents", () => {
  assert.match(text("seo-weekly.yml"), /SEO_AUTOPILOT: \$\{\{ vars\.SEO_AUTOPILOT \}\}/);
  const t = text("seo-implement.yml");
  assert.match(t, /seo-work-order/);
  for (const a of ["seo-snippet-optimizer", "seo-internal-linker", "seo-refresher"]) assert.match(t, new RegExp(`agents/${a}\\.md`));
  assert.match(t, /any other agent label means: comment that it needs a person/);
});

test("research suite: free Search Console steps always run; steps that spend credits only when their switch is on", () => {
  assert.match(text("seo-daily.yml"), /run rank\n/);
  const w = text("seo-weekly.yml"), m = text("seo-monthly.yml");
  for (const job of ["keywords", "gap", "authority"]) assert.match(w, new RegExp(`run ${job}\\n`), job);
  assert.match(w.slice(w.lastIndexOf("\n", w.indexOf("run rank --serp") - 1) - 900, w.indexOf("run rank --serp")), /if: vars\.SEO_RANK_LIVE == 'true'/, "live rank checks cost SERP credits");
  assert.match(m.slice(m.indexOf("AI visibility"), m.indexOf("run ai-visibility")), /if: vars\.SEO_AI_VISIBILITY == 'true'/, "AI answers cost API calls");
  assert.ok(m.indexOf("run forecast") < m.indexOf("run monthly"), "the forecast feeds the monthly report");
  assert.ok(w.indexOf("run gap") < w.indexOf("run team"), "the team plan sees the research reports");
});

test("only people with write access can approve a change for the implementer, and the kill switch stops it", () => {
  const t = text("seo-implement.yml");
  assert.match(t, /collaborators\/\$ACTOR\/permission/);
  assert.match(t, /admin\|maintain\|write\)/);
  assert.ok(t.indexOf("collaborators/$ACTOR/permission") < t.indexOf("anthropics/claude-code-action"), "the check runs before the agent");
  assert.match(t, /vars\.SEO_AUTOPILOT_PAUSED != 'true'/);
});

test("the implementer cannot run build or install commands and may only edit content paths", () => {
  const t = text("seo-implement.yml");
  assert.ok(!/Bash\((npm|npx|node|yarn|pnpm)/.test(t));
  assert.match(t, /\{\{EDIT_TOOLS\}\}/);
  assert.ok(!/Edit\(\*\*\)|Write\(\*\*\)|Bash\(\*\)/.test(t));
});

test("init renders every placeholder; upgrade reports, adds missing files and keeps the pinned spec", async () => {
  const proj = mkdtempSync(join(tmpdir(), "seo-up-"));
  const log = console.log; console.log = () => {};
  const cwd = process.cwd(); process.chdir(proj);
  try {
    await init({ flags: { url: "https://up.test/", name: "Up", spec: "github:me/fork#v2.1.0", include: "src/content/*.json" } });
    for (const f of readdirSync(join(proj, ".github", "workflows"))) assert.ok(!/\{\{[A-Z_]+\}\}/.test(readFileSync(join(proj, ".github", "workflows", f), "utf8")), `placeholder left in ${f}`);
    let p = plan({ cwd: proj });
    assert.ok(p.items.every((i) => i.status === "current"));
    assert.equal(p.spec, "github:me/fork#v2.1.0");
    // Simulate an older project: delete one workflow and edit another.
    const wf = join(proj, ".github", "workflows");
    const { rmSync } = await import("node:fs");
    rmSync(join(wf, "seo-geo-test.yml"), { force: true });
    rmSync(join(wf, "seo-review.yml"));
    writeFileSync(join(wf, "seo-daily.yml"), readFileSync(join(wf, "seo-daily.yml"), "utf8").replace("run daily", "run daily --custom"));
    p = plan({ cwd: proj });
    assert.equal(p.items.find((i) => i.file === "seo-review.yml").status, "missing");
    assert.equal(p.items.find((i) => i.file === "seo-daily.yml").status, "differs");
    const report = upgrade({ cwd: proj, flags: {} });
    assert.match(report, /missing\s+\.github\/workflows\/seo-review\.yml/);
    assert.ok(!existsSync(join(wf, "seo-review.yml")), "report mode changes nothing");
    upgrade({ cwd: proj, flags: { apply: true } });
    assert.ok(existsSync(join(wf, "seo-review.yml")), "--apply adds the missing workflow");
    assert.match(readFileSync(join(wf, "seo-daily.yml"), "utf8"), /--custom/, "--apply keeps edited workflows");
    upgrade({ cwd: proj, flags: { force: true } });
    assert.ok(!/--custom/.test(readFileSync(join(wf, "seo-daily.yml"), "utf8")), "--force replaces them");
    assert.ok(existsSync(join(proj, "seo-autopilot", "agents", "seo-editor.md")), "agents refreshed");
  } finally { process.chdir(cwd); console.log = log; }
});

test("lineDiff reports added and removed lines", () => {
  const d = lineDiff("a\nb\nc", "a\nc\nd");
  assert.deepEqual(d, { removed: ["b"], added: ["d"] });
});

test("the autopilot picks nothing when the repository has no AI secret (no failing run twice a day)", () => {
  const t = text("seo-autopilot.yml");
  const pick = t.slice(t.indexOf("\n  pick:"), t.indexOf("\n  draft:"));
  assert.match(pick, /HAS_AI: \$\{\{ secrets\.CLAUDE_CODE_OAUTH_TOKEN != '' \|\| secrets\.ANTHROPIC_API_KEY != '' \}\}/);
  assert.ok(pick.indexOf('if [ "$HAS_AI" != "true" ]') < pick.indexOf("gh issue list"), "checked before any work");
});
