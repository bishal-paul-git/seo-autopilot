# 09 Known gaps and polish

Small items found while running the product on a real production site. Any order; one release per batch.

**Fix**
1. `ymyl` false alarms (tree surgeons flagged for "safety"): per-site allow-list, page-type filter, show matched words.
2. Thin-content rule flags funnel, tool and hub pages (`/contact`, `/book`): page-role detection or a `thinIgnore` config; `seo-content-pruner` reads it.
3. Indexing counts disagree with Search Console because retired URLs (410/404 on purpose) count as not indexed: exclude URLs in the redirect map or retired list and say what was excluded.
4. Request-indexing list goes stale: re-inspect before listing, drop indexed URLs, show last inspection date.
5. Detect when Google's chosen canonical differs from the declared one only by a trailing slash (`/about` vs `/about/`) and report the fix.
6. `profile`: `gohugo.io` reports Unknown and `ghost.org` reports Hugo. Add signals and a table test of 30 well-known sites using recorded HTML.
7. Optional headless render to compare delivered vs rendered text for single-page apps.
8. One shared helper that preserves CRLF/LF for every in-place file patch.
9. `upgrade` for customised workflows: three-way diff and merge new steps (a customised weekly workflow needed manual edits).

**Add**
- `run agents --list` and `--explain <agent>`; a `--site all` portfolio summary.
- Optional Slack, email and Discord webhooks for the weekly plan and high findings.
- Playbooks: reviews and rating markup, news and publisher SEO, SaaS and B2B comparison pages, programmatic SEO quality, voice and visual search.
- Agents (propose, then test with brief 04): programmatic-quality guard, entity consistency checker, review and mention monitor, log-file analyst (including AI crawlers), accessibility-for-SEO checker.
- Let `pace` apply its schedule on request (needs a safe writer per content type and a confirmation step).
- CLI and docs translations.

**Done when:** each item verified on a real site or a fixture, tests added, CHANGELOG, release.
