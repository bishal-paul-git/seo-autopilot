# Troubleshooting

Start with `npx github:bishal-paul-git/seo-autopilot#v2 doctor`. It checks the config, Google access, the sitemap, your content, workflows, secrets and variables, and says what to fix.

## A workflow shows green but nothing happened
Optional steps use `continue-on-error`, so a failing step does not fail the run. Open the run, expand the step and read its log. The reports are also saved to the `seo-data` branch.

## Google and Search Console
| Symptom | Likely cause and fix |
|---|---|
| `Google token error` | `GOOGLE_KEY_JSON` is missing, truncated or not the full JSON. Paste the whole file contents into the secret. |
| `Search Console: User does not have sufficient permission` | Add the service account's email (the `client_email` in the key) as a user on the property in Search Console. |
| `property not found` | `searchConsoleProperty` must match exactly: `https://example.com/` for a URL-prefix property, `sc-domain:example.com` for a domain property. |
| Very few queries | A new site has little data. Rankings and percentages are noisy under about 1,000 impressions a month. |
| GA4 says "Not connected" | Set `ga4PropertyId` to the numeric Property ID, give the service account Viewer on the property, and enable the Google Analytics Data API in the same Google Cloud project. |

## Drafting and approvals
| Symptom | Likely cause and fix |
|---|---|
| Approving a topic does nothing | The drafting secret (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) is missing, or the Claude GitHub app is not installed on the repository. Check `doctor`. |
| The pull request opens but `seo-check` never runs | Pull requests opened with the default `GITHUB_TOKEN` do not start other workflows. The drafting action opens them through the Claude GitHub app, so make sure the app is installed. |
| `seo-check` fails at `npm ci` (lockfile does not satisfy package.json) | Usually the lockfile was written by a different npm version than the runner uses. The check now falls back to `npm install` and warns. Regenerate the lockfile with `npm install` and commit it when convenient. |
| Auto-merge does nothing | `SEO_AUTOMERGE` is not `true`, `seo-check` has not passed on the latest commit, a changed file is outside your content folders, or (with `SEO_REQUIRE_REVIEW`) the reviewer has not added `seo-review-passed`. The run log says which. |
| The reviewer never runs | `SEO_REVIEW` must be `true`, and the branch must be `seo/*` in the same repository. |

## Jobs
| Symptom | Likely cause and fix |
|---|---|
| `speed`: quota exceeded | Google's shared anonymous quota is used up. Create a free PageSpeed Insights API key and save it as `PAGESPEED_API_KEY`. |
| `audit` finds almost nothing, or pages look empty | It reads the HTML the server sends. A JavaScript-only site returns a near-empty shell; prerender or server-render the content. |
| `geo`: "allowed with some paths blocked" | Your `*` rules block some paths (an admin area, for example). That is normal and is not a block on AI crawlers. |
| A new job is not running | The workflow predates the job. Run `upgrade` to add it. |
| `state restore` finds nothing | The first daily run creates the `seo-data` branch. Run `seo-daily` once. |

## Still stuck
Open an issue with the version, the job and the error lines (remove anything private): [bug report](https://github.com/bishal-paul-git/seo-autopilot/issues/new?template=bug_report.yml).
