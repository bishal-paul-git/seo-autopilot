// Small git readers shared by the content-loss guard and the watch. Synchronous, no network.
import { spawnSync } from "node:child_process";

export const git = (root, args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const norm = (f) => String(f || "").split("\\").join("/");

/** File names from git, NUL-separated and unquoted, so non-ASCII names (Arabic, accented) arrive as they are. */
export const gitNames = (root, args) => { const r = git(root, ["-c", "core.quotepath=off", ...args, "-z"]); return r.status === 0 ? r.stdout.split("\0").filter(Boolean).map(norm) : []; };

/** A file's content at a revision, or null when it does not exist there. */
export const gitShow = (root, rev, path) => { const r = git(root, ["show", `${rev}:./${path}`]); return r.status === 0 ? r.stdout : null; };

/**
 * The commit a merged pull request started from, so that base..sha is exactly the pull request: a merge commit's first
 * parent; for a rebase merge (its commits replayed on the base branch with the same subjects), the commit before the first
 * of them; for a squash, the parent. headlines: the pull request's commit subjects, oldest first.
 */
export function revertBase(root, sha, headlines = []) {
  const parents = git(root, ["rev-list", "--parents", "-n", "1", sha]).stdout.trim().split(/\s+/).slice(1);
  if (parents.length > 1) return { base: parents[0], mode: "merge", count: 1 };
  const n = headlines.length;
  if (n > 1) {
    const subj = git(root, ["log", "--first-parent", "--format=%s", "-n", String(n), sha]).stdout.split("\n").filter(Boolean).reverse();
    const b = git(root, ["rev-parse", "--verify", "-q", `${sha}~${n}`]);
    if (b.status === 0 && subj.length === n && subj.every((x, i) => x === String(headlines[i]).trim())) return { base: b.stdout.trim(), mode: "rebase", count: n };
  }
  return { base: parents[0] || "", mode: "single", count: 1 };
}
