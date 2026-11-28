// Small dependency-free helpers shared by every job.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, renameSync, rmSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

export const readJson = (file, fallback) => {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
};
// Written to a temp file next to the target, then renamed over it: a reader (or a run killed mid-write) never sees half a file.
export const writeJson = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  const text = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
  try { writeFileSync(tmp, text); renameSync(tmp, file); } catch (e) {
    rmSync(tmp, { force: true });
    // Windows refuses to rename over a file another process has open; fall back to writing in place there.
    if (process.platform === "win32" && (e.code === "EPERM" || e.code === "EACCES")) { writeFileSync(file, text); return; }
    throw e;
  }
};
export const writeText = (file, text) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/** Search queries, feed titles and page text are public and untrusted: keep letters, digits and basic punctuation. */
export const clean = (x, max = 120) =>
  String(x ?? "").replace(/[^\p{L}\p{N} .,&'/:%()-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Turn a simple glob ("src/content/**\/*.json", "docs/*.md") into a RegExp over forward-slash paths. */
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

/** All files under `root` matching any of the glob patterns (relative to root, forward slashes). */
export function findFiles(root, patterns) {
  const regs = patterns.map(globToRegExp);
  const out = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", ".next", ".seo-autopilot"]);
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const rel = relative(root, full).split(sep).join("/");
        if (regs.some((r) => r.test(rel))) out.push(full);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return out.sort();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
