# Product and business strategy

Where seo-autopilot can go from here, written for the owner and for any session planning work. It is an analysis with a recommendation, not a promise of revenue.

## What exists
An open-source SEO engine: 57 registered jobs, 38 agent definitions, 30 knowledge documents, a landing site, and real production use on the maintainers' own sites. It runs in the user's own GitHub repository with the user's own Google and AI accounts. That design is a strength (no data leaves the user's control, no per-user running cost for us) and the main barrier to growth (the user must be comfortable with GitHub, secrets and a command line).

## Who would use it
1. **Developers and technical founders** with a site in a repository (frameworks, static generators). Can use today. Small willingness to pay; they value open source.
2. **Agencies and freelancers** managing many client sites. Strong need for multi-site views, reporting, approvals and white-label. Highest willingness to pay.
3. **Non-technical site owners** (WordPress, Shopify, Wix, Squarespace). The biggest market, and unreachable without a hosted product and CMS connectors.

## Options

| Route | What it is | Upside | Downside |
|---|---|---|---|
| Pure open source | MIT, community, no revenue | Trust, adoption, contributions, credibility for the maintainers' other work | No income; support burden grows with users |
| **Open core + hosted cloud** | Core stays MIT. A paid hosted version adds a GitHub App (no setup), dashboard, multi-site, approvals inbox, scheduled runs, reports, CMS connectors, support | Recurring revenue; reaches non-technical users; the free core drives awareness | Needs a real web product, billing, support, security work; costs of running jobs unless users bring keys |
| Agency white-label | Cloud for agencies: many sites, client reports with their branding | Highest price per customer; fewer customers needed | Long sales cycles; needs reporting and permissions features |
| Done-for-you service | The maintainers (or partners) run it for clients as a monthly SEO service | Revenue immediately; funds the product; case studies | Not scalable; outcomes are uncertain, so never promise rankings |
| Marketplace apps | GitHub Marketplace Action, Claude plugin, WordPress plugin, Shopify app | Distribution to people already looking | Review processes; each platform is its own build |
| Closed source or one-off sale | Stop publishing, sell licences | None that open core lacks | Loses trust and distribution; SEO buyers distrust black boxes |

## Recommendation
**Open core, with a done-for-you service as the first revenue.**

1. **Keep the core MIT.** Trust and distribution are the moat in SEO tooling; the agents, playbooks and honest-reporting stance are the differentiator, and are easier to believe when readable.
2. **Sell what the core cannot give a non-technical or busy buyer:** a hosted version (no GitHub setup), multi-site dashboard and approvals, scheduled runs and reports, connectors that apply approved changes to WordPress and Shopify through their APIs, and support. Users bring their own AI login or key, so our running cost stays low.
3. **Start with the service, not the SaaS.** Offer "SEO autopilot, run for you" to a few clients through the maintainers' own company. It pays for development, produces real before and after data and case studies, and shows which features customers actually ask for. Price on effort and deliverables, not on rankings.
4. **Target agencies first for the paid cloud.** One agency with 20 sites is worth more than 20 individual owners, and its needs (multi-site, reporting, approvals) are the ones the product already half-has.
5. **Add distribution cheaply:** publish to npm, a GitHub Marketplace Action, a short docs and demo site, and a public case study (a real site, with real numbers once there are enough to mean something).

## Why not the alternatives first
- A full SaaS before validation is months of work with no proof of demand. The service and the waitlist test demand first.
- Closing the source removes the thing that makes people try it.
- Plugins for every CMS at once spreads effort thin; pick one (WordPress has the largest audience) after the cloud exists.

## Risks to manage
- **Outcome risk:** SEO results are slow and uncertain. Sell process and transparency, never rankings. The product already reports uncertainty and small-data caveats; keep that.
- **Platform risk:** Search Console, Google and AI provider terms and APIs change. Keep providers pluggable and say what is verified.
- **Safety and liability:** agents that edit sites need approval gates, audit logs and rollback. The product promise is now "nothing goes live unchecked" (D17): routine changes publish after automated checks, with limits, a kill switch and undo; high-risk changes wait for a person.
- **Cost of AI runs:** keep bring-your-own-key as the default; offer metered or bundled usage only with clear limits.
- **Support load:** invest in `doctor`, `upgrade` and docs before growing users.

## Suggested sequence
1. **Weeks 1 to 4:** finish the roadmap items marked "foundation" (`docs/roadmap/`), publish to npm, build the docs and demo site, write the first case study as data accumulates, open a waitlist for the cloud, offer the done-for-you service to a small number of clients.
2. **Months 2 to 3:** build the cloud MVP for repository-based sites (GitHub App, dashboard, approvals inbox, Stripe billing). Onboard a handful of agencies as design partners.
3. **Months 4 to 6:** WordPress connector (REST API, approval gate), client reports with white-label, agent evaluations as a public benchmark. Then decide on Shopify and others from demand.

Measure each stage by paying users and retained sites, not by stars or downloads.
