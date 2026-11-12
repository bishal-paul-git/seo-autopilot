# AI search visibility

Last reviewed: 2026-11-12 · Version: 2 · Owner: SEO Autopilot maintainers

AI answers (assistants, AI overviews, chat search) summarise and cite web pages. How they choose sources is mostly not documented and changes often, so treat everything here as **practice that tends to help, not a guarantee**, and be wary of anyone selling certainty.

Every claim below carries a label, so an agent knows how far to trust it:
- **[documented]**: a provider says so in its own documentation (see Sources).
- **[observed]**: reported by third parties or seen in our own tests, not stated by the provider.
- **[hypothesis]**: plausible practice that nobody has shown to work. Recommend it as low-cost, never promise a result.

## What tends to help
- **Be a good search result first.** Many AI features draw on pages that already rank and are indexed, so the basics (crawlable, indexable, useful, trustworthy) come first. [observed]
- **Put the answer up front.** A clear, self-contained answer in the opening paragraph, with supporting detail below, is easy to quote accurately. Use question-style headings that match how people ask. [hypothesis]
- **Make content extractable.** Short paragraphs, descriptive headings, lists and tables for comparisons or steps, and definitions stated plainly. [hypothesis]
- **Serve content in the initial HTML.** Many AI crawlers are reported not to run JavaScript. If your page text only appears after scripts run, they may see an almost empty page. Server-side or static rendering removes the risk. [observed]
- **Be explicit about entities.** Say who you are, what you do and where, consistently across the site, with Organization and Person structured data and `sameAs` links to pages that unambiguously describe you. [hypothesis for AI answers]
- **Cite and be citable.** Link to primary sources; publish original facts, data, definitions and examples others will reference. Keep them accurate and dated. [hypothesis]
- **Keep it fresh and honest.** Outdated or contradictory pages get ignored or misquoted. [observed]

## Crawler access
- **Decide per crawler and per purpose.** At least one provider separates training, search indexing and user-requested fetches into different robots.txt user agents: Anthropic's `ClaudeBot` (content that may be used for training), `Claude-SearchBot` (indexing for search results) and `Claude-User` (pages fetched when a user asks). Blocking the search or user agents may reduce the site's visibility in that assistant's answers; blocking only the training agent does not remove you from search. Rules apply per subdomain. [documented, Anthropic]
- A common, defensible choice: allow search and user-requested fetches, and decide about training separately with the owner. Never change robots.txt for AI crawlers without the owner's approval (site-wide indexing change, D17).
- Other providers (OpenAI, Perplexity, Google, Microsoft) publish their own user agents and controls. Check each provider's current documentation before recommending a rule; do not copy user-agent names from memory. [to be verified: their documentation was not reachable when this playbook was last reviewed]
- `llms.txt` is a **proposal** (its own repository calls it "a proposal to standardise"), mainly meant for use when a model answers a question, not for training. No search engine or AI provider is documented as using it to choose sources. Treat it as low-cost and unproven, never as a lever. [documented as a proposal; use by AI search is a hypothesis]

## Measuring
- There is no separate "AI citations" report in Search Console. Watch for referral traffic from AI products in your analytics, and spot-check by asking the assistants your target questions and noting whether you are cited and whether they get the facts right (skill: AI-answer testing). [observed]
- Whether Google counts its AI features' clicks inside the normal Performance report is to be verified against Google's current documentation before you state it.
- Track brand searches over time; AI exposure can show up there. [hypothesis]

## Avoid
- Writing for machines at the expense of readers.
- Fabricated "expert quotes" or statistics designed to be cited.
- Mass-produced pages made only to appear in answers: that is scaled content abuse, which risks your normal rankings too.
- Promising citations, rankings in AI answers, or any figure: nothing here is guaranteed.

## Sources
- [Does Anthropic crawl data from the web, and how can site owners block the crawler?](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) (Anthropic, checked 2026-11-12): the three user agents and their purposes, robots.txt per subdomain, and that blocking search or user agents may reduce visibility.
- [The /llms.txt file](https://github.com/AnswerDotAI/llms-txt) (Answer.AI, checked 2026-11-12): the proposal's own repository; describes llms.txt as a proposal open for community input.
