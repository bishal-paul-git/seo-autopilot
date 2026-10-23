# How seo-autopilot compares with paid SEO suites

An honest comparison with suites such as Ahrefs and Semrush. They are mature products with their own web-scale data. seo-autopilot is a different kind of tool: an open-source SEO team that works on your own data and does the work, not only the reporting. This page describes kinds of capability. It does not quote other products' prices or numbers, which change; check their sites.

## What seo-autopilot does that a reporting suite does not
- **It acts.** Agents draft the fix, the title, the internal links or the new page as a pull request. Routine changes can merge on autopilot after every automated check passes; risky ones wait for a person (decision D17).
- **First-party data first.** Positions, demand and clicks come from your own Google Search Console. That is exact for your site, not modelled.
- **Open source and yours.** MIT licence. It runs in your own GitHub repository with your own keys, so your data never passes through us.
- **AI search visibility.** The `ai-visibility` job asks ChatGPT, Claude, Gemini and Perplexity your questions through their official APIs, with web search on, and records who they mention and cite.
- **Use it from your AI assistant.** It works from Claude and ChatGPT: the MCP server runs locally, and the hosted connector is in `cloud/connector`.
- **Explained advice.** Every audit rule says why it matters and how to fix it. 29 written playbooks say where guidance comes from and where it is uncertain.

## What the paid suites have that seo-autopilot does not
- **Their own web index.** Backlink databases and keyword volume estimates built from their own crawling and clickstream data. seo-autopilot has none of its own. With your DataForSEO key it adds estimated volumes, competitors' rankings and backlinks, labelled as estimates.
- **Data for queries you have never ranked for.** Search Console only knows queries where Google showed your site. Gap and keyword research beyond that needs a provider key.
- **Long SERP history and market-wide trends.** Rank history here starts the day you install it (Search Console keeps 16 months).
- **Paid ads, social and market intelligence.** Not in scope.
- **A polished hosted interface and support team.** Today seo-autopilot is a CLI, GitHub workflows, a local app and a static dashboard. A hosted version is on the roadmap.

## Which to choose
- **seo-autopilot** if you own a site or a few, want the routine SEO work done and checked, and are comfortable with GitHub, or work with someone who is.
- **A paid suite** if you need competitive data at market scale: backlink research on any domain, keyword volumes for markets you are not in yet, or agency-wide reporting today.
- **Both together** is common. Use a suite for market research and seo-autopilot to carry out the work on your own site.

Capability details: [research-suite.md](research-suite.md), [jobs.md](jobs.md), [agents.md](agents.md).
