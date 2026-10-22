# Verticals (local, e-commerce)

Specialist rules for local businesses and online shops.

- **Reads:** Site profile signals (LocalBusiness, Product), owner facts, product data.
- **Produces:** Location, listing and product-page fixes or advice.
- **Rule:** Doorway location pages and fake reviews are never acceptable; Quality checks them.

## Agents
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-ecommerce](agents/seo-ecommerce.md) | Category, product and faceted-navigation pages, product markup, stock handling | on request | templates, on a branch (edit mode) |
| [seo-local-agent](agents/seo-local-agent.md) | Business profile, listings consistency, local markup and location pages | on request | yes, on a branch |
| [seo-local-gbp-optimizer](agents/seo-local-gbp-optimizer.md) | Google Business Profile completeness, categories, posts, Q&A, photo audit | on request | no (produces action plan) |
| [seo-local-citation-auditor](agents/seo-local-citation-auditor.md) | NAP consistency across directories, citation gaps, data aggregators | on request | no (produces fix list) |
| [seo-local-content-writer](agents/seo-local-content-writer.md) | Location pages, local blog content, internal linking, AI-extractable content | on request | yes, on a branch |
| [seo-local-ai-visibility](agents/seo-local-ai-visibility.md) | AI Overview, ChatGPT, Perplexity optimisation, entity building, GEO | on request | yes, on a branch |
| [seo-local-review-manager](agents/seo-local-review-manager.md) | Review acquisition strategy, response templates, competitor benchmarking | on request | no (produces templates) |

## Hand-offs
Work arrives from Command (the agent plan or a person) and leaves through Quality before a person approves it. Each agent's **Output** section says exactly what it hands on and to whom. See the [org chart](../README.md).
