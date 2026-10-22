// Report store over GitHub, for the hosted connector. It reads what the scheduled workflows already save: the
// seo-autopilot.config.json on the default branch, and the reports on the state branch (default "seo-data", under
// <stateDir>/<site id>/). Read-only: the GitHub App asks for Contents: read and Metadata: read, nothing else.
// Only repositories where the user installed the app are visible, and read() serves a file only if it is in the
// state branch's listing for that site, so a tool argument can never reach another path or another repository.
const API = "https://api.github.com";
const DEFAULT_STATE = ".seo-autopilot";

/** "seo/reports/" or "./x" to "seo/reports"; null for anything that would leave the repository. */
export function cleanDir(d) {
  const s = String(d ?? DEFAULT_STATE).replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
  return !s || s.startsWith("/") || s.split("/").includes("..") ? null : s;
}

/** Site ids across repositories: "owner/repo", or "owner/repo#site" when a repository has several sites. */
export const siteKey = (repo, site, many) => (many ? `${repo}#${site}` : repo);

export function githubStore(token, { fetch = globalThis.fetch, api = API, maxRepos = 30, now = () => Date.now() } = {}) {
  const gh = async (path, { raw = false } = {}) => {
    const r = await fetch(`${api}${path}`, { headers: { authorization: `Bearer ${token}`, accept: raw ? "application/vnd.github.raw" : "application/vnd.github+json", "user-agent": "seo-autopilot-connector", "x-github-api-version": "2022-11-28" } });
    if (r.status === 404) return null;
    if (r.status === 401) throw Object.assign(new Error("GitHub sign-in expired. Reconnect the connector."), { status: 401 });
    if (!r.ok) throw new Error(`GitHub answered ${r.status} for ${path.split("?")[0]}.`);
    return raw ? r.text() : r.json();
  };
  const seg = (p) => p.split("/").map(encodeURIComponent).join("/");
  let repoList, configs = new Map(), opened = new Map();

  // Repositories the user installed the app on (and can see), newest activity first.
  const repos = async () => {
    if (repoList) return repoList;
    const inst = (await gh("/user/installations?per_page=100"))?.installations || [];
    const all = (await Promise.all(inst.map((i) => gh(`/user/installations/${i.id}/repositories?per_page=100`)))).flatMap((r) => r?.repositories || []);
    const seen = new Set();
    repoList = all.filter((r) => !seen.has(r.full_name) && seen.add(r.full_name)).sort((a, b) => String(b.pushed_at).localeCompare(String(a.pushed_at))).slice(0, maxRepos);
    return repoList;
  };
  const configOf = async (repo) => {
    if (!configs.has(repo.full_name)) {
      configs.set(repo.full_name, gh(`/repos/${seg(repo.full_name)}/contents/seo-autopilot.config.json?ref=${encodeURIComponent(repo.default_branch)}`, { raw: true })
        .then((t) => { try { const c = t && JSON.parse(t); return Array.isArray(c?.sites) && c.sites.length ? c : null; } catch { return null; } }));
    }
    return configs.get(repo.full_name);
  };

  async function sites() {
    const list = await repos();
    const cfgs = await Promise.all(list.map(configOf));
    return list.flatMap((r, i) => (cfgs[i]?.sites || []).map((s) => ({ id: siteKey(r.full_name, s.id, cfgs[i].sites.length > 1), name: s.name || s.id, url: s.url, repository: r.full_name })));
  }

  async function open(id) {
    const all = await sites();
    if (!all.length) throw new Error("No site found. Install the seo-autopilot GitHub App on your website's repository (it needs seo-autopilot.config.json), then try again.");
    const pick = id ? all.find((s) => s.id === id || s.id.split("#")[0] === id) : all[0];
    if (!pick) throw new Error(`No site "${id}". Use list_sites: ${all.map((s) => s.id).join(", ")}.`);
    if (opened.has(pick.id)) return opened.get(pick.id);
    const repo = (await repos()).find((r) => r.full_name === pick.repository);
    const cfg = await configOf(repo);
    const s = cfg.sites.find((x) => siteKey(repo.full_name, x.id, cfg.sites.length > 1) === pick.id);
    const dir = cleanDir(cfg.stateDir), branch = String(cfg.stateBranch || "seo-data");
    const base = `/repos/${seg(repo.full_name)}`;
    let files = new Map(), savedAt = null, truncated = false;
    const head = dir && s?.id && !/[/\\]|\.\./.test(s.id) ? await gh(`${base}/branches/${encodeURIComponent(branch)}`) : null;
    if (head) {
      savedAt = Date.parse(head.commit?.commit?.committer?.date || "") || null;
      const tree = await gh(`${base}/git/trees/${head.commit.sha}?recursive=1`);
      truncated = !!tree?.truncated;
      const prefix = `${dir}/${s.id}/`;
      for (const e of tree?.tree || []) if (e.type === "blob" && e.path.startsWith(prefix)) files.set(e.path.slice(prefix.length), e.path);
    }
    const ageHours = savedAt ? Math.max(0, Math.round((now() - savedAt) / 36e5)) : null;
    const st = {
      site: { id: pick.id, name: pick.name, url: pick.url },
      // Every report comes from one saved snapshot, so they share its age.
      list: async () => [...files.keys()].map((file) => ({ file, ageHours })).concat(truncated ? [{ file: "(listing cut short by GitHub: very many files)", ageHours }] : []),
      // Read at the listed commit, so a save that lands mid-conversation cannot mix two snapshots.
      read: async (f) => (files.has(String(f)) ? gh(`${base}/contents/${seg(files.get(String(f)))}?ref=${head.commit.sha}`, { raw: true }) : null),
    };
    opened.set(pick.id, st);
    return st;
  }

  return { sites, open };
}
