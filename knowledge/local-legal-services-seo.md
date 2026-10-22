# Local legal services SEO

Industry-specific playbook for solicitor firms, claims companies and legal service providers. Builds on `local-seo.md` and `local-seo-ai-visibility.md`.

## Legal service categories and schema

### Google Business Profile
- **Primary category:** "Solicitor" (most specific) or "Legal services" (if multi-practice)
- **Secondary categories:** add practice-specific ones where available — "Housing authority", "Legal aid office" if applicable
- **Services:** list every practice area as a separate service with a plain-language description

### Structured data
Use `LegalService` (not `Attorney` — deprecated). Required properties:
- `name`, `url`, `telephone`, `address`, `geo`
- `openingHoursSpecification`
- `areaServed` (list every genuinely served area as `City` or `AdministrativeArea`)
- `priceRange` (e.g. "No Win No Fee" or "Free initial consultation")
- `sameAs` links to: SRA register, Law Society Find a Solicitor, LinkedIn, GBP, Trustpilot

Add `Person` schema for named solicitors with `sameAs` to their SRA individual record.

## UK legal-specific directories

### Priority tier (register first)
1. **Law Society Find a Solicitor** — SRA-regulated firms are automatically listed; ensure details are correct
2. **SRA register** — verify details match website exactly
3. **Solicitors.com** — free listing with practice area filtering
4. **Solicitors.Guru** — growing UK legal directory
5. **Legal 500** — if applicable (ranked firms)

### General directories
6. Google Business Profile (essential)
7. Yell.com
8. Bing Places
9. Apple Business Connect
10. Trustpilot (UK consumers check this)
11. Reviews.io (UK-focused)
12. FreeIndex

### Aggregators
- Central Index (UK data aggregator — feeds downstream directories)

## Content strategy for legal services

### Service pages
Each practice area needs its own page with:
- Clear explanation of the legal right (e.g. Section 11 Landlord and Tenant Act 1985)
- The process: what happens at each stage, with timescales
- Compensation: realistic ranges with caveats, not guarantees
- Evidence: what the client needs to gather
- FAQs from real client questions (4-6 per page, with `FAQPage` schema)

### Location pages
Each served area needs genuinely local content:
- Name of the local authority / housing provider
- Local housing statistics if available (council housing stock, disrepair complaint volumes)
- Area-specific detail a resident would recognise
- Local landmarks or context (not just a swapped town name)
- Links to relevant service pages and blog posts

### Blog content pillars
1. **Legal guides:** explain laws and regulations in plain English (Section 11, Awaab's Law, Pre-Action Protocol)
2. **Tenant rights:** "what to do when..." practical advice articles
3. **Claims process:** timelines, what to expect, evidence guides
4. **Local guides:** borough or city-specific housing information
5. **Seasonal:** heating rights before winter, garden/structural issues before summer
6. **Law updates:** new regulations, court decisions, government announcements

### E-E-A-T for legal content
- **Named solicitor author** on every substantive page with qualifications and SRA number
- **"Last reviewed" date** updated when content is checked
- **Citations** to legislation, case law and official guidance (not just other blog posts)
- **No guarantees:** say "you may be entitled to" not "you will receive"
- **SRA compliance:** all content must comply with SRA advertising rules — no misleading claims about outcomes

## Regulatory constraints

### SRA Standards and Regulations
- Do not make claims about outcomes that cannot be substantiated
- Do not use client testimonials that could be misleading
- Fee information must be clear and accurate
- "No Win No Fee" must be explained accurately (success fee, disbursements)
- Advertising must not be misleading about the nature of the firm or its services

### Review policies
- Never offer incentives for reviews
- Never gate reviews (only asking satisfied clients)
- Never write or commission fake reviews
- Respond to negative reviews professionally without revealing client details
- If a review contains confidential information, request removal through the platform

## Link building for legal services

### High-value sources
1. **Legal publications:** Law Society Gazette, Legal Futures, The Lawyer, local law journals
2. **Journalist requests:** Featured (formerly HARO), ResponseSource — comment on housing news, tenant rights stories, legal changes
3. **Local press:** press releases for significant case outcomes (anonymised), commentary on local housing issues
4. **Housing charities:** partnerships, sponsorships, legal advice volunteering (Shelter, Citizens Advice)
5. **Local government:** if the firm advises at council surgeries or housing clinics
6. **Chamber of Commerce:** local business network membership
7. **University partnerships:** housing law clinics, student advice services

### Content-led links
- Publish original data (e.g. FOI requests on local disrepair complaints)
- Create tools (compensation calculators, eligibility checkers)
- Write definitive guides that journalists and other sites link to as references

## Measuring success

### Primary metrics
- Local pack appearances (Search Console → search appearance → map)
- Calls and form submissions from organic search (GA4 events)
- GBP insights: profile views, calls, direction requests, website clicks
- Review count, rating and velocity
- Blog traffic and keyword rankings for target queries

### Secondary metrics
- Citation consistency score (track quarterly)
- AI visibility (quarterly manual checks across ChatGPT, Perplexity, Google AI Overview)
- Referring domains from legal and local sources
- Indexed page count in Search Console
