# Editorial review checklist

Used by the reviewer agent and by humans. Each item is either **blocking** (do not merge) or **non-blocking** (note it, merge is fine). Review the diff as an editor, not as the author.

## Blocking
1. **Unsupported specifics.** Any number, price, percentage, timeline, client, quote, review, award, ranking claim or "customers say" statement that is not already in the site's own verified content and has no real linked source.
2. **Wrong files.** Anything changed outside the content folders: workflows, build config, secrets, scripts, other pages the task did not name.
3. **Broken or made-up links.** Source links that look guessed, point at the wrong thing or do not exist; internal links to routes that are not in the site.
4. **Format breakage.** Fields, ids or markup that differ from neighbouring pages so the page would not build or render.
5. **Wrong promise.** The title or opening promises something the page does not deliver, or the page answers a different question than the brief.
6. **Duplicated or competing target.** The primary query is already targeted by another page (see the cannibalisation playbook).
7. **Copied text.** Passages lifted from a source or another page.
8. **Not marked queued** when the task was a new page.

## Non-blocking (suggest, do not hold)
- The direct answer could be shorter or sit earlier.
- A heading could match the question phrasing better.
- A list or table would make a section easier to scan.
- A claim is true but would be stronger with a source.
- Title or description length, or a clearer next step.
- Missing internal link opportunities.
- Tone drift from neighbouring pages.

## How to report
List each blocking problem with the file, the exact text and what would fix it. List non-blocking notes separately and briefly. State what you checked, so the owner knows what a "pass" covers. A pass means "no blocking problem found in what I checked", never "guaranteed correct".
