# Implementation status

Kept short on purpose: it is read at the start of every session. Full history up to 2026-11-03: [history/STATUS-to-2026-11-03.md](history/STATUS-to-2026-11-03.md). Session detail: [CHANGELOG.md](CHANGELOG.md). Decisions: [DECISIONS.md](DECISIONS.md).

## 1. Snapshot
- Last updated: 2026-11-03 UTC, branch `claude/hopeful-euler-662mu5`, base `main` `f2301b4` (v2.22.1).
- Latest release: `v2.22.1` (`v2`, `v2-stable` at `f2301b4`). Environment: Linux cloud container, Node 22.
- This session (docs/config only): `.claude/settings.json` denies MCP connectors this repo never uses, to cut per-session context; this file shortened, old one moved to `history/`.

## 2. Goal and phase
A sellable SEO product for agencies and site owners (`SEO-PRODUCT-BUILD-BRIEF.md`). Current milestone: **client portal in real use** (D23/D24), then real-key tests of the research suite.
Architecture: dependency-free Node core (`src/jobs`, `src/analysis`, `src/audit`), 38 agents (`departments/`), playbooks (`knowledge/`), workflow templates (`templates/workflows`), MCP server (`src/mcp`), hosted connector (`cloud/connector`, not deployed), portal (`cloud/portal`: Supabase schema, `ingest` Edge Function, static page).

## 3. Capabilities
| Implemented | Verified | Deployed |
|---|---|---|
| Jobs, agents, research suite, site intelligence, MCP server | `npm test` 474/474 (unit, fixture, mocked providers) | npm-free install via GitHub Action tags `v2` / `v2-stable` |
| Portal: snapshot `portal --push`, ingest, RLS, approvals, invites, branding | RLS SQL tests on local Postgres 16; live curl smoke of ingest and `shared_site` (2026-10-31) | Supabase `seo-autopilot` (`ymwwwhdlyjnqbxxhtcew`) + seo.erudience.com (Hostinger, erudience-flow-engine `seo-portal` `69f0d00`) |
| Hosted connector (D20) | unit tests + `wrangler dev` only | **not deployed** |
| Live provider calls (Brave, SerpAPI, DataForSEO, Bing, OPR, CrUX, AI engines) | **mocked only** | n/a |

## 4. Checks this session
JSON parse of every new settings file: ok. `npm test` 474/474 pass. Not verified yet: that denied connectors disappear from context; check with `/context` at the start of the next session.

## 5. Known issues and owner items
1. Sign up at seo.erudience.com (contact.bishalpaul@gmail.com), then per site: Connect → new token (replaces the temporary seed tokens).
2. Add repository secrets `SEO_PORTAL_URL` (`https://ymwwwhdlyjnqbxxhtcew.supabase.co/functions/v1/ingest`) and `SEO_PORTAL_TOKEN` on each site repo; Excel Error Finder also needs `GOOGLE_KEY_JSON` and Search Console access.
3. Seed snapshots show 2026-10-31 but hold 24 Oct data (backdate not applied).
4. Not checked: portal page in a real browser, live sign-up/sign-in.
5. Hosted connector needs the owner's GitHub App, Cloudflare deploy and secrets (`cloud/connector/README.md`).
6. Turn off unused connectors and plugins at claude.ai (repo settings can only deny connector tools; plugins/skills are account-level).

## 6. Cost
No paid API calls. Provider costs unknown until real-key tests.

## 7. Next
Milestone: one real site pushing daily to the portal with its own token. Acceptance: a `seo-daily` run on a site repo shows a new snapshot in the portal, and an approval made in the portal is applied by the next run.
Then: real-key tests of the research suite, one provider at a time; grade agents on real sites; cost per agent run.

Resume prompt: "seo-autopilot: read docs/implementation/STATUS.md. Check `/context`; then continue the Next milestone."
