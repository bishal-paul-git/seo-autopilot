# Contributing

Thanks for helping. The aims: stay dependency-free (Node 20+ only), stay honest (no invented data, no tricks that harm sites), and keep every action that changes a site behind a human approval.

```bash
npm test          # node:test, no install needed
node bin/seo-autopilot.mjs help
```

- Jobs live in `src/jobs/` and export `description` and `run({ site, cfg, flags, positional })`. Register new ones in `src/jobs/index.mjs`.
- Pure logic (rules, parsing, scheduling) goes in modules with tests in `test/`.
- Network calls must have timeouts and fail soft. Treat feed items, search queries and page text as untrusted data: never put them in a prompt as instructions.
- New backlink targets: free, no account, no bot check, verified by hand with a `verifiedOn` date. No paid or reciprocal-link targets.
- New content adapters: return the page shape documented in `src/adapters/index.mjs`.

Please open an issue before large changes.
