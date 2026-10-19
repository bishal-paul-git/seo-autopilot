# Connected projects

How any website project connects to seo-autopilot, stays up to date, and feeds what it learns back into the product. This page is the same for every business. Anything specific to one site (its rules, secrets, history, plans) lives in that site's own repository.

## Connect a project
1. In the site's repository: `npx seo-autopilot init --url https://example.com/` (add `--content markdown --dir content` or `--content json --include "..."` only if you want the drafting agent to write there). `init` copies the config, data files, 27 agents, 26 playbooks and the GitHub workflows, and tells you what it detected (platform, edit or advise mode).
2. Give Google access (a service account added to Search Console, saved as the secret `GOOGLE_KEY_JSON`) and run `seo-autopilot doctor`.
3. The workflows install the product from a pinned reference (`github:bishal-paul-git/seo-autopilot#v2` by default). Pin to an exact version (`#v2.14.0`) if you want no surprises, or to `v2-stable`.
4. State (reports, history) is kept on the project's own `seo-data` branch; it holds no secrets and is never merged into the main branch.

## Keep it up to date
- `seo-autopilot upgrade --diff` shows what is new; `--apply` adds missing files and refreshes agents and playbooks. A project's own **Project rules** section in each agent file is kept.
- Customised workflows are never overwritten without `--force`. If you customised a workflow, copy the new steps by hand (the diff shows them).
- Read the product `CHANGELOG.md` before moving between minor versions.

## Make the agents yours
Each agent file ends with a `## Project rules` section. Put the site's facts and limits there: approved description, banned claims, regulated topics, files that must never change, who approves what. Upgrades preserve it.

## Feed back into the product
Projects find the real problems. To keep the product general:
- Record needs, bugs and ideas in the project's own repository (a short `PRODUCT-REQUESTS` note is enough) and open an issue in the product repository labelled `from-project` with the general version: what happened, on which kind of site, what the product should do. Leave out names, content and private data.
- Maintainers triage `from-project` issues into `docs/roadmap/` briefs. Site-specific fixes stay in the project.
- Never commit a project's restored state, content or credentials to the product repository.

## What belongs where
| In the product repository | In the project's repository |
|---|---|
| Jobs, agents, playbooks, templates, tests, generic docs | The site's config, data files, Project rules, secrets list, workflows it customised |
| Roadmap briefs written for any business | Its own SEO plans, keyword maps, page plans, owner decisions, case-study notes |
| Fixtures and examples with neutral names | Real reports, real URLs, real numbers |
