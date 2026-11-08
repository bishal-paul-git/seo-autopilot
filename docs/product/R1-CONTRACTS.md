# Release 1 shared contracts

Status: **built and tested locally; not applied to any database.** Migration
`cloud/portal/supabase/migrations/20261108000000_r1_contracts.sql`, engine mirror `src/core/job-lifecycle.mjs`.
Implements roadmap §2 (shared contracts) for the items the database must guarantee. Owner decisions honoured: Q27/Q30
(client portal = results + submissions), Q28 (agency-only approvals), Q29 (submissions never execute), Q07 (priority).

## Entities
| Entity | Table | Who reads | Who writes |
|---|---|---|---|
| Agency workspace | `orgs`, `org_members` (existing) | members | sign-up trigger, owners |
| Client | `clients` | agency members | `create_client` (agency) |
| Website | `sites` (+ `client_id`) | agency members; client viewers through `client_sites()` | agency functions, scan, ingest |
| Client viewer | `client_members`, `client_invites` | agency members | `invite_client_user` (agency); sign-up trigger |
| Job | `jobs` | agency members | `create_job` (agency, service), `transition_job`, `claim_job`, `fail_job` (service), `approve_job` (agency) |
| Job event (append-only) | `job_events` | agency members | written only by `private.move_job` and `create_job` |
| Review | `reviews` | agency members | `record_review` (service); reviewer must differ from the producing agent |
| Approval | `approvals` | agency members | `approve_job` (agency only) |
| Client submission (untrusted) | `submissions` | agency members; the client's own through `my_submissions()` (no analysis) | `submit_to_agency` (client or agency); `review_submission` (agency) |
| Site memory (private) | `site_memory` with `basis` stated / inferred / verified / answered and confidence | agency members | service role |
| Integration (no secrets) | `integrations` with `scope` read / write | agency members | service role |
| Audit log | `audit_log` | agency owners | the functions above |

## Job lifecycle
`proposed → scoped → queued → running → awaiting_review → awaiting_approval → authorized → deploying → verifying → completed`,
with `failed`, `cancelled`, `rejected`, `escalated`. Allowed moves: `MOVES` in `src/core/job-lifecycle.mjs` (identical to
`private.job_move_allowed`, checked by a test). Gates, all enforced in `private.move_job`:
1. A job that needs approval (high risk, from a client submission, or flagged) cannot be queued, run, authorized or
   deployed until the latest agency decision is "approve".
2. Medium and high risk work leaves review only after the latest independent review passed; a review by the producing
   agent is refused.
3. Only low-risk jobs without approval complete straight from running.
4. Retries: `fail_job` requeues with a growing delay until `max_attempts` (default 3), then escalates.
5. Leases: `claim_job` takes the highest-priority ready job (dependencies completed, `not_before` passed) with
   `FOR UPDATE SKIP LOCKED`; a repeated `idempotency_key` returns the existing job instead of a duplicate.
6. Workers cannot reject, or authorize work that needs approval: only `approve_job` (agency) can.
Every move writes a `job_events` row; approvals and submissions also write `audit_log`.

## Client submissions (Q29)
`received` → agency `review_submission`: `accepted` (creates a **proposed** job, priority 1, `requires_approval`, inputs
marked `untrusted`), `rejected`, or `needs_clarification`. A submission never creates or moves a job by itself; its text
is stored as data. Clients see status and the agency's note, never the SEO God analysis.

## Permission matrix (tested in `cloud/portal/supabase/test/rls4.sql`)
| Action | Agency member | Client viewer | Other agency | Anonymous | Service role |
|---|---|---|---|---|---|
| List agency sites (`my_sites`) | own org | empty | own org only | refused | |
| Client results (`client_sites`) | | own client's sites, internal fields removed | | refused | |
| Read jobs, events, reviews, approvals, memory, integrations, submissions, clients, decisions, links | own org | none | none | none | all |
| Read audit log | owners | none | none | none | all |
| Create job | own sites (sources agency, on_demand) | refused | refused | refused | any source |
| Move, claim, fail, review jobs | refused | refused | refused | refused | yes, through the gates |
| Approve / reject jobs, decide GitHub proposals | own org | refused | refused | refused | refused (`approve_job` needs a user) |
| Submit advisory input | own sites | own client's sites, 30 a day | refused | refused | |
| Review submissions | own org | refused | refused | refused | |
| Create clients, invite client users, assign sites | own org | refused | refused | refused | |

## Not yet built on these contracts
Portal screens for clients and the submission inbox (R1-P2), the SEO God planner and queue worker (R1-A2), onboarding
questions and strategy proposals (R1-B2), file uploads with scanning, email, and the shared-knowledge promotion
pipeline (R1-D1).
