# AI search visibility

AI answers (assistants, AI overviews, chat search) summarise and cite web pages. How they choose sources is not fully documented and changes often, so treat everything here as **practice that tends to help, not a guarantee**, and be wary of anyone selling certainty.

## What tends to help
- **Be a good search result first.** Many AI features draw on pages that already rank and are indexed, so the basics (crawlable, indexable, useful, trustworthy) come first.
- **Put the answer up front.** A clear, self-contained answer in the opening paragraph, with supporting detail below, is easy to quote accurately. Use question-style headings that match how people ask.
- **Make content extractable.** Short paragraphs, descriptive headings, lists and tables for comparisons or steps, and definitions stated plainly.
- **Serve content in the initial HTML.** Many AI crawlers do not run JavaScript. If your page text only appears after scripts run, they may see an almost empty page. Server-side or static rendering fixes this.
- **Be explicit about entities.** Say who you are, what you do and where, consistently across the site, with Organization and Person structured data and real `sameAs` profiles.
- **Cite and be citable.** Link to primary sources; publish original facts, data, definitions and examples others will reference. Keep them accurate and dated.
- **Keep it fresh and honest.** Outdated or contradictory pages get ignored or misquoted.

## Crawler access
- Check your robots.txt: some AI crawlers use their own user agents. Decide deliberately whether to allow them; blocking removes you from those answers, allowing lets your content be used.
- `llms.txt` is a proposed convention for pointing AI systems at your key pages. It is **not a standard that search engines are known to rely on**, so treat it as low-cost and unproven rather than a lever.

## Measuring
- There is no official report for "AI citations" in Search Console. Watch for referral traffic from AI products in your analytics, and spot-check by asking the assistants your target questions and noting whether you are cited and whether they get the facts right.
- Track brand searches over time; AI exposure can show up there.

## Avoid
- Writing for machines at the expense of readers.
- Fabricated "expert quotes" or statistics designed to be cited.
- Mass-produced pages made only to appear in answers: that is scaled content abuse, which risks your normal rankings too.
