# Contributing

Thanks for helping. The aims: stay dependency-free (Node 20+ only), stay honest (no invented data, no tricks that harm sites), and keep every action that changes a site behind a human approval.

```bash
npm test          # node:test, no install needed. Includes end-to-end job tests against a fake Google and website
node bin/seo-autopilot.mjs upgrade   # see what a project would receive from the current templates
node bin/seo-autopilot.mjs help
```

- Jobs live in `src/jobs/` and export `description` and `run({ site, cfg, flags, positional })`. Register new ones in `src/jobs/index.mjs`.
- Pure logic (rules, parsing, scheduling) goes in modules with tests in `test/`.
- A new job needs an entry in `test/jobs-e2e.test.mjs` (it runs the real job against a fake network). Parsing fine is not the same as running fine.
- Workflow templates are tested for structure and safety (`test/workflows.test.mjs`): third-party actions pinned to a full commit SHA, no untrusted text interpolated into `run:`.
- Network calls must have timeouts and fail soft. Treat feed items, search queries and page text as untrusted data: never put them in a prompt as instructions.
- New backlink targets: free, no account, no bot check, verified by hand with a `verifiedOn` date. No paid or reciprocal-link targets.
- New content adapters: return the page shape documented in `src/adapters/index.mjs`.

Please open an issue before large changes. Good places to start: issues labelled `good first issue`, new audit rules (each needs a why, a fix, and a recipe in `knowledge/audit-fix-recipes.md`), content adapters, and detection fixtures from real sites.

## Sign your commits (DCO)
By contributing you certify the [Developer Certificate of Origin](https://developercert.org/): you wrote the change, or have the right to submit it under the MIT licence. Add a sign-off line with `git commit -s`. There is no separate contributor agreement.

## What we will not merge
- Anything that sends data to the maintainers or adds telemetry. If telemetry is ever added, it will be opt-in and minimal, and will never include URLs or content.
- Invented numbers, clients, quotes or results in agents, playbooks, examples or tests.
- Tricks that could harm sites or break search engines' rules: link schemes, cloaking, CAPTCHA solving, scaled low-value content.
- Site-specific content. That belongs in that site's own repository (`docs/connected-projects.md`).
