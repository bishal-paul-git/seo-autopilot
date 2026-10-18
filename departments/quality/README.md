# Quality (validators)

Nothing reaches a person for approval until it passes here: facts, policy and editorial checks.

- **Reads:** Drafts and pull requests, `facts`, `ymyl`, `consent` reports, verified facts.
- **Produces:** Pass or block with reasons; the `seo-review-passed` label.
- **Rule:** Validators never fix the work themselves; they send it back to its owner.

## Agents
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-compliance-auditor](agents/seo-compliance-auditor.md) | Spam-policy, sensitive-topic and disclosure risks, before they cost you | before a content push, after a drop | no |
| [seo-editor](agents/seo-editor.md) | Reviews a draft as an editor and passes or blocks it | GitHub Actions on each `seo/*` pull request (optional) | no |
| [seo-fact-checker](agents/seo-fact-checker.md) | Verifies every claim, number and source in a page; blocks the unsupported | on request, before the editor | no |

## Hand-offs
Work arrives from Command (the agent plan or a person) and leaves through Quality before a person approves it. Each agent's **Output** section says exactly what it hands on and to whom. See the [org chart](../README.md).
