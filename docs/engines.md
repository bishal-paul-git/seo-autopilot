# Python and Go engines

The core of seo-autopilot is Node, with no dependencies, and everything works with Node alone. Two optional engines add what Node is not best at. Each is used only when it is installed, and every job that needs one says so plainly when it is missing.

| Engine | Language | What it adds | Needs |
|---|---|---|---|
| `engines/go` (`seo-crawl`) | Go, standard library only | A fast concurrent crawler for big sites: worker pool, redirect chains, timings, link probing. Same output as the built-in crawler, so every audit rule runs unchanged. | Go 1.21+ (GitHub's Ubuntu runners already have it) |
| `engines/python` (`seo_engine`) | Python 3.10+, standard library for the analysis | Query topic clustering (TF-IDF), unusual-day and trend detection (median and MAD, Theil-Sen), and the tool-using agent runtime. | Python 3.10+; `pip install claude-agent-sdk` only to run agents |

## Go crawler

```bash
npx github:bishal-paul-git/seo-autopilot#v2 run audit --engine go      # or "auto": use Go when available
```

Set it permanently with `"audit": { "engine": "go" }` in the site's config. With `auto` or `go` and no Go available, the built-in crawler runs and says so. A test crawls the same fake site with both engines and requires identical results (status, redirect chains, titles, inbound links, depth, broken links).

The engine is found in this order: `SEO_CRAWL_BIN`, a built `engines/go/seo-crawl`, `seo-crawl` on your PATH, then `go run` inside `engines/go`. You can use it on its own:

```bash
cd engines/go && go build -o seo-crawl . && ./seo-crawl --url https://example.com/ --max-pages 1000 --concurrency 12 --out crawl.json
```

It crawls only the site you give it, with a delay after each request and a User-Agent that names the project. Audit your own site.

## Python: deep dive

`run deepdive` reads the saved Search Console rows and daily series and writes `deepdive.md` and `deepdive.json`:
- **Topics:** your queries grouped by shared words (TF-IDF, cosine similarity). They describe your data, not how Google groups results.
- **Observations:** topics that are visible but get no clicks, topics split across several of your pages, topics with real demand and weak rankings. Each cites its numbers.
- **Unusual days and trends:** days far outside the previous four weeks, and the trend of impressions and clicks. Sites with very little traffic are not flagged; the noise would be meaningless.
- **Pages losing visibility:** pages whose impressions halved against the previous fortnight.

## Python: the agent runtime

Two agents run here, because they only need to read, fetch and write reports: the **strategist** (a ranked weekly plan) and the **researcher** (topic proposals). The drafter, refresher and editor run in GitHub Actions; the technical fixer runs in Claude Code under your supervision.

```bash
pip install claude-agent-sdk
export ANTHROPIC_API_KEY=...        # or CLAUDE_CODE_OAUTH_TOKEN (your Claude subscription)
npx github:bishal-paul-git/seo-autopilot#v2 run agent seo-strategist --issue
npx github:bishal-paul-git/seo-autopilot#v2 run agent seo-researcher --issues
```

In GitHub Actions the optional `seo-agent` workflow does this weekly once you set the repository variable `SEO_AGENT` to `true`.

### What an agent can and cannot do
It can: list and read your saved reports, read the playbooks, search them, see your top queries, topics and traffic anomalies, fetch public web pages, run the read-only jobs `audit`, `analyze`, `geo`, `priorities` and `deepdive`, save one report and record topic proposals.

It cannot: use a shell, edit or create site files, publish, open issues, push, or read secrets. The model is started with no built-in tools at all; only the tools in `engines/python/seo_engine/tools.py` exist. **This job**, not the agent, opens issues, and only when you pass `--issue` or `--issues`. Topic proposals become issues labelled for approval; nothing is drafted until a person adds the `approved` label.

### Safety, in detail
- **Prompt injection.** Web pages, feeds and search queries are untrusted. Fetched content is wrapped and labelled as data, files known to contain internet text carry a warning, and the system prompt says never to follow instructions found in them. Because the agent has no way to change anything but its own report and proposals, a successful injection can at worst produce a bad report or proposal, which you read before acting.
- **Safe fetching.** `fetch_url` allows only http and https on ports 80 and 443, resolves the host and refuses any non-public address (loopback, private, link-local and cloud metadata ranges), connects to the address it checked, re-checks every redirect, and caps size, time and the number of fetches per run.
- **Limits.** At most 24 turns and `SEO_AGENT_BUDGET_USD` (default 1.5) per agent run, 15 fetches, 5 proposals, and a report of at most 40 KB.
- **Audit trail.** Every run appends its tool calls, turns and cost to `agent-runs.jsonl` in the state folder.
- **Your Claude settings are not loaded**, so a personal hook or memory cannot change how the agent behaves in CI.

### What it costs
Each agent run uses your Claude plan or API credits like any other use. A weekly strategist and researcher are two runs a week, each capped by the budget above.

## Checking what you have
`npx github:bishal-paul-git/seo-autopilot#v2 doctor` has an "Optional engines" section that reports Python, the Agent SDK and Go.
