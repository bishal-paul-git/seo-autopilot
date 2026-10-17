# 07 Hosted cloud (SaaS) MVP

**Goal:** a hosted version where a user connects a site in minutes (no secrets, no CLI) and an agency manages many sites. The core stays MIT; the cloud is the paid product (see `../strategy.md`).

**First:** write `docs/cloud-architecture.md` choosing (a) a GitHub App that installs workflows into the user's own Actions (no servers of ours, repository sites only), (b) a hosted runner running the same Node core and Python agent runtime, or (c) both. Recommended: (c), starting with (a). Cover data model, trust boundary, where tokens live, cost per site.

**Build (MVP, repository sites)**
1. GitHub App that opens a PR with the workflows; Google access through OAuth (Search Console, GA4) with minimal scopes instead of a service account JSON.
2. Sign in with GitHub, organisations with roles (owner, editor, viewer).
3. Postgres (Supabase fine): organisations, sites, runs, findings, plans, approvals, change sets, usage, audit log. Row-level security on every table, with tests proving one organisation can never read another's rows (a cross-tenant leak was found once in another project; this is the top risk).
4. Dashboard from brief 05 through an API.
5. Queue and per-site schedules, concurrency limits, plain-English failures.
6. Stripe subscriptions by number of sites, agency tier, free tier of one site. Users bring their own AI login or key; hosted AI usage optional, metered, hard-capped.
7. Encrypted tokens, least privilege, data export and deletion, privacy policy and terms reviewed by a person.

**Done when:** a design-partner agency connects three sites, receives plans, approves changes and is billed in Stripe test mode; tenant-isolation and billing tests pass; security review done.
