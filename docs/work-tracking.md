# Work evidence and retries

`team` still plans work. `work` records progress; it does not run an agent, approve a change, merge a PR or publish anything. D17 publication checks remain separate.

```sh
seo-autopilot run team --dry
seo-autopilot run work
seo-autopilot run work --start seo-snippet-optimizer
seo-autopilot run work --check seo-snippet-optimizer --result 'build=pass,facts=pass,seo-fact-checker=pass,seo-editor=pass'
seo-autopilot run work --done seo-snippet-optimizer --output 'PR reference or report path' --cost-usd 0.12
```

Only record checks actually performed. These are operator assertions, not trusted CI receipts. `--ready` checks the recorded validators and that the work has started; publication still uses the existing exact-commit policy gates.

For a failed attempt:

```sh
seo-autopilot run work --fail seo-snippet-optimizer --reason 'Build failed; see report reference' --cost-usd 0.03
seo-autopilot run work --retry seo-snippet-optimizer
seo-autopilot run work --start seo-snippet-optimizer
```

Retries clear checks and the current output, retain attempts/failure details and permit at most three attempts per work definition. Missing cost is unknown, including in the total if any attempt lacks a cost. This is spend recording, not a provider budget limit. Do not put keys, raw private content or credentials in reason/output fields.

`work-status.json` v2 binds records to the site and the order/dependency definitions. Regenerating an identical plan keeps evidence; changing an order or an upstream dependency invalidates it. State or plans explicitly bound to another site are refused. Legacy records without identity are archived and reset to pending, never silently trusted. Archives retain the last 200 superseded records. A legacy running record has to be resolved before replacing its plan; back up the state and verify the executor stopped before any manual migration.

Local `team` and mutating `work` calls take `work.lock`; a concurrent writer fails clearly. Writes use temporary files plus rename. If a process crashes and leaves a lock, verify that process has stopped before removing the lock. There is no automatic lock stealing, distributed lease or cross-machine coordination. Keep the existing GitHub workflow concurrency controls.

The local UI Work tab, generated HTML dashboard and `collectSiteData().work` show queued/running/done/failed/needs-review, scope, reasons, evidence, checks, dependencies, attempts, outputs and costs. Execution done with missing/failed checks appears as needs review. Plans have zero attempts. Publication and monitoring remain “not recorded” until separate receipts are implemented. The generated HTML is a saved snapshot; keep customer reports private.
