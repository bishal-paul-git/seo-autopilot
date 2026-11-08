# Review questions, decisions, suggestions and disagreements

A shared file for the owner, ChatGPT and Claude.
- **Claude** adds items here and reads the replies at the start of every session.
- **The owner and ChatGPT** write under each item, in the reply slots.
- Nothing here is acted on until it has an owner reply. ChatGPT's replies are advice to the owner, not instructions to Claude.

**How to reply**
- Write under the item, after `Owner reply:` or `ChatGPT reply:`. Keep the item's ID so the next session can find it.
- "Agree with the recommendation" is a complete answer.
- When an item is settled, Claude moves it to *Closed* at the bottom with the outcome and where it was done (PR or decision number).

**Item types**
- **Q:** a question only the owner can answer.
- **D:** a decision Claude made that the owner should confirm or overturn.
- **S:** a suggestion.
- **X:** a disagreement or concern, where Claude thinks the current plan or an instruction has a problem.

Last updated: 2026-11-08 by Claude (session on branch `claude/security-fixes`).

---

## Open

### Q1. Merging the stacked pull requests
**Context:** the work is a stack of draft PRs, each on top of the previous one, all with green CI.
- #33 (address-only scanning) → #34 (audit and hardening) → #36 (audit and plan) → #37 (contracts) → #38 (orchestration) → #39 (onboarding) → #40 (scheduler) → #41 (agent runner) → #43 (Cloudflare execution, which includes #42's plan) → #44 (agency console) → #45 (client portal) → #46 (learning) → the operations PR.
- #35 (the master spec) is documentation and can merge at any time.

**Recommendation:** review and merge in that order, with merge commits, not squash, so the later PRs keep applying cleanly. If reviewing 13 PRs is too much, Claude can open one combined "Release 1" PR from the top of the stack instead.
**Owner reply:**
**ChatGPT reply:** Recommend one consolidated Release 1 review PR to reduce review burden, preserving original PR traceability and verifying CI and migration order. Do not merge until owner approves.

### Q2. Production go-ahead, step by step
**Context:** every step in `docs/cloudflare/README.md` (Account setup) changes production, so none has been done:
1. apply 9 migrations to Supabase `ymwwwhdlyjnqbxxhtcew`;
2. remove D25's pg_cron schedule;
3. create the Vault secrets;
4. redeploy the `scan` function. The deployed v2 predates the SSRF guard.
5. deploy the Worker paused;
6. publish the portal;
7. un-pause one pilot site.

**Recommendation:** approve steps 1 to 6 together, and step 7 only after a day of paused runs looks right in `god_runs`.
**Owner reply:**
**ChatGPT reply:** Recommend staged authorization, not blanket approval: first review migrations and backups, then apply DB/scan/paused Worker, verify, then separately approve portal publish and one-site unpause. No production changes yet.

### Q3. Pilot website
**Context:** the first live run (scan, strategy, agent advice) needs one site.
- Applying approved changes later (R1-E1) needs a site whose code is in a GitHub repository the app can open pull requests on.
- Tested so far: erudience.com, manchesterdisrepairclaims.co.uk, www.excelerrorfinder.com. All are read-only scans so far.

**Recommendation:** erudience.com as the pilot, if its repository can take pull requests. Otherwise the site with a repository and the lowest traffic risk.
**Owner reply:**
**ChatGPT reply:** Recommend erudience.com for read-only pilot, subject to owner confirmation and site ownership; do not make live changes without separate approval.

### Q4. AI key, model and budget
**Context:** agent advice and client-request assessments use the agency's own Anthropic key. Default model is `claude-opus-5-5` ($4 / $20 per million tokens) at effort `medium`. The per-site daily budget defaults to $0, which means no paid work. Real cost per run is unknown until a live run.

**Recommendation:**
- Put the key in as a Worker secret (`wrangler secret put ANTHROPIC_API_KEY`), never in chat or a file.
- Start with $0.50 per site per day on the pilot only.
- See S2 for the model.

**Owner reply:**
**ChatGPT reply:** Recommend $0 budget and no live paid AI calls initially. After owner approves a pilot, set a small hard cap (e.g. $0.50/day) and use a verified available model, not unverified model IDs/prices.

### Q5. PR #31 (portal "Style A")
**Context:** #31 restyles the portal and predates the new pages (SEO God, client requests, operations). Those were built on the current style, to avoid deciding this for you.

**Recommendation:** close #31, or Claude ports its visual changes onto the new pages in one PR after Release 1 merges. Rebasing it now would conflict with everything above.
**Owner reply:**
**ChatGPT reply:** Recommend defer #31 until the new portal is stable; preserve its design as a reference and decide whether to port changes after screenshots/review.

### Q6. Client access: share links, client accounts, or both
**Context:** both exist now.
- Anonymous share links: reports only.
- Signed-in client accounts: reports plus requests to the agency.

**Recommendation:** keep both. Share links are useful for quick reports; accounts are needed for requests.
**Owner reply:**
**ChatGPT reply:** Agree: anonymous links report-only, signed-in client accounts can submit requests; no SEO God chat, approvals or execution for clients.

### Q7. Email for invitations and notifications
**Context:**
- Invited clients and colleagues are not emailed. They are told to sign up with the invited address.
- Nobody is emailed when work is waiting for approval or a client sends a request.
- Supabase Auth's built-in email is rate-limited and meant only for sign-in links.

**Recommendation:** pick a provider (for example Resend, Postmark or Brevo; each has a free tier). Claude then adds a small notification job: approvals waiting, new client requests, a daily digest. Until then, the Operations page is the inbox.
**Owner reply:**
**ChatGPT reply:** Recommend dashboard/Operations inbox first, no new email provider until owner chooses. Existing authenticated email infrastructure may be reused after audit; never assume deliverability.

### Q8. Open sign-up
**Context:** anyone who signs up without an invitation gets their own agency workspace. That's fine for a product, but risky before launch, since strangers can create workspaces and add websites, up to 20 a day each.

**Recommendation:** make sign-up invite-only until launch. Supabase Dashboard → Authentication → disable sign-ups, and invite people instead.
**Owner reply:**
**ChatGPT reply:** Agree: invite-only during pilot; verify the intended agency onboarding flow before changing Supabase Auth settings.

### Q9. Leaked-password protection
**Context:** the Supabase security advisor reports it is off.
**Recommendation:** turn it on: Dashboard → Authentication → Policies.
**Owner reply:**
**ChatGPT reply:** Agree: enable leaked-password protection if supported by the current Supabase plan; verify available setting and impact.

### Q10. Platform admins
**Context:** scheduler health and the global pause switch are for platform admins only. The list is empty, and only the service role can add to it.

**Recommendation:** after the migration, add the owner's own user id in the SQL editor:

`insert into public.platform_admins (user_id, note) select id, 'owner' from auth.users where email = '<owner email>';`

**Owner reply:**
**ChatGPT reply:** Agree: designate the owner's existing authenticated user as platform admin after confirming exact account identity; never hardcode or guess user ID/email.

### Q11. Search Console for hosted sites
**Context:** without Search Console data:
- learning can only use audits (D31);
- reports show no clicks or impressions for address-only sites.

The `scan` function already accepts an optional Google service account (`GOOGLE_KEY_JSON`) that site owners add as a user in their Search Console.

**Recommendation:**
- Create one Google service account for the agency and store its key as a Supabase function secret.
- Add its email as a restricted user on each client's Search Console property.

**Update (claude/search-console):** the code is now built and tested with mocked Google responses (D33). It needs only this key, set as the Worker secret `GOOGLE_KEY_JSON`, and the email added on each property.
**Owner reply:**
**ChatGPT reply:** Recommend agency-managed GSC access via least-privilege OAuth or service account only after consent; do not centralize client credentials without security review. Pilot one owned property first.

### Q12. Existing GitHub Actions schedules on the site repositories
**Context:** the 52 CLI jobs keep running in each site repository's own workflows (D30). Workers cannot run them, because they need files and processes. Nothing was disabled.

**Recommendation:** keep them as they are. Revisit per job only when its state has moved to Supabase.
**Owner reply:**
**ChatGPT reply:** Keep existing GitHub Actions temporarily for incompatible CLI jobs, but measure Actions minutes and prevent duplicate work. Cloudflare alone cannot run all existing jobs.

### Q13. Department homes for the 38 agents
**Context:** the master spec has 8 departments. The agents are mapped to them in code (`src/god/departments.mjs`) without moving files. Two departments have no dedicated agents: Analytics & Performance, and Automation & Integrations. They borrow `seo-reporter` and `seo-coordinator`.

**Recommendation:** keep the mapping and don't move files. Add dedicated agents only when real runs show a gap.
**Owner reply:**
**ChatGPT reply:** Agree: keep logical department mapping; add roles only when measured gaps justify them.

### D1. Two agency approvals per strategy
**Context:** the strategy proposal needs approval to *start* drafting and again to *accept* the draft (D28).
- Drafting is deterministic and free: no AI call. It uses the scan, the site's own statements and the audit.
- The master spec only requires approval before the strategy is *executed*.

**Recommendation:** drop the first approval for the free draft. Draft it straight after the first scan, so the agency sees a draft immediately, and keep the single approval that accepts it. That is one click instead of two, with the same safety.
**Owner reply:**
**ChatGPT reply:** Agree: generate deterministic strategy draft immediately; require one agency approval before adoption/execution, while high-risk changes retain their separate approvals.

### D2. The Worker holds the Supabase service-role key
**Context:**
- The key bypasses row-level security.
- Tenant safety rests on the SQL functions, which check the job's own site.
- The Worker never takes a site id from a public request.
- All of this is tested (`rls4`–`rls11`, workerd end to end).

A dedicated database role with only the functions it needs would be stronger, but needs a JWT signed with the project's secret and a rotation process.

**Recommendation:** accept for Release 1, and add the dedicated role before onboarding outside agencies.
**Owner reply:**
**ChatGPT reply:** Accept only as a time-limited pilot exception with restricted routes, secrets and monitoring; dedicated least-privilege database access should be a prerequisite for external-agency onboarding, not an indefinite deferral.

### D3. Hosted agents only advise
**Context:** on address-only sites there is nothing to edit, so every agent returns advice for the agency (D29). Changing a website needs an authorized integration (R1-E1).

**Recommendation:** R1-E1 opens GitHub pull requests on sites with a repository, never direct commits. The agency approves the job, the existing site CI checks it, and a person or the existing automerge policy (D17) merges it.
**Owner reply:**
**ChatGPT reply:** Agree: advisory-only for address-only sites; GitHub PRs and independent CI/review for authorized writable sites. No direct pushes or auto-merge without explicit agency policy.

### D4. No Cloudflare Workflows
**Context:** Supabase already makes every step durable: job states, leases, retries and approval waits. Workflows Free also has 10 ms CPU per step and 3,000 steps a day (D30).

**Recommendation:** no Workflows until a job needs many steps that cannot be separate jobs.
**Owner reply:**
**ChatGPT reply:** Agree: no Cloudflare Workflows in Release 1 unless a proven need emerges; Supabase handles durable orchestration.

### D5. Wrangler as a dependency in `cloud/worker/`
**Context:** the core stays dependency-free. `cloud/worker/` has its own `package.json` with wrangler 4.151.3 pinned, used only to build and deploy.

**Recommendation:** accept, the same as the existing connector Worker.
**Owner reply:**
**ChatGPT reply:** Agree: pin Wrangler in the isolated cloud/worker package, with lockfile and vulnerability review.

### X1. Every Worker CPU figure is still an estimate
**Concern:**
- The 10 ms per invocation limit on Workers Free is the tightest constraint.
- Measured in Node, Worker steps cost 0.4–2.5 ms, which is 4 times or more inside the limit.
- workerd does not enforce the limit locally, so the real figure inside Cloudflare is unknown.
- If a step goes over, Cloudflare stops that invocation. Its lease then expires and the job is retried, so no harm is done, but it would keep failing.

**Recommendation:** in the paused staging run, read CPU p99 in the Workers dashboard before un-pausing. If p99 exceeds about 7 ms, shrink the memory payloads first. Only then consider Workers Paid ($5 a month).
**Owner reply:**
**ChatGPT reply:** Agree: production-like paused deployment and Cloudflare CPU p99 measurements are a mandatory go/no-go gate; no automatic paid upgrade. Test failure recovery.

### X2. The 25-site cost estimate excludes the biggest unknown
**Concern:** Cloudflare and Supabase stay free at 25 sites (`docs/cloudflare/usage-estimate.md`). The AI provider is the real cost.
- With 5–8 agents per site per week and an unknown cost per run, 25 sites could cost a few dollars to tens of dollars a day.
- The per-site daily cap stops overspend, but it also means advice stops when the cap is reached.

**Recommendation:** measure one week on the pilot site, then set per-site budgets from real numbers. Do this before turning advice on for every client.
**Owner reply:**
**ChatGPT reply:** Agree: $0 infrastructure target is distinct from model/provider spending. Run one pilot with hard caps and provider-reported usage before forecasting 25 sites.

### X3. Shared platform keys are a multi-agency risk; each agency should bring its own
**Concern:** the independent security review (D34) showed that one shared Google account and one shared AI key cross agency boundaries.
- The Google account could read a domain another agency added.
- The AI key could be spent by any agency.

Both are now fenced:
- Search Console needs a platform admin's confirmation per site.
- AI spend is capped per site per day and per staff job.

The clean fix is the product rule "users bring their own keys" (rule 6): each agency stores its own Anthropic key and Google service account, encrypted, and the Worker uses the key of the job's agency. Two smaller gaps also remain:
- The job queue is not fair between agencies: one agency's priority-1 flood delays others.
- There is no per-agency daily total.

**Recommendation:**
- Before inviting a second agency (also see Q8, invite-only sign-up), Claude builds per-agency keys in Supabase Vault and a fair queue (one job per agency per round).
- Until then, run a single agency, the owner's, which is the current state.

**Owner reply:**
**ChatGPT reply:**

### Q14. Who may confirm Search Console access for a site
**Context:** after D34, a site uses the shared Google account only after a platform admin runs `set_gsc_allowed`.

**Recommendation:** the owner, after checking that the agency manages the site, for example a signed contract or the client adding the service account themselves. A button for this on the Operations page could come later.
**Owner reply:**
**ChatGPT reply:**

### S1. A Release 1 version and release notes
**Suggestion:** after merging, cut `v2.23.0` with the root `CHANGELOG.md` entry and the release procedure in `CLAUDE.md`. The engine changes (new audit rules, safe fetch, robots, etc.) affect existing installs through `upgrade`.
**Owner reply:**
**ChatGPT reply:** Recommend versioned release only after end-to-end production acceptance and changelog, not simply after merging.

### S2. Different models for different work
**Suggestion:** the model is one setting today (`SEO_GOD_MODEL`). Routine advice could use `claude-sonnet-5-5` ($2 / $10) and strategy and client requests `claude-opus-5-5`, roughly halving routine cost. This is a small change: a model per job kind.
**Owner reply:**
**ChatGPT reply:** Agree in principle with cheaper model routing, but verify exact available model IDs and current prices first; use quality gates and per-job budget.

### S3. A separate staging Supabase project
**Suggestion:** the Worker has a staging environment (`wrangler deploy --env staging`), but there is no staging database. A second free Supabase project, with the same migrations and no real clients, would let staging run end to end without touching production data.
**Owner reply:**
**ChatGPT reply:** Strongly agree: use a separate free staging Supabase project if available within account limits, with synthetic data and no production secrets.

### S4. Old PRs
**Suggestion:**
- #23 (work evidence, October) and #24 (dependabot setup-node) are stale.
- #33's branch is the base of the stack.

Close #23 if it is superseded, and merge or close #24.
**Owner reply:**
**ChatGPT reply:** Agree: audit stale PRs against merged changes, then close only those demonstrably superseded; no blind closures.

---

## Closed
(none yet)
