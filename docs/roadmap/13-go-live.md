# Brief 13: Going live (open source launch, then paid hosted product)

Owner question (2026-10-23): "what do we need to make this project live as a SaaS, or open source?" This brief is the checklist. The model follows `docs/strategy.md`: open core, with a done-for-you service as the first income.

## Stage A: open-source launch (about 1 to 2 weeks of work, almost no cost)
The code is MIT and released (v2.16.0). What is missing is proof and polish.
1. **Proof on real sites.** Two or three sites, Erudience first, run the full loop for 4 to 6 weeks. Report real before-and-after numbers with dates and sources. This is the case study. Invent nothing.
2. **Live provider checks.** Run the research suite once with real keys and record the results (brief 03): Search Console, CrUX, Knowledge Graph, Open PageRank, Bing, and later DataForSEO.
3. **One-command install.** Publish to npm (`npx seo-autopilot init`), and a GitHub Action on the Marketplace (brief 08).
4. **Documentation and a demo.** Landing site (`site/`) with a 2-minute video, the live demo connector, and a "connect in Claude" button.
5. **Community basics.** Issue templates, the security policy (exists), a roadmap page, Discussions, and a release cadence (tag-release workflow).
6. **Launch posts.** Show HN, r/SEO, r/bigseo, Product Hunt, Indie Hackers, and the Claude and MCP directories. Lead with the case study.

## Stage B: hosted product, "SEO Autopilot Cloud" (about 6 to 10 weeks)
Users sign in, connect Google and their site, and get the team with no GitHub skills needed.
1. **Hosted connector (D20).** Built and merged; deploy it (STATUS next actions). This is the first paid feature: "use your SEO team from Claude and ChatGPT".
2. **Accounts and tenancy (D2, D3).** Workspaces, sites, members and roles. Postgres (Supabase is already in use by the owner) with row-level security.
3. **Job runner (D13).** A Node worker in a container that runs the unchanged CLI jobs per site on a schedule and stores the reports. Workers cannot run the engine.
4. **Connections.**
   - Google: Search Console, GA4 and Business Profile through OAuth, with the user's own data.
   - GitHub App, for sites in a repository.
   - CMS connectors for everyone else, WordPress first (brief 06), then Shopify and Webflow.
5. **Web app (brief 05).** Portfolio dashboard, approvals inbox, monthly reports, and agency white-label reports.
6. **Billing.** Stripe subscriptions and usage limits per plan. Users bring their own AI key or buy credits. Pass paid provider costs (DataForSEO, SERP) through at cost plus margin, and show them.
7. **Trust and legal.**
   - Before taking payment: privacy policy, terms, data processing agreement, cookie consent, GDPR records, data deletion, Google OAuth app verification (Search Console scopes need Google's review), and security review.
   - Never promise rankings.
8. **Operations.** Monitoring, error alerts, backups, support inbox, status page.

## Stage C: growth
Vertical packs (brief 12) sold as specialist teams ("e-commerce SEO team", "local SEO team"), agency plan, marketplace apps (Shopify, WordPress), partners.

## Pricing to test (hypothesis, not data)
| Plan | Who | Includes |
|---|---|---|
| Free | Developers | Open-source core in your own GitHub |
| Solo | One site owner | Hosted runs, dashboard, connector, 1 site |
| Pro | Small business or consultant | 5 sites, vertical packs, approvals |
| Agency | Agencies | 25+ sites, white-label reports, team roles |
| Done-for-you | Any business | Monthly service run by the owner on this product |

Set prices from customer conversations and competitor research at the time. This file states no prices on purpose.

## What only the owner can do
- Decide the product name and domain.
- Set up a company or legal entity, a Stripe account, and the Google OAuth app verification.
- Choose the first 3 to 5 pilot customers, ideally done-for-you clients.
- Approve or amend the Phase 0 decisions D1 to D15 in `docs/implementation/DECISIONS.md`.
