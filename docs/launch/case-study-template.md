# Case study template (real numbers only)

Use this for the first public case study, Erudience, and for any later one. Every figure needs its source and its date range. If a number is not measured, leave the line out. Do not estimate.

## <Site name>: <N> weeks with seo-autopilot
- **Site:** <url>, <kind of business>, <platform>, about <pages from the sitemap> pages.
- **Period:** <start date> to <end date>. seo-autopilot version <x.y.z>. Autopilot <on or off>.

### Before and after (Google Search Console, same-length periods)
| Measure | Before (<dates>) | After (<dates>) | Source |
|---|---|---|---|
| Clicks | | | Search Console, Performance |
| Impressions | | | Search Console, Performance |
| Average position | | | Search Console, Performance |
| Indexed pages | | | Search Console, Pages, or the daily inspect report |
| Key events (conversions) | | | GA4 |

### What changed
List each change with its date and the pull request link. For example: titles rewritten, pages added, internal links, technical fixes. These come from the monthly report's autopilot ledger.

### What we can and cannot say
- Search results move for many reasons: algorithm updates, seasonality, competitors. Say which changes line up with which movements, and say plainly that this is not proof of cause.
- Name anything that went wrong, and what the watcher or a person undid.

### Reproduce it
The reports behind every number are on the site's `seo-data` branch at <commit>.
