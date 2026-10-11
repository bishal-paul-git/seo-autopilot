# Changelog

## 2.1.0

- **Local management app:** `seo-autopilot ui` serves one page on 127.0.0.1 that manages every project on your computer (overview and charts, index status, request-indexing links, schedule, keywords, backlinks, GitHub approvals, digest, sync, dry runs). Token-protected, host- and origin-checked, fixed list of allowed jobs, never submits or publishes.
- `projects add|list|remove` to choose which website folders the app shows.
- Landing site in `site/` with a clearly labelled sample-data demo, plus a Pages workflow (dormant until Pages is enabled).

## 2.0.3

- `propose` no longer opens "add internal links" issues for pages Google has not crawled yet (they go to the weekly request-indexing list). Opt back in with `"proposals": { "undiscovered": true }`.

## 2.0.2

- `state restore` now unstages the restored files, so a later `git add -A && git commit` can never put saved reports into your main branch.

## 2.0.1

- Security hardening of the drafting workflow: the agent may only edit your content paths and can no longer run build/test commands; the build now runs in a separate secret-free, read-only `seo-check.yml`; `claude-code-action` pinned to a commit SHA.

## 2.0.0

A rewrite from a single-site script pack into an installable, config-driven tool.

- `init`, `doctor`, `run`, `state` commands; `npx github:bishal-paul-git/seo-autopilot#v2 init` scaffolds config, data files and workflows into any repo.
- Multi-site config, content adapters (sitemap, JSON, Markdown).
- New jobs: weekly keyword research, news watcher (RSS/Atom), weekly digest with GA4, topic proposals, weekly "request indexing" list, drip scheduling and release, unlinked-mention finder, backlink submitter with daily cap, retry and full logging, hand-done checklist.
- Self-contained HTML dashboard; optional Supabase dashboard template.
- Approval-gated drafting workflow (issue label, pull request, merge).
- Fixed a state-saving bug that nested a `reports` folder on every run.

## 0.1.0

Initial release: daily report, IndexNow, onboarding skill.
