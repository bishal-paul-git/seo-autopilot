# System readiness plan: sort out, upgrade, prepare the full system

Status: **proposal, nothing in it is built yet.** Written 2026-11-12. It covers everything from today's pilot on erudience.com to a system an agency can run for many clients. The agent-quality part is described in detail in [AGENT-INTELLIGENCE-PLAN.md](AGENT-INTELLIGENCE-PLAN.md). This file puts it in order with everything else.

How to read it: each phase says **what I do**, **what you do and where**, **how you check it**, and **what it costs**. A phase starts only when you say go. Each phase is one pull request, with tests, and is deployed to the pilot only.

---

## Where we are today (checked 2026-11-12)

| Area | State |
|---|---|
| Scheduler (Cloudflare Worker, every 15 min) | **Working.** Runs 80 to 83 had no errors. Pause switch works |
| Database, security, backups | **Working.** Row-level security tested; backup schema kept; rollback script exists |
| Portal (seo.erudience.com) | **Working.** Live activity, business brief at onboarding, strategy approval |
| Pilot: erudience.com, read-only | **Running.** Strategy approved; 2 AI specialists ran ($0.17); 2 high-risk ones wait for your decision |
| Other 3 sites | Paused on purpose |
| AI specialists | **Partly.** They run, but without their playbooks, without live data, and low-risk output skips the quality gate |
| Exams for agents | Graders exist; **no agent has been scored** |
| Live data (Search Console, search results, backlinks, AI answers) | Code exists, **tested only with mocked responses**; not fed to the agents |
| Making changes to a site (GitHub pull requests) | Built, **not enabled for the pilot** (you said read-only) |
| Email summaries | Off until SMTP is set |
| Cloudflare "Workers Builds" check | **Red on every commit.** A dashboard setting, not the code |
| Handoff docs | STATUS.md sections 5 and 7 are out of date (they still describe last week's gates) |

---

## Phase 0. Sort out what is open (about half a day, almost no risk)

What I do:
1. Bring STATUS.md, the blockers list and the review questions up to date, so one page says what is true now.
2. Get PR #58 ready to merge (documentation only). You merge it, or tell me to.
3. List old PRs #23, #24 and #31 with a close or keep recommendation each. I close nothing myself.
4. Hold the content pruner and link builder jobs (you decide; see decision 2). They only advise, but without Search Console and their playbooks the advice would be generic.

What you do and where:
- **Cloudflare dashboard → Workers & Pages → seo-god → Settings → Builds → Disconnect.** This stops the red check. Deploys keep working through GitHub Actions.
- **Supabase → Authentication → Settings:** turn on leaked-password protection (Q9).
- Tell me who the platform admins are (Q10). Today there is one.
- Optional now, needed by Phase 6: **Supabase → Authentication → SMTP** with your mail provider, plus the `SMTP_*` and `PORTAL_URL` function secrets (Edge Functions → Secrets). Without these, no email summaries.

Check: every check on the PR is green; STATUS.md matches production.

---

## Phase 1. Make every AI output trustworthy (about 2 days)

Steps 1 and 2 of the intelligence plan.

What I do:
1. **Feed the knowledge.** The Worker bundles the 30 playbooks and 7 skills. Each agent gets exactly the files its "Read first" names. A test fails if a named file is missing. The run records which files it read.
2. **Check everything.** The quality gate runs on every AI output, low-risk advice included, and leaves a review record.
3. **Second opinion.** Content and high-risk output also goes to the fact-checker agent before it reaches "Waiting for you". If the two disagree, it goes to you marked as disputed.
4. Redeploy the Worker (GitHub Actions, the same workflow as before) and re-run one low-risk specialist on the pilot.

What you do: nothing, except say go.

Check (I report each with evidence):
- Every agent job has a review record.
- A planted invented number in a test output is caught.
- The re-run shows "read: …" with its playbooks, and its cost.

Cost: about $0.10 to $0.15 per specialist run (from $0.07 to $0.10), plus one reviewer call on content and high-risk work. Still inside $2 a day.

---

## Phase 2. See and manage the agents in the portal (about 2 days)

What I do: an **agent page** for each of the 38 agents (SEO team → click an agent), read-only:
- role, method, "never" rules and output format;
- which playbooks and skills it reads, with their date and version;
- every run on this site: input size, cost, review verdict, your decision and what happened after;
- exam score and date (once Phase 4 runs).

I also add a **team overview** showing, per agent: active or idle, last run, spend this month, and pass rate.

Why read-only: agent instructions change through the repository, so every change is reviewed, versioned and passes the exams first. Editing a prompt in a web form would skip all three.

What you do: look at it and tell me what is missing.

Check: you open "content pruner" and see its instructions, playbooks, runs and costs.

---

## Phase 3. Real data for the agents (Search Console about 1 day after access; others 1 to 2 days each)

The code already reads Search Console (`src/god/search-console.mjs`), but today only to measure accepted advice. This phase feeds it to the agents too.

What I do:
1. Search Console clicks, impressions, top queries and indexing per page go into every agent's input, summarised to keep cost down.
2. **First real-provider test.** Until now every provider was tested only with mocked responses. I test each one with your key before saying it works.
3. Then, only the providers you choose, each with a monthly cap:
   - **AI-answer tests (GEO/AEO measurement):** does Perplexity, ChatGPT or Gemini mention or cite erudience.com for the questions that matter?
   - **Search results and keyword data** (for example DataForSEO or SerpAPI).
   - **Backlinks** (for example DataForSEO or Bing Webmaster).

What you do and where (Search Console, the most valuable):
1. In **your own** Google Cloud project, create a service account and download its JSON key.
2. **Search Console → erudience.com property → Settings → Users and permissions → Add user:** the service account's email, permission **Restricted** (read-only).
3. Add the JSON key as the Worker secret `GOOGLE_KEY_JSON`: **Cloudflare → Workers & Pages → seo-god → Settings → Variables and secrets → Add → type Secret.** Never paste it in chat.
4. In the portal, a platform admin confirms Search Console for the site (I will make this a button; today it is the `set_gsc_allowed` call).

For each other provider: the same pattern, its key as a Worker secret, and you tell me the monthly cap.

Check: the pruner's advice cites clicks and impressions per page; one AI-answer test report lists the questions, the engines, and whether the site was cited.

Cost: Search Console is free. Others bill your own accounts, within the caps you set.

---

## Phase 4. Exams for agents (3 to 5 days for the first 10)

What I do:
1. Build 5 to 10 cases per agent from real public pages and data, each with the right answer written down. Example: "a page with 0 clicks but 12 referring domains must not be removed."
2. Start with the agents that touch the pilot soonest: pruner, link builder, entity and reputation, reporter, AI search, snippet optimiser, refresher, technical fixer, schema engineer, strategist.
3. Score with the existing deterministic graders plus a model grader.
4. Make the exams a gate: any change to an agent, a playbook, the model or the context builder must not lower the score.

What you do: score about 20 sample outputs yourself (or name someone), so I can check that the model grader agrees with a person. About an hour.

Check: one exam report per agent with pass rate, cost, date and model; shown on its agent page.

Cost: about $5 to $20 per full pass (estimate), run only when something changes.

---

## Phase 5. Current, sourced SEO, AEO and GEO knowledge (first pass 3 to 5 days, then monthly)

What I do:
1. Give every playbook its sources (Google Search Central, official documentation, our own tested results), a "last reviewed" date, an owner and a version. Today only 2 of 30 have sources.
2. Expand AI search (AEO/GEO), today a 402-word playbook: how AI engines pick sources, entities and structured data, answer-first content, measurement. Every claim is labelled **documented**, **observed in our tests** or **hypothesis**.
3. Add a monthly job that flags playbooks older than 90 days; the portal shows them.
4. Every knowledge change runs the Phase 4 exams before it is merged.

What you do: read the AEO/GEO playbook and strike anything you disagree with.

Check: no playbook without sources or a date; a stale one shows in the portal.

---

## Phase 6. From advice to changes on the site (needs your separate approval; about 1 day to switch on)

The GitHub flow is built and tested, but you made the pilot read-only (Q3). This phase is only for when you want it.

What I do:
1. Connect erudience.com's repository with the narrowest permissions.
2. Agents propose changes as **pull requests only**. Routine ones merge only after every automated check passes, within pace limits, with the kill switch (D17). Deletions, redirects, site-wide indexing, sensitive topics and outreach always wait for a person.
3. Start with one change type (titles and descriptions), then add others one at a time.

What you do: approve this phase explicitly, then **portal → the site → Connect GitHub**.

Check: the first pull request on erudience.com, with its review record and your approval.

---

## Phase 7. Prepare the full system for more sites and clients (about 3 to 5 days, spread out)

What I do:
1. **Turn the other 3 sites back on, one at a time.** Each starts read-only, with its own budget and brief, after a week of clean runs on the previous one.
2. **Per-site budgets in the portal** (today one daily cap per site from the Worker setting), and a monthly cost view per client.
3. **Alerts:** email to you when the scheduler misses runs, errors repeat, a budget is hit, or a job waits more than 3 days.
4. **Weekly client summary:** what was done, what was found, what is waiting, with evidence. Needs SMTP from Phase 0.
5. **Operations runbook:** how to pause everything, roll back a deploy, restore from backup, rotate a key. I rehearse the rollback once on a copy.
6. **Load check:** simulate 25 and 100 sites to see where the scheduler and the database slow down, before real clients arrive.
7. **Tag a release** once Phases 1 to 3 are stable, so the version history matches what is deployed.

What you do: decide the order of the 3 sites, and the budget for each.

Check: 4 sites running a week with no errors; one rehearsed rollback; one alert received.

---

## Phase 8. Ongoing (every week and month)

- Weekly: exams run on anything that changed; I report scores, costs and any drop.
- Monthly: knowledge review (stale playbooks, new Google or AI-search changes, with sources); outcome review: which advice was accepted, carried out, and what changed in Search Console and AI answers.
- Repeated mistakes become new exam cases. Lessons stay per site; nothing from one client improves agents for another unless you decide otherwise.
- Fine-tuning a model: only if the exams and a large graded set show a clear gain on one narrow task. Not before.

---

## Order, time and cost at a glance

| Phase | Time (my work) | Needs from you | Running cost |
|---|---|---|---|
| 0. Sort out | ½ day | Cloudflare Builds disconnect, Q9, Q10 | none |
| 1. Trustworthy output | 2 days | go | $0.10–0.15 per run |
| 2. Agent pages | 2 days | feedback | none |
| 3. Real data | 1 day + 1–2 per provider | Search Console access; provider choices and caps | Search Console free; others on your accounts |
| 4. Exams | 3–5 days | score ~20 outputs | $5–20 per pass |
| 5. Sourced knowledge | 3–5 days, then monthly | read AEO/GEO playbook | none |
| 6. Changes on the site | 1 day | separate approval; connect GitHub | none extra |
| 7. Full system | 3–5 days | site order and budgets; SMTP | per site, within your caps |
| 8. Ongoing | weekly/monthly | read reports | as above |

Time estimates are mine and may move; I report actual time and cost per phase. Recommended order: 0 → 1 → 2, then 3 and 4 together, then 5, then 7. Phase 6 whenever you approve it.

---

## Rules that hold in every phase
- No agent publishes, deletes, redirects or contacts anyone without your approval (D17).
- No invented facts; text from the internet is data, never instructions.
- Your keys only, stored as secrets, never in chat or the repository.
- Every phase: tests green before deploy, the previous version kept for rollback, and STATUS/CHANGELOG/DECISIONS updated.
- Spend stays inside the daily budget; nothing raises it without you.

## Decisions I need to start
1. **Go on Phases 0 and 1?** (Nothing in them changes erudience.com.)
2. **Hold the pruner and link builder** until Phases 1 and 3 are done? Recommended: yes.
3. **Search Console:** will you set up the access in Phase 3?
4. **AI-answer and other providers:** which ones, and the monthly cap for each.
5. **Exam scoring:** you, or someone you name.
6. **Budget:** keep $2/day until the exams show more runs are worth it?
