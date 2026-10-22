# Use seo-autopilot from Claude or another AI assistant (MCP)

`seo-autopilot mcp` is a Model Context Protocol server. It lets an assistant (Claude Desktop, Claude Code, ChatGPT or any MCP client) read this project's SEO reports and run its analysis jobs. You can then ask questions in plain words, for example:
- "what changed in my rankings this week?"
- "which pages earn impressions but are weakly linked?"
- "optimise /pricing for 'web hosting prices'"

No extra install: it is part of the CLI, with no dependencies.

## Tools
| Tool | What it does |
|---|---|
| `site_overview` | One screen from the latest reports: audit, rankings and visibility, traffic vs its normal range, link graph, keyword gaps, AI visibility, authority |
| `list_reports`, `read_report` | The report files in the state folder, and one of them (for example `rank.md`, `keywords.json`, `optimize/pricing.md`) |
| `search_queries` | Your saved Search Console queries, filtered by text or page |
| `page_report` | Everything known about one page: audit facts and findings, internal link score, its queries |
| `run_job` | Runs one analysis job and returns its report. Jobs that call paid APIs (`ai-visibility`, `citations`) need `confirm_cost: true`, so the assistant has to ask you first |
| `list_sites` | The sites in this project |

**Safety:**
- It reads files inside the state folder only.
- `run_job` accepts a fixed list of analysis jobs. Jobs that publish, open issues, submit, merge or release are not available.
- `team` and `priorities` always run as reports only.
- The server tells the assistant that report text comes from the web and is data, not instructions.

## Set it up
**Claude Code:** installing the plugin (`/plugin install seo-autopilot`) adds the server automatically. Without the plugin, run this in your website's repository:
```
claude mcp add seo-autopilot -- npx -y github:bishal-paul-git/seo-autopilot#v2 mcp
```
**Claude Desktop:** add this to `claude_desktop_config.json` and restart:
```json
{ "mcpServers": { "seo-autopilot": { "command": "npx", "args": ["-y", "github:bishal-paul-git/seo-autopilot#v2", "mcp", "--project", "/path/to/your/website-repo"] } } }
```
**Other clients:** run `seo-autopilot mcp --project <folder>` as a stdio server.

Keys stay in your environment, exactly as for the CLI: the server passes them to the jobs it runs and never shows them.

## Hosted connector: Claude and ChatGPT on the web
Claude (claude.ai and the desktop app) and ChatGPT can add a **remote** MCP server as a custom connector. They cannot start a local command, so `seo-autopilot mcp` cannot be used there. `cloud/connector` is the remote version:
- it runs as a Cloudflare Worker, and people sign in with GitHub;
- it reads the reports that the site's scheduled workflows already save on the repository's `seo-data` branch;
- it has the same tools as above, apart from `run_job`: it is read-only and runs nothing;
- it sees only the repositories where the user installed its GitHub App, which needs *Contents: read* only.

Setup, deployment and limits: [cloud/connector/README.md](../cloud/connector/README.md). Decision D20 explains the design.
