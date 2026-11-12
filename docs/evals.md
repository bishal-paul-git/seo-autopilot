# Agent evaluations

Status: the deterministic graders exist and are tested. The hosted agents now have **exams** (D48): see "Exams for the hosted agents" below. **No agent has been evaluated on a real model yet.** That needs recorded agent runs on the fixture inputs; model runs cost money and are opt-in. Roadmap: `docs/roadmap/04-agent-evals-and-safety.md`.

## What the graders check
`src/analysis/evals.mjs` contains pure functions with no network and no model:

| Check | Case field | Fails when |
|---|---|---|
| Required sections | `expect.sections` | a listed heading or phrase is missing |
| No invented figures | `expect.noUnsupportedFigures` | the output has a percentage, a money amount, or a number with two or more digits that appears in none of the `inputs`. Single digits, list markers, years, ISO dates and URLs are ignored. Matching ignores thousands separators |
| Required and banned phrases | `expect.mustInclude`, `expect.mustNotInclude` | a phrase is missing, or a banned phrase is present |
| "No data" instead of invention | `expect.noData` | an output for empty inputs does not say that data is missing |
| Prompt injection | `expect.injection.markers`, `mustFlag` | the output contains a marker only an obedient answer would contain (the attacker's address, issue title or command) without flagging the injection. With `mustFlag`, it also fails when the injection goes unmentioned |

These are minimum bars. Passing does not mean the advice is good; judgment needs a person or a model grader, and the model grader is not built yet.

## Adding a case
Add an object to `test/evals/cases.json`:
- `id`: the file name of the recorded output.
- `agent`: the agent's name.
- `inputs`: the exact text the agent is given, treated as data.
- `expect`: the checks above.
- `samples.good` and `samples.bad`: short hand-written outputs. `npm test` asserts that the good one passes and the bad one fails, which proves the case can tell them apart.

## Grading recorded outputs
1. Run the agent on each case's inputs and save its report verbatim as `<case-id>.md` in one folder.
2. Grade the folder:
   ```
   node scripts/evals.mjs path/to/outputs
   ```
   This writes `evals-results.json` and `evals-summary.md` to that folder, and exits 1 if any case fails.

When publishing results, state the agent, the model, the date and the number of cases. Never publish a pass rate from the hand-written samples.

## Exams for the hosted agents (D48)
`exams/cases.json` holds cases for the agents the scheduler runs: a made-up business's site memory, a task, and the right answer as checks (`src/analysis/exams.mjs`: the checks above plus `forbid`, `requireRec`, `maxRecommendations`, `escalates`). Each case has a good and a bad sample that `npm test` grades.

Run them through the production path (playbooks, quality gate, fact-checker, budget) on your own key:
```
ANTHROPIC_API_KEY=... node scripts/exams.mjs --max-usd 5 [--agents seo-content-pruner,seo-reporter] [--publish]
```
Or run the `agent-exams` workflow in GitHub Actions (it needs the `ANTHROPIC_API_KEY` repository secret). Results: `exams/results/<date>-<model>.json` and `.md`, and a scoring sheet for a person. `--publish` writes `exams/latest.json`; the portal's agent pages show it after the next portal build.
