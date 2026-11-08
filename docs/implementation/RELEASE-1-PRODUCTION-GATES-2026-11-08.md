# Release 1 consolidated review and paused deployment — handover (2026-11-08)

Source of authority: `docs/implementation/REVIEW-QUESTIONS.md` on `claude/operations`. Owner has answered Q1, Q2, Q3, Q8. ChatGPT recommendations are advisory, NOT owner approvals.

## Owner decisions
- Q1: one consolidated Release 1 review PR, preserving traceability to all existing stacked PRs. **Do not merge automatically**.
- Q2: owner approves preparing and deploying a Cloudflare Worker in a **paused** state after safety checks and reviewed deployment sequence. This is not blanket permission for migrations, scan redeployment, portal publishing, activating Cron jobs or paid AI use. Present exact production-impacting steps, backup and rollback for approval.
- Q3: `erudience.com` is the first **read-only** pilot. No modifications without separate approval.
- Q8: invite-only registration before public launch. Preserve admin login and invite flows.

## Remaining questions and provisional dispositions
- Q4 AI key/model/budget: **OPEN OWNER APPROVAL**. Default $0; no paid model calls. Verify actual provider model availability/prices before requesting a pilot budget.
- Q5 Style A PR #31: **OPEN OWNER CHOICE**. Defer styling until consolidated portal works; compare screenshots then.
- Q6 client access: **OPEN OWNER CONFIRMATION**. Recommended both report-only share links and signed-in submissions, with no client execution or SEO God chat.
- Q7 email: **OPEN OWNER CHOICE**. Use Operations inbox initially, no additional provider until approved.
- Q9 leaked-password protection: recommended enable after checking plan and effects; requires account configuration approval.
- Q10 platform admin: **OPEN OWNER IDENTITY CONFIRMATION** before assigning admin.
- Q11 GSC: **OPEN OWNER AUTHORIZATION** for least-privilege read-only pilot access.
- Q12 GitHub Actions: retain until an audited alternative exists; verify minutes and prevent duplicate schedules.
- Q13 agent mapping: preserve existing department mapping; add roles only for demonstrated gaps.
- D1 strategy approval: recommend draft without approval, then one agency approval for acceptance; high-risk changes retain independent approvals. **Requires owner confirmation**.
- D2 Worker service-role key: pilot-only risk exception subject to route and secret controls; least-privilege access before outside agencies. **Requires owner acceptance**.
- D3 advise-only: retain for address-only; changes through reviewed GitHub PRs. **Requires owner confirmation**.
- D4 no Workflows: retain current Supabase-backed durable lifecycle; add Workflows only for verified need.
- D5 Wrangler: keep pinned isolated dependency and lockfile.
- X1 Cloudflare Free CPU: real Cloudflare p99 must be measured on paused/staging deployment before activation; no paid upgrade without owner approval.
- X2 cost: Cloudflare/Supabase free estimate is not an AI/API budget. Hard cap and measured pilot cost required.
- S1 release tag: defer until E2E and security release gates pass.
- S2 model routing: verify models and quality; no assumed prices.
- S3 separate Supabase staging: strongly recommended; subject to free project availability.
- S4 stale PRs: audit, don't close blindly.

## Work Claude should perform next without production writes
1. Fetch latest `claude/operations`, owner replies, status, migration chain, open PRs, CI, and release checklist.
2. Create **one consolidated draft Release 1 review PR** from the integrated head into `main` if branch topology allows. Show exact diff, dependencies, checks, and link every original PR. Do not merge. Avoid duplicate commits/PR churn.
3. Re-run all tests and real browser staging checks; record SHA, environment, commands and evidence. Audit every migration for RLS, grants, service-role bypass, backward compatibility and backups.
4. Produce a production change manifest for each of: Supabase migrations (verify count and order), scan redeploy, Vault secrets, Cloudflare paused deploy, Cron safety, Hostinger portal publish, invite-only Auth setting, and rollback. **Ask approval before applying any production-affecting step**.
5. Prefer isolated staging Supabase and Cloudflare environment, synthetic data and no production credentials. Confirm free-tier limits with actual account measurements.
6. Verify a paused Worker cannot execute due jobs even if Cron fires, and measure CPU p99, errors, request counts and Supabase consumption. Keep AI spending at $0.
7. Prepare read-only `erudience.com` pilot test matrix: URL scan, onboarding, strategy draft, agency review, client read-only boundaries, monitoring, recovery, no writes; request separate authorization to unpause.
8. Surface only unresolved owner decisions that actually block the next milestone. Do not interpret ChatGPT recommendations as owner instructions.

## Gates to production
- Gate A: consolidated PR, integration tests, security review, staging and migration/rollback plan accepted.
- Gate B: explicit approval of each production DB/function/portal change; Cloudflare deployed **paused**, zero AI spend.
- Gate C: paused-run telemetry healthy and safe; explicit owner authorization to unpause read-only pilot.
- Gate D: verified live provider/model quality and budget; separate authorization for AI spend or site changes.
- Gate E: multi-tenant negative tests, browser/mobile QA, alerting, backup/restore, operational handover; phased agency rollout.

Current state: production not changed by this handover. No release is merged or deployed here.
