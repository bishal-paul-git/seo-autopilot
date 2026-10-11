// Keeps the autopilot's memory (inspection results, IndexNow history, keyword backlog, backlink log) on a git branch of
// your own repository (default "seo-data"), so GitHub Actions runs can pick up where the last one stopped. The branch is a
// single orphan commit that is force-pushed, so it never clutters your history. It holds reports only, never secrets.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadConfig } from "../core/config.mjs";

const git = (args, opts = {}) => {
  const r = spawnSync("git", args, { encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  return r;
};

export function restore({ cwd = process.cwd() } = {}) {
  const cfg = loadConfig({ cwd });
  const branch = cfg.stateBranch || "seo-data";
  const rel = relative(cfg.root, cfg.stateDir).split("\\").join("/");
  const remote = git(["ls-remote", "--exit-code", "origin", branch], { cwd: cfg.root, allowFail: true });
  if (remote.status !== 0) { console.log(`state: no "${branch}" branch yet. Starting fresh.`); return; }
  git(["fetch", "origin", branch], { cwd: cfg.root });
  const r = git(["checkout", `origin/${branch}`, "--", rel], { cwd: cfg.root, allowFail: true });
  // "git checkout <branch> -- path" also stages the files. Unstage them so a later "git add -A && git commit" can never
  // put saved reports into your main branch (the files stay on disk and the state folder stays git-ignored).
  git(["reset", "-q", "HEAD", "--", rel], { cwd: cfg.root, allowFail: true });
  console.log(r.status === 0 ? `state: restored ${rel} from ${branch}` : `state: nothing to restore from ${branch}`);
}

export function save({ cwd = process.cwd() } = {}) {
  const cfg = loadConfig({ cwd });
  const branch = cfg.stateBranch || "seo-data";
  const rel = relative(cfg.root, cfg.stateDir).split("\\").join("/");
  if (!existsSync(cfg.stateDir)) { console.log("state: nothing to save."); return; }
  const tmp = mkdtempSync(join(tmpdir(), "seo-state-"));
  cpSync(cfg.stateDir, join(tmp, "state"), { recursive: true });
  const run = (args) => git(args, { cwd: cfg.root });
  run(["config", "user.name", "seo-autopilot"]);
  run(["config", "user.email", "seo-autopilot@users.noreply.github.com"]);
  run(["checkout", "--orphan", `${branch}-new`]);
  git(["rm", "-rf", "-q", "."], { cwd: cfg.root, allowFail: true });
  mkdirSync(join(cfg.root, rel), { recursive: true });
  cpSync(join(tmp, "state"), join(cfg.root, rel), { recursive: true });
  run(["add", "-f", rel]);
  run(["commit", "-q", "-m", `seo-autopilot state ${new Date().toISOString().slice(0, 10)}`]);
  run(["push", "-f", "origin", `HEAD:${branch}`]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`state: saved ${rel} to ${branch}`);
}
