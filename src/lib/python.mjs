// Finds a usable Python (3.10 or newer) and runs the seo_engine package that ships in engines/python.
// Python is optional: jobs that need it say so plainly and the rest of the product works without it.
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PY_DIR = fileURLToPath(new URL("../../engines/python/", import.meta.url));
export const CLI_PATH = fileURLToPath(new URL("../../bin/seo-autopilot.mjs", import.meta.url));

/** The first python on this machine that is 3.10 or newer, as { cmd, args, version }, or null. */
export function findPython() {
  const candidates = process.env.SEO_PYTHON ? [[process.env.SEO_PYTHON, []]] : [["python3", []], ["python", []], ["py", ["-3"]]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, "-c", "import sys;print('%d.%d.%d' % sys.version_info[:3])"], { encoding: "utf8", timeout: 20000 });
    if (r.error || r.status !== 0) continue;
    const v = r.stdout.trim(), [maj, min] = v.split(".").map(Number);
    if (maj > 3 || (maj === 3 && min >= 10)) return { cmd, args: pre, version: v };
  }
  return null;
}

/** Run `python -m seo_engine <args>`. Resolves { code, stdout, stderr }. Never rejects on a non-zero exit. */
export function runEngine(args, { cwd = process.cwd(), env = {}, timeoutMs = 20 * 60 * 1000 } = {}) {
  const py = findPython();
  if (!py) return Promise.resolve({ code: 127, stdout: "", stderr: "Python 3.10 or newer was not found. Install it (python.org) or set SEO_PYTHON to its path." });
  return new Promise((resolve) => {
    const child = spawn(py.cmd, [...py.args, "-m", "seo_engine", ...args], {
      cwd, env: { ...process.env, PYTHONPATH: [PY_DIR, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"), PYTHONIOENCODING: "utf-8", SEO_AUTOPILOT_CLI: CLI_PATH, SEO_AUTOPILOT_NODE: process.execPath, ...env },
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill(); stderr += "\ntimed out"; }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: 1, stdout, stderr: e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr }); });
  });
}
