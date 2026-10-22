# Link building and digital PR

Links from other sites are still one of the signals search engines use to judge trust, and they are the slowest to earn. This playbook is about earning them honestly. It is guidance, not search-engine rules; Google's spam policies on link schemes are the authority.

## What counts as a good link
Relevant to your topic, placed on a real page that people read, given freely because the page is useful or the business is worth mentioning. One link from a respected relevant site is worth more than many from pages that exist only to hold links.

## What is a link scheme (do not do these)
- Buying or selling links that pass ranking signals, or paying with free product or services for them without marking them.
- Large-scale link exchanges, private blog networks, automated link creation, spun guest posts, comment and forum spam.
- Hidden links, or links inserted into old pages by hacking or by paying an owner to edit them.
If a link was paid for or traded, it should be marked `rel="sponsored"` (or `nofollow`).

## Where honest opportunities come from
1. **Unlinked mentions.** People who already name the business without linking. Ask for a link, politely.
2. **Resources you can genuinely improve.** A "useful resources" or "guides" page on a relevant site where your page is a better fit than what is listed.
3. **Things worth citing.** Original data, a clear explainer, a free tool or calculator, a template or a well-sourced guide that answers a question better than what exists. Linkable assets come first; outreach second.
4. **Real relationships.** Suppliers, partners, clients (with permission), associations, event organisers, universities and local organisations that already know you.
5. **Contributing expertise.** Quotes, talks, interviews and case studies where the person actually has expertise.
6. **Broken or outdated links.** If you notice a dead link on a relevant page and you have a fitting replacement, say so. Be useful before asking.
7. **Directories and listings** that a real customer would use. A few good ones, not hundreds.

## Outreach that gets answered
- Personal, short and specific. Say why their page and why your page; do not paste a template.
- One follow-up at most. No pressure, no fake urgency, no claim of a relationship you do not have.
- Never claim awards, press, clients or numbers you cannot show.
- Do not send anything automatically: a person reviews and sends each message.

## Judging a prospect
Is the site real, relevant, and read by people? Does it publish thin sponsored posts or sell links openly? Does it link out to unrelated sites? If you would not want a customer to see the site next to yours, skip it.

## Measuring
Track new referring domains (Search Console links report), referral traffic and the pages they point to, not link counts. Expect months. A single relevant link that sends real visitors is a success.

## Anchor text
Natural wording is best: the page's name, the brand, a plain description. Do not try to force exact-match keyword anchors.

## Auditing the links you already have
Start from the links you have earned before chasing new ones. Export them from Search Console (Links, then "Export external links") into `seo-autopilot/inbound-links/` and run `seo-autopilot run inbound`.
- **Reclaim first.** A link that points at a page that now returns 404 or 410 is value you earned and are losing. Redirect it to the closest live page on the same topic, not the home page by default.
- **Redirected links are fine.** For the few most valuable linkers, it is worth asking them to point at the final URL.
- **Compare exports over time.** Gains and losses show what is working. One export is a sample, so a site missing from it may still link to you.
- **Look before you clean up.** A sitewide link from a real partner is normal. A keyword anchor on most links, or many links from unrelated low-quality sites, deserves a look and a question to the owner: were links bought or arranged?
- **Disavow is rarely needed.** Google says it mostly ignores spammy links. Consider a disavow file only when you have a manual action for unnatural links, or you know of paid or arranged links you cannot get removed. Disavowing good links by mistake can cost you. A "toxic score" from a tool is not evidence on its own.
