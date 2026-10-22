# Local SEO — AI visibility

How local businesses appear in AI-generated answers: Google AI Overviews, ChatGPT, Perplexity, Claude and Gemini. Complements the core `local-seo.md` playbook.

## How AI surfaces find local businesses

AI search systems build local answers from multiple sources simultaneously:
- **Google AI Overviews / Gemini:** website content, Google Business Profile (categories, services, reviews, posts, Q&A), Maps data, structured data, third-party reviews.
- **ChatGPT (SearchGPT):** website content (58% of local recommendations), directory listings (15%), review sites, news, social media. Uses OAI-SearchBot and GPTBot crawlers.
- **Perplexity:** strongly favours fresh content (published within 3 months), community content (Reddit, forums), and pages with specific data points and clear source attribution.
- **Claude:** training data plus web search results. Entity presence across authoritative sources matters.

## Crawler access

Allow these crawlers in `robots.txt`:
- `GPTBot` and `OAI-SearchBot` (OpenAI / ChatGPT)
- `ClaudeBot` (Anthropic / Claude)
- `PerplexityBot` (Perplexity)
- `Google-Extended` (Gemini, though separate from Googlebot)

Blocking them reduces AI visibility without meaningful content protection — the same information is available from cached copies, directories and other sources.

## Content structure that AI systems extract

### Answer-first pattern
Open each section with a direct 1-2 sentence answer to the question the heading asks. AI systems preferentially extract the first complete statement after a heading.

**Weak:** "There are many factors that determine how long a claim takes, and it depends on the circumstances..."
**Strong:** "Most housing disrepair claims settle in 3-6 months. Complex cases involving court proceedings can take 9-12 months."

### Fact density
Pages that AI systems cite tend to have a high density of extractable facts: specific numbers, timescales, legal references, named entities and statistics. Aim for at least 3 extractable facts per major section.

### Tables and comparisons
AI Overviews preferentially pull structured comparisons: timelines, process steps, compensation ranges, feature comparisons. If information can be presented as a table, present it as a table.

### Question headings
H2 and H3 headings should match real search queries — check "People Also Ask", autocomplete and Search Console queries. AI systems use heading text to determine what a section answers.

### FAQ sections
Every service and location page should have 4-6 FAQs with `FAQPage` schema. Questions should be the exact phrasing real people use. Answers should be self-contained — they need to make sense extracted from the page.

## Entity building for AI

AI systems connect entities across sources. The stronger and more consistent the entity signal, the more likely the business appears in AI answers.

### Structured data
- `Organization` or `LegalService` with complete details: name, URL, telephone, address, geo, openingHours, areaServed
- `sameAs` array listing all verified profile URLs: GBP, LinkedIn, Facebook, Law Society, SRA register, Trustpilot
- `Person` schema for named professionals with `sameAs` to their professional register entries
- All structured data must match visible page content exactly

### Cross-platform consistency
The business must appear with identical details across: website, GBP, social profiles, directories, professional registers. AI systems use cross-source consistency as a trust signal.

### Authoritative mentions
AI training data and retrieval systems weight mentions on authoritative sources: Wikipedia, Wikidata, professional body registers (SRA, Law Society), news sites, legal publications, government housing sites. Even mentions without links contribute to entity recognition.

## Google Business Profile for AI grounding

Google AI Overviews and Gemini ground local answers from GBP data. Completeness matters:
- **Categories:** primary must be the most specific match; add all relevant secondaries
- **Services:** list every service offered with descriptions
- **Reviews:** AI Overviews synthesise sentiment from reviews — review content quality matters, not just ratings
- **Posts:** recent posts signal an active business and provide fresh content for AI grounding
- **Q&A:** seed with real frequently asked questions and thorough answers
- **Photos:** real photos of premises, team and work signal a genuine business

## Monitoring AI visibility

### Query testing
For the top 10-20 target queries, regularly check:
1. Google AI Overview — is the business mentioned or cited?
2. ChatGPT — ask the query; is the business recommended?
3. Perplexity — search the query; is the business in the sources?

Record: date, query, AI surface, business mentioned (yes/no), what was said, sources cited, competitors mentioned.

### Freshness
AI systems favour recent content. Update `dateModified` in Article schema when refreshing content. Publish new content regularly — Perplexity in particular weights recency heavily.

## Things to avoid
- Blocking AI crawlers without a clear business reason.
- Thin pages that add no extractable facts.
- Generic content that could apply to any business — AI systems prefer specific, attributable claims.
- Over-optimising for one AI surface at the expense of others — the fundamentals (clear answers, structured data, entity consistency) work across all of them.
