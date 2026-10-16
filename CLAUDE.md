# Claude Code — SEO Autopilot

Read SEO-PRODUCT-BUILD-BRIEF.md before product planning or implementation. It identifies the Marketing Mouse and News to Blog source repositories and the required audit/reuse process. This is a planning handoff; no product build is claimed.

## Mandatory progress handoff
At the start of every substantive session, read docs/implementation/STATUS.md if present and inspect git status/log. Do not overwrite uncommitted work. Reconcile claims with actual source and current branch. Create the following files if absent; maintain them during authorised implementation and before ending a session:
- docs/implementation/STATUS.md — current concise snapshot and next-session entry point.
- docs/implementation/CHANGELOG.md — append dated session entries; preserve history.
- docs/implementation/DECISIONS.md — architecture/product decisions with rationale and tradeoffs.

STATUS.md must contain:
1. Last updated date/time with timezone, branch, audited base commit, relevant implementation commit/PR links and environment.
2. Goal and current phase/milestone; brief current architecture with source paths.
3. Separate tables for implemented, verified and deployed capabilities. Source present is not proof it works. Local success is not production deployment.
4. This session's actual changes and files, migrations/configuration/dependency changes and why.
5. Checks: exact commands, pass/fail/not-run, relevant output summary and environment limitations. Separate mocked/unit/DB tests from real external integration evidence. Never invent results.
6. Deployment: actual revision, environment, migrations/functions deployed, evidence/time and rollback limits; otherwise explicitly not deployed or unknown.
7. Known bugs, failed checks, risks, missing access and outstanding owner decisions.
8. Usage/cost evidence where relevant; label estimates and unknown provider costs.
9. Earliest next milestone, acceptance criteria, exact next actions and a short resume prompt.

CHANGELOG entries must distinguish code changes, documentation-only changes and deployment actions. Record dates, paths, tests and references. Do not put secrets, raw private transcripts, customer data or credentials into handoff files. Use redacted evidence references.
Before finishing, update these files even when blocked or when a check fails. Keep STATUS concise and move detailed evidence into linked files. Do not mark a whole phase complete because scaffolding exists.

## Working discipline
Audit and reuse before rebuilding. Inspect applicable directory instructions, current branches, tests and data flows. Use feature branches for implementation; preserve existing work and published history. Do not introduce unrelated rewrites.
This documentation handoff alone does not instruct implementation, purchases, live customer changes or production deployment. Follow the owner's subsequent task scope; progress-reporting is part of all authorised build work.
Be candid: distinguish observed facts, hypotheses and proposals. Challenge weak ideas with concrete reasoning, and propose a smaller useful alternative.
