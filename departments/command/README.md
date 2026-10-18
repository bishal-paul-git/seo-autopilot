# Command

Plans, sequences and reports. Decides what the team works on this week and whether past work helped.

- **Reads:** Saved reports from every job, `agent-plan.md`, the site profile.
- **Produces:** A ranked plan, briefed work for other departments, the weekly and monthly report.
- **Rule:** Never ships anything itself. The coordinator hands work to one owner per problem and sends every change through Quality.

## Agents
| Agent | Job | Runs | Can change files? |
|---|---|---|---|
| [seo-coordinator](agents/seo-coordinator.md) | Reads the site profile and the agent plan, calls the right specialist in the right order, checks what comes back | on request, weekly | no |
| [seo-onboarder](agents/seo-onboarder.md) | Profiles the platform, decides edit or advise mode, confirms the business facts, fills in Project rules | first, on any new site | config and Project rules only |
| [seo-reporter](agents/seo-reporter.md) | Writes the plain-English report and judges whether past changes worked | on request, weekly or monthly | no |
| [seo-strategist](agents/seo-strategist.md) | Turns the data into a short, ranked plan: what to do this week and why | on request, weekly digest | no |

## Hand-offs
Work arrives from Command (the agent plan or a person) and leaves through Quality before a person approves it. Each agent's **Output** section says exactly what it hands on and to whom. See the [org chart](../README.md).
