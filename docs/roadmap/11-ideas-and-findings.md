# 11 Ideas and findings backlog

Items from real use that are not yet briefs. Each is general: it applies to any kind of business. Turn one into a brief or an issue when you pick it up.

## Bugs and corrections found in real use
1. **Topic proposals ignore the site's language and market.** The research job proposed a topic in a language the site does not publish in (a Dutch query for an English-language site). Add `site.language` and `site.market` to the config, filter proposals and keyword backlog by them, and say what was filtered.
2. **Request-indexing and indexing summaries disagree with reality** (already listed in brief 09: stale lists, retired URLs counted as not indexed). Also record the last inspection date per URL in the list.
3. **Agent web search was US-only** during agent runs, so local-market rankings and AI answers could not be seen. Brief 03 covers a location-aware provider; until then each agent report must state the market it could and could not see.
4. **Funnel and tool pages flagged thin** (brief 09). Add page-role detection.
5. **Consent and measurement:** after a consent banner ships, reported analytics fall. The reporter should show real versus measured traffic and avoid reading the fall as a decline (the `consent` job already explains it; carry it into `seo-reporter` and the dashboard).

## Capabilities that would help most (ordered)
1. **Page planner and funnels** (brief 10).
2. **Named author and reviewer workflow for sensitive topics:** a per-page `author` and `reviewedBy` with a hold until set, shown in the dashboard; builds on the `ymyl` job.
3. **Release pace applier:** let `pace` write its recommended schedule when the user confirms (brief 09), with a diff and a rollback.
4. **Internal-link proposals as pull requests** (from the `links` job) for sites in edit mode, always reviewed.
5. **Brand and entity consistency check:** compare the business description, name and contact details across the site, structured data and public profiles; flag differences (builds on `seo-entity-reputation`).
6. **AI answer monitoring over time** with a stored question set and share-of-voice trend (the `citations` job), after live provider tests.
7. **Experiment logging by default:** every change an agent makes creates an experiment entry automatically so reports can judge it later. In real use the log stayed empty because logging was manual.
8. **Playbooks to add:** B2B and partner-programme pages, pricing and plan pages, SaaS comparison and alternatives pages, local services, publisher and news SEO, programmatic SEO quality.
9. **Onboarding that reads the site and asks only what it cannot see:** fill business facts, languages, conversion events and consent state into a starter `Project rules`.

## Product and business ideas (see `../strategy.md`)
- Agency view: one screen for many client sites with approvals and white-label reports.
- Done-for-you service as the first revenue, used to collect real before and after data for a case study.
- Marketplace presence: GitHub Action, Claude Code plugin, later a WordPress connector.
- Honest positioning: measured, directional results; never promise rankings or AI citations.
