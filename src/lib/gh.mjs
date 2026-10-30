// GitHub issues helper. Works from GitHub Actions (GITHUB_TOKEN + GITHUB_REPOSITORY) or locally with a token.
// Without a token every call is a no-op that prints what it would have done.
const token = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repo = () => process.env.GITHUB_REPOSITORY;
export const ghAvailable = () => Boolean(token() && repo());

export const api = (path, init = {}) => fetch(`https://api.github.com/repos/${repo()}${path}`, {
  ...init, headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
});

export async function ensureLabel(name, color = "0A6E3E", description = "") {
  if (!ghAvailable()) return;
  await api("/labels", { method: "POST", body: JSON.stringify({ name, color, description }) });
}

/** Titles of all issues (open and closed) carrying a label, so jobs never open the same proposal twice. */
export async function existingTitles(label) {
  if (!ghAvailable()) return new Set();
  const r = await api(`/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100`);
  const list = r.ok ? await r.json() : [];
  return new Set(list.map((i) => i.title));
}

export async function openIssue(title, body, labels) {
  if (!ghAvailable()) { console.log(`[dry] would open issue: ${title}`); return false; }
  const r = await api("/issues", { method: "POST", body: JSON.stringify({ title, body, labels }) });
  console.log(`${r.status} ${title}`);
  return r.ok;
}

/** Open issues carrying any of the labels (one call per label, merged by number). */
export async function openIssues(labels, { f = api } = {}) {
  if (!ghAvailable() && f === api) return [];
  const seen = new Map();
  for (const l of labels) {
    const r = await f(`/issues?labels=${encodeURIComponent(l)}&state=open&per_page=50`);
    for (const i of r.ok ? await r.json() : []) if (!i.pull_request) seen.set(i.number, i);
  }
  return [...seen.values()];
}

/** Apply one action from decisionActions(); true when GitHub accepted it. */
export async function applyAction(a, { f = api } = {}) {
  const call = {
    label: () => f(`/issues/${a.issue}/labels`, { method: "POST", body: JSON.stringify({ labels: a.labels }) }),
    comment: () => f(`/issues/${a.issue}/comments`, { method: "POST", body: JSON.stringify({ body: a.body }) }),
    close: () => f(`/issues/${a.issue}`, { method: "PATCH", body: JSON.stringify({ state: "closed", state_reason: "not_planned" }) }),
    dispatch: () => f(`/actions/workflows/${a.workflow}/dispatches`, { method: "POST", body: JSON.stringify({ ref: a.ref, inputs: { issue: String(a.issue) } }) }),
  }[a.type];
  if (!call) return false;
  const r = await call();
  return r.ok;
}
