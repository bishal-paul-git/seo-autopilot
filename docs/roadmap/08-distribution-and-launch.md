# 08 Distribution and launch

**Goal:** make the product easy to find, try and trust. Cheap, mostly packaging and writing; do it before the cloud.

**Build**
1. Publish to npm (check the name; otherwise scope it) with a tag-triggered publish workflow; confirm `npx seo-autopilot init` works anywhere. Today installs use `github:bishal-paul-git/seo-autopilot#v2`.
2. A GitHub Action (`uses:` one line, inputs for job, site, flags) listed on the Marketplace.
3. A Claude Code plugin with the agents, playbooks, a `profile`/`team` skill and commands like `/seo-plan`; check the current plugin format in the official docs first.
4. Extend `site/`: five-minute path, a demo run with real output, a "which platform are you on" guide (edit vs advise), FAQ, an honest comparison, and a roadmap page generated from `docs/roadmap/`.
5. A first case study from a real site, from real numbers only (indexed pages, impressions, clicks, key events, what changed when), clearly marked early; update monthly. Use it to offer a done-for-you service.
6. Waitlist for the cloud, public discussions, `good first issue` labels.
7. No telemetry by default; if added, opt-in, minimal, never URLs or content.
8. Keep MIT; add NOTICE and a trademark policy; decide DCO or CLA; add a disclosure contact to `SECURITY.md`.

**Done when:** on npm and the Marketplace, plugin installable, site updated, waitlist live; fresh-machine test of `init` on Next.js, Hugo and plain HTML sites; release.
