# Security model

Status as of 2026-11-07. Report vulnerabilities as in [SECURITY.md](../SECURITY.md).

## Principals and what each may do
| Principal | How it authenticates | May |
|---|---|---|
| Agency member | Supabase Auth (email + password) | read its orgs' rows (RLS `private.is_member`); add sites; make share links and tokens; decide proposals; update a site's name, url, repo, status (column grant) |
| Agency owner | same, `role = owner` | the above, plus delete sites, invite people, change the brand |
| Client (share link) | 25-character random token in the URL (revocable) | read one site's snapshot, brand and growth (`shared_site`, anon) |
| A site's daily run | site token (`spt_` + 64 hex), stored hashed (`private.ingest_tokens`) | store snapshots for that site, fetch and acknowledge its decisions (`ingest` function, service role) |
| `scan` function | shared secret in Vault (`scan_secret`), compared inside Postgres | claim and store scans of address-only sites (`claim_scan`, `finish_scan`, service role) |
| Agents in a site repository | GitHub token of the workflow | branches `seo/*`, pull requests, issues; never the default branch (D17) |

## Controls, with how they are verified
| Control | Where | Verified by |
|---|---|---|
| Row-level security on every portal table; writes only through checked functions | migrations | `cloud/portal/supabase/test/rls.sql`, `rls2.sql`, `rls3.sql` on Postgres 16 (`run.sh`) |
| Tenant isolation for address-only sites (another org cannot see, scan, claim or store) | D25 migration | `rls3.sql` |
| Service-only scan functions (`claim_scan`, `finish_scan`, `scan_secret_ok`) refused to `authenticated` and `anon` | D25 migration | `rls3.sql` |
| Address validation: https, public DNS name, port 443 only, no IP literals, no internal suffixes | `private.public_host`, table constraint `sites_url_public` (also when a member edits `url` directly) | `rls3.sql` |
| Abuse limits: 50 address-only sites per org, 20 added per org per day, "Scan now" at most every 30 minutes | D25 migration | `rls3.sql` |
| **SSRF guard** on every scanner request and redirect hop: http(s) only, ports 80/443, no credentials in URLs, no private/loopback/link-local/CGNAT/metadata ranges (IPv4, IPv6, mapped), no numeric or internal hostnames, DNS answers checked where the runtime can resolve, 5 MB body cap, 5 redirects | `src/hosted/safe-fetch.mjs`, used by `src/hosted/scan.mjs` | `test/safe-fetch.test.mjs` |
| Robots.txt respected by hosted scans (a disallowed home page stops the scan; disallowed pages are not fetched, including link checks) | `src/audit/crawl.mjs` (`respectRobots`), `scan.mjs` | `test/safe-fetch.test.mjs` |
| Snapshot size limit 4 MB; 120 snapshots kept per site | `ingest_snapshot`, `finish_scan` | migration code review |
| Secrets never in the repository, workflows or docs; agents never get them | conventions, `.gitignore`, GitHub secrets, Supabase Vault and function secrets | code review; GitHub secret scanning |
| Agents treat fetched text as data; only the technical fixer may run a shell, supervised | agent definitions | `test/agents.test.mjs`, `test/registry.test.mjs` |

## Known risks and open items
| Risk | Severity | Status |
|---|---|---|
| DNS rebinding: the guard resolves a name, the runtime resolves it again when connecting | low (Supabase Edge egress is outside the project's network) | documented; a pinned-address connect is not available in the Edge runtime |
| Open sign-up: anyone can create an account and an org, and so use the scanner within the limits above | medium | owner decision: invite-only sign-up or billing before public launch |
| Leaked-password protection is off in Supabase Auth (advisor warning) | low | owner: Authentication > Policies |
| Deployed `scan` function v2 predates the SSRF guard | none while the D25 migration is not applied (it refuses every call without the Vault secret); must be replaced before applying it | blocker in [deployment-status.md](deployment-status.md) |
| Members (not only owners) can change a site's url/name/status | low (by design) | constraint keeps address-only urls public |
| Advisor warnings for `SECURITY DEFINER` functions callable by signed-in users and `shared_site` by anon | intended: each checks membership or a token itself | covered by the SQL checks |
