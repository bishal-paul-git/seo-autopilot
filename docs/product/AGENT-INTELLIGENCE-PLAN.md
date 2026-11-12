# Agent intelligence plan: how the SEO, AEO and GEO team learns, is checked and gets better

Status: **proposal for discussion. Nothing in it is built yet.** Written 2026-11-12, after the first two live specialist runs on erudience.com.
Owner decisions are in section 9. Nothing is built until they are answered.

---

## 1. Short answers to your questions

**Are the agents trained?**
No, not in the machine-learning sense.
- Every agent is the same general model (Claude, through your Anthropic key). Anthropic has already trained it on a very large amount of text, including a lot of SEO material.
- What makes an agent a "pruner" or a "link builder" is the job description we give it at the moment it runs (role, method, rules, output format), plus the data we give it about your site.
- That is the normal way to build agents today, but it only works as well as the instructions, the knowledge and the data you feed in.
- Today we feed in too little, and we never measure the result. Details in section 3.

**How do the big AI companies do it, and is it the same structure?**
There are two very different jobs, and people mix them up.
1. **Building a model** (what Anthropic, OpenAI and Google do):
   - **Pre-training:** train on trillions of words for months, on thousands of chips.
   - **Fine-tuning:** further training on examples of the behaviour they want.
   - **Feedback:** people and other models score answers, and the model is trained toward the better ones.
   - **Evaluation:** before release they run large test suites, safety tests and red-teaming.

   This costs tens to hundreds of millions of dollars. Nobody building an SEO product does this, and we should not.
2. **Building a product on a model** (what applied AI companies do, in legal, support, coding, marketing). Their structure:
   - **Knowledge:** curated, sourced, versioned documents the model reads when it needs them (often called RAG, "retrieval-augmented generation").
   - **Context:** exactly the right instructions, knowledge and data for each task, and no more (often called "context engineering").
   - **Tools and live data:** real APIs (here: Search Console, search results, backlinks, AI-answer tests) instead of the model's memory.
   - **Evaluations:** fixed test sets with scoring, run before every change, so quality is measured and not assumed.
   - **Review and guardrails:** automatic checks plus a second model or a person reviewing important output.
   - **Feedback loop:** real outcomes (did the advice work?) flow back into the knowledge and the instructions.
   - **Fine-tuning:** only at the end, if ever, when there are thousands of graded examples and a narrow task that prompting cannot reach.

   **Yes, that second structure is the right one for us**, and most of its parts already exist in this repo in some form. Section 4 maps them.

**Can we "train" the agents on SEO, AEO and GEO?**
Yes. For us, "training" means the four things below, in this order of value.
1. **Give them the right knowledge at run time:** our 30 playbooks and 7 skills, kept current and sourced.
2. **Give them real data:** Search Console, search results, backlinks, AI-answer tests.
3. **Measure them:** an exam per agent, scored on every change.
4. **Learn from outcomes:** what the agency approved or rejected, and what actually moved afterwards.

Real fine-tuning of the model is option F in section 6. My recommendation is not now, and here is why: it needs thousands of high-quality graded examples, which we do not have, and fine-tuning is not something we can rely on being available for the models we use. The four steps above get most of the gain at a small fraction of the cost.

**How do we make sure the pruner and the link builder give good results?**
- Through the same four steps.
- For those two specifically:
  - Do not let them decide removals or outreach targets without traffic and link data (section 5).
  - Have their output reviewed before you see it.
  - Score them on test cases with known right answers before they run on client sites.

**Where can we see and manage the agents?**
- **Today:** only in the repository (`departments/<department>/agents/<name>.md`, `knowledge/`, `departments/skills/`). The portal's SEO team page shows names and run counts only.
- **The plan:** add an agent page in the portal (section 7).

---

## 2. What the system is (verified 2026-11-12)

| Part | What exists | Where |
|---|---|---|
| Agents | 38, in 8 departments plus a director. Each has about 400 to 600 words: mission, inputs, method, quality bar, "never" rules, output | `departments/*/agents/*.md` |
| Playbooks (knowledge) | 30 files, about 15,900 words. They cover technical SEO, content and E-E-A-T, AI search visibility (AEO/GEO), local, ecommerce, international, links, entities, structured data, measurement and more | `knowledge/*.md` |
| Skills (shared procedures) | 7: AI-answer testing, answer-first copy, broken-link reclamation, digital PR, question mining, search-intent labelling, traffic potential | `departments/skills/*/SKILL.md` |
| Routing (who works on what) | A deterministic router reads the site profile, the audit and the data, and picks agents and their order | `src/analysis/agent-router.mjs` |
| Live runner | One model call per job: the agent's file, fixed safety rules and the site's data (strategy, profile, audit, up to 60 facts, lessons). Advice only, budget-capped | `src/god/agent-runner.mjs` |
| Quality gate | Deterministic checks: evidence present, scope kept to the site, numbers sourced, no injected instructions, within budget | `src/god/review.mjs` |
| Exam graders | Deterministic graders for "no invented figures", required sections, "says no data instead of guessing", prompt injection | `src/analysis/evals.mjs`, `test/evals/`, `docs/evals.md` |
| Learning from outcomes | Accepted advice is re-checked by later scans; lessons per agent change planning and reach the agents | `src/god/learning.mjs` (D31) |
| Research data (SERP, keywords, backlinks, AI visibility) | Built for Brave, SerpAPI, DataForSEO, Bing, Open PageRank, Perplexity, OpenAI, Gemini and more | `docs/research-suite.md`. **Tested with mocked responses only; not wired to the hosted agents** |

---

## 3. What is missing (found while checking the first live runs)

1. **Hosted agents never see their playbooks or skills.**
   - Each agent file says "Read first: `knowledge/...`", but the scheduler sends only the agent file.
   - So the pruner never reads the 357-word pruning playbook, and the link builder never reads the 739-word link-building playbook or the digital-PR skill.
2. **Low-risk advice skips the quality gate.**
   - Today's reporter and brand runs went straight to "done" with no review record.
   - The gate only runs on work that needs approval or changes something.
3. **No exam has ever been taken.**
   - The graders and a few test cases exist, but no agent has been scored on recorded output.
   - The only quality evidence is that I read the first two outputs by hand.
4. **No live data for the agents.**
   - There is no Search Console, search-results, backlink or AI-answer data.
   - The pruner cannot know which pages get traffic. The link builder cannot check targets. Nothing can measure AI visibility.
5. **Knowledge is not sourced or dated.**
   - Only 2 of 30 playbooks list sources or a review date.
   - SEO, and especially AI search, changes month to month, and nothing flags a stale playbook.
6. **Nothing is visible in the portal.** You cannot read an agent's instructions, see which playbooks it used, or compare its runs.
7. **No second-opinion review.**
   - The repo has an editor and a fact-checker agent, but they are not wired in as reviewers of other agents' output.

---

## 4. The target structure

```
                    ┌──────────────────────────────────────────────┐
  Knowledge base    │ playbooks + skills, each with sources, date, │  reviewed monthly; changes are
  (what we know)    │ owner, version; AEO/GEO section expanded     │  pull requests with a changelog
                    └───────────────┬──────────────────────────────┘
                                    │ the right pieces per agent and task
  Live data ─────►  ┌───────────────▼──────────────────────────────┐
  (what is true     │ Context builder: role + rules + playbooks +  │
   for this site)   │ skills + site facts + live data + lessons    │
                    └───────────────┬──────────────────────────────┘
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │ Specialist agent (Claude, your key, budget)  │
                    └───────────────┬──────────────────────────────┘
                                    ▼
                    ┌──────────────────────────────────────────────┐
  Checks            │ 1 quality gate (always)  2 reviewer agent    │
                    │ (editor / fact-checker) for content & risk   │
                    └───────────────┬──────────────────────────────┘
                                    ▼
                    ┌──────────────────────────────────────────────┐
                    │ Agency approval (you) → GitHub PR or advice  │
                    └───────────────┬──────────────────────────────┘
                                    ▼
  Feedback          ┌──────────────────────────────────────────────┐
                    │ Later scans + Search Console + AI-answer     │──► lessons per agent and per site
                    │ tests: did it work?  Your approve/reject     │──► exam cases from real mistakes
                    └──────────────────────────────────────────────┘
  Exams (before every change to an agent, playbook or model): fixed cases, scored, must not get worse.
```

---

## 5. SEO, AEO and GEO: what each agent group needs

| Group | Agents | Knowledge it must read | Live data it needs | What "good" means (exam focus) |
|---|---|---|---|---|
| Technical | technical fixer, indexing monitor, redirect guardian, schema engineer, performance, international, media, log analyst, migration planner | technical checklist, indexing and crawl, redirects and migrations, structured data, media | audit, Search Console coverage and URL inspection, field speed data (CrUX) | Right diagnosis from the evidence; no change that risks indexing without approval |
| Content | pruner, refresher, drafter, snippet optimiser, internal linker, cannibalisation resolver | pruning and refreshing, cannibalisation, content quality and E-E-A-T, briefs and drafting, titles and CTR | **Search Console clicks/impressions per page (essential for pruning)**, rankings, internal link graph | Never removes a page that earns traffic or links; every keep/merge/remove has numbers |
| Authority | link builder, backlink auditor, entity and reputation | link building and digital PR, entity and reputation; skills: digital PR, broken-link reclamation | backlink data (DataForSEO / Bing), brand mentions, Knowledge Graph and Wikidata | Real, relevant, checkable targets only; no paid or exchanged links; outreach a person would send |
| AI search (AEO/GEO) | AI search agent, AI visibility tracker, local AI visibility | AI search visibility, structured data, entity; skills: AI-answer testing, answer-first copy, question mining | **AI-answer tests** (does ChatGPT, Perplexity or Gemini cite the site for its questions?), Search Console | Measured citations before and after; answer-first copy grounded in the site's own facts |
| Research | researcher, SERP analyst, competitor analyst, topic mapper | keyword research, search intent, competitor analysis, topical authority | search results, keyword volumes, competitor pages | Clusters and intents that match real results; sources for every number |
| Quality | editor, fact-checker, compliance auditor | editorial checklist, content quality, local legal (for regulated sites) | the other agents' output | Catches invented facts and claims before you see them |
| Command | strategist, coordinator, reporter, onboarder | measuring and experiments, reporting, platforms | everything above, summarised | Honest reporting: says what is unknown |

The AEO/GEO knowledge needs the most work. AI answers change fastest, our playbook is only 402 words, and claims in this area must be dated and sourced or labelled as tested hypotheses.

---

## 6. Options for "training", compared

| Option | What it is | Gain | Cost | Recommendation |
|---|---|---|---|---|
| A. Knowledge at run time | Send each agent its playbooks and skills (and only those) | High: the agents follow the methods we wrote | about 3,000 to 5,000 more input tokens per run, roughly **$0.01 to $0.02 more per run** at current Opus prices | **Do first** |
| B. Sourced, dated knowledge | Add sources, a review date and an owner to every playbook; monthly review; expand AEO/GEO | High over time: keeps advice current | Writing time; no running cost | **Do** |
| C. Live data | Wire Search Console, then search results / backlinks / AI-answer tests (your keys) into the agents' input | Very high for pruner, link builder, AI search | Provider costs on your accounts (Search Console is free) | **Do; Search Console first** |
| D. Exams (evals) | 5 to 10 cases per agent with known right answers; deterministic graders plus a model grader checked against your judgement; run before every change | Makes quality measurable; stops regressions | Building the cases; running a full exam costs roughly $5 to $20 per pass (estimate) | **Do** |
| E. Review chain | Quality gate on every output; editor/fact-checker reviews content and high-risk output | Fewer bad recommendations reach you | about one extra model call on reviewed jobs | **Do** |
| F. Fine-tuning a model | Train a model on our own examples | Only after thousands of graded examples, for narrow tasks | High, and depends on what the model provider offers | **Not now.** Revisit when D has produced a large graded set |
| G. Train our own model | Build an SEO LLM | None for us | Tens of millions | **No** |

---

## 7. Plan, step by step (each step ends with something you can check)

**Step 1: Feed the knowledge (about 1 day)**
- Bundle playbooks and skills with the scheduler.
- Each agent gets exactly the files its "Read first" names. A test fails if a named file is missing.
- The agent's evidence lists which playbooks it read.
- Check: a pruner run shows "read: refreshing-and-pruning-content.md, ...", and the cost stays within budget.

**Step 2: Check everything (about 1 day)**
- Run the quality gate on every AI output, including low-risk advice, and record it.
- Content and high-risk output also goes to the fact-checker agent before reaching "Waiting for you".
- Check: every agent job has a review record, and a planted invented number is caught.

**Step 3: Agent pages in the portal (about 2 days)**
- SEO team → click an agent. The page shows:
  - its role, method, "never" rules and output format;
  - the playbooks and skills it reads, and the date and version of each;
  - every run on this site, with input size, cost, review verdict, your decision and outcome;
  - its exam score and the date of that score.
- Read-only. Changes go through the repository, so every change is reviewed, versioned and tested.
- Check: you can open "content pruner" and see all of the above.

**Step 4: Exams (about 3 to 5 days for the first 10 agents)**
- Start with the agents that touch your site soonest: pruner, link builder, entity, reporter, AI search, snippet optimiser, refresher, technical fixer, schema engineer, strategist.
- 5 to 10 cases each, made from real public pages and data, with the right answer written down. Example: "page with 0 clicks but 12 referring domains must not be removed".
- Score with the existing graders plus a model grader. The model grader is calibrated against your own scoring on a sample.
- Run the exams before any change to an agent, playbook, the model or the context builder. A drop blocks the change.
- Check: an exam report per agent with pass rate, cost, date and model.

**Step 5: Live data (Search Console 1 day once you give access; others 1 to 2 days each)**
- Search Console clicks, impressions, queries and indexing per page go into every agent's input.
- Then, on your own keys and only if you want them:
  - AI-answer tests (does Perplexity, ChatGPT or Gemini mention Erudience for the questions that matter);
  - search results and keyword data;
  - backlinks.
- Check: the pruner's recommendations cite clicks and impressions per page.

**Step 6: Sourced, current knowledge (ongoing; first pass 3 to 5 days)**
- Every playbook gets sources (Google Search Central, official documentation, our own tested results), a "last reviewed" date and an owner.
- Expand AI search (AEO/GEO): how AI engines pick sources, entity and structured-data signals, answer-first content, measurement. Claims are labelled "documented", "observed in our tests" or "hypothesis".
- A monthly job flags playbooks older than 90 days.
- Check: no playbook without sources or a date, and a stale playbook shows in the portal.

**Step 7: Learn from outcomes (ongoing, builds on D31)**
- Your approve/reject decisions with notes, and later results (scan, Search Console, AI-answer tests), become lessons per agent and per site.
- Repeated mistakes become new exam cases.
- Check: after a month, each active agent shows its record: advice accepted, carried out, and what changed.

**Later, only if the data justifies it:** fine-tuning (option F) for one narrow, high-volume task, compared head-to-head on the exams.

---

## 8. Costs (estimates, to confirm with real runs)
- **Today's measured runs:** $0.07 to $0.10 per specialist run on Opus. That is about 4 runs a day within the $2 budget for one site.
- **After steps 1 and 2:** about $0.10 to $0.15 per run, plus a reviewer call for content and high-risk work.
- **Exams:** roughly $5 to $20 per full pass of 10 agents. They run only when something changes.
- **Live data:** Search Console is free. Other providers bill your own accounts; we set caps per provider.

---

## 9. Decisions needed from you
1. **Order of steps.** My recommendation: 1 → 2 → 3, then 4 and 5 together, then 6 and 7 ongoing.
2. **Pause the pruner and link builder until steps 1, 2 and Search Console are done?** My recommendation: yes. You can still approve them now, since they only advise, but the output will be cautious and generic.
3. **Search Console:** will you give the scanning account access to erudience.com's property? It is the single most valuable data source.
4. **AI-answer testing (GEO measurement):** which providers do you want to pay for (Perplexity, OpenAI, Gemini), and at what monthly cap?
5. **Exam judgement:** will you (or someone you name) score a small sample, about 20 outputs, so the model grader can be calibrated against human judgement?
6. **Budget:** keep $2/day for now, and raise it once exams show the extra runs are worth it?

---

## 10. What this plan deliberately does not do
- Train or host our own model.
- Let any agent publish, delete, redirect or contact anyone without your approval (D17 stays).
- Use your clients' data to improve agents for other clients. Lessons stay per site unless you decide otherwise.
