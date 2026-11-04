# Implementation status

Kept short on purpose: it is read at the start of every session. Full history up to 2026-11-03: [history/STATUS-to-2026-11-03.md](history/STATUS-to-2026-11-03.md). Session detail: [CHANGELOG.md](CHANGELOG.md). Decisions: [DECISIONS.md](DECISIONS.md).

## 1. Snapshot
- Last updated: 2026-11-04 UTC, branch `claude/hopeful-euler-662mu5`, base `main` `e982f64` (v2.22.1 + token diet).
- Latest release: `v2.22.1` (`v2`, `v2-stable` at `f2301b4`). Environment: Linux cloud container, Node 22.
- This session (code): websites connected by address only (D25): `src/analysis/discover.mjs`, `src/hosted/scan.mjs`, `cloud/portal/supabase/functions/scan`, `cloud/portal/build-scan.mjs`, migration `20261104000000_portal_url_sites.sql`, portal "Add and scan" + "About this website". seo-backlinks template weekly. Site repos: backlinks weekly (erudience-flow-engine#118, tenanthousingdisrepair#41, excel-error-finder#15, merged).

## 2. Goal and phase
A sellable SEO product for agencies and site owners (`SEO-PRODUCT-BUILD-BRIEF.md`). Current milestone: **client portal in real use** (D23/D24), then real-key tests of the research suite.
Architecture: dependency-free Node core (`src/jobs`, `src/analysis`, `src/audit`), 38 agents (`departments/`), playbooks (`knowledge/`), workflow templates (`templates/workflows`), MCP server (`src/mcp`), hosted connector (`cloud/connector`, not deployed), portal (`cloud/portal`: Supabase schema, `ingest` Edge Function, static page).

## 3. Capabilities
| Implemented | Verified | Deployed |
|---|---|---|
| Jobs, agents, research suite, site intelligence, MCP server | `npm test` 481/481 (unit, fixture, mocked providers) | npm-free install via GitHub Action tags `v2` / `v2-stable` |
| Portal: snapshot `portal --push`, ingest, RLS, approvals, invites, branding | RLS SQL tests on local Postgres 16; live curl smoke of ingest and `shared_site` (2026-10-31) | Supabase `seo-autopilot` (`ymwwwhdlyjnqbxxhtcew`) + seo.erudience.com (Hostinger, erudience-flow-engine `seo-portal` `69f0d00`) |
| Address-only sites (D25): scan worker, discovery, Add and scan | 7 unit/offline tests (fake fetch) + portal browser test; **Deno runtime not run locally** | **not deployed**: migration waits for the owner's confirmation in Supabase |
| Hosted connector (D20) | unit tests + `wrangler dev` only | **not deployed** |
| Live provider calls (Brave, SerpAPI, DataForSEO, Bing, OPR, CrUX, AI engines) | **mocked only** | n/a |

## 4. Checks this session
`npm test` 481/481 pass (includes `test/discover.test.mjs`, 7 tests, and the updated portal browser test). `node cloud/portal/build-scan.mjs` copies 9 modules with no missing import. Not run: the function under Deno, a real scan of a live site, the migration on Supabase (its `apply_migration` call waited for a confirmation that was not answered).

## 5. Known issues and owner items
1. Sign up at seo.erudience.com (contact.bishalpaul@gmail.com), then per site: Connect → new token (replaces the temporary seed tokens).
2. Add repository secrets `SEO_PORTAL_URL` (`https://ymwwwhdlyjnqbxxhtcew.supabase.co/functions/v1/ingest`) and `SEO_PORTAL_TOKEN` on each site repo; Excel Error Finder also needs `GOOGLE_KEY_JSON` and Search Console access.
3. Seed snapshots show 2026-10-31 but hold 24 Oct data (backdate not applied).
4. Not checked: portal page in a real browser, live sign-up/sign-in.
5. Hosted connector needs the owner's GitHub App, Cloudflare deploy and secrets (`cloud/connector/README.md`).
6. **Approve the D25 migration** in Supabase (or run `cloud/portal/supabase/migrations/20261104000000_portal_url_sites.sql` in the SQL editor); then Claude adds the Vault secrets, deploys `scan` and the portal page.
7. Turn off unused connectors and plugins at claude.ai (repo settings can only deny connector tools; plugins/skills are account-level).

## 6. Cost
No paid API calls. Provider costs unknown until real-key tests.

## 7. Next
Milestone A (D25): add a real website by address and see its scan in the portal. Acceptance: the migration is applied, `scan` is deployed, adding a site shows its pages, issues and "About this website" within 10 minutes, and the next day's cron scan adds a second snapshot.
Milestone B: one real site pushing daily to the portal with its own token. Acceptance: a `seo-daily` run on a site repo shows a new snapshot in the portal, and an approval made in the portal is applied by the next run.
Then: real-key tests of the research suite, one provider at a time; grade agents on real sites; cost per agent run.

Resume prompt: "seo-autopilot: read docs/implementation/STATUS.md. Check `/context`; then continue the Next milestone."
