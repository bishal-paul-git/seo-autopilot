# Client portal designs ("Style A")

Reference designs for `cloud/portal/app/index.html`, chosen by the owner on 2026-11-03. They are static mockups with sample data (names and numbers are invented for the mockup and are not real clients). Open any file in a browser; each one is self-contained apart from Google Fonts.

**Look:** midnight navy shell `#0b1437`, indigo actions `#4f46e5`, cool grey page `#f4f6fb`, white cards, Geist. Green, amber and red are only for status. On a client link the agency's brand colour replaces the indigo.

| File | Screen | In the portal today |
|---|---|---|
| `Main.dc.html` | Portfolio (agency home) | Built: `#/` (totals, needs attention, next daily run, websites table) |
| `Sites.dc.html` | Websites list with filters | Partly: the Portfolio table, with client-link counts; filters and pagination not built |
| `AddSite.dc.html` | Connect a website, 3 steps | Built: `#/add` and the Connection page show the stepper |
| `SiteOverview.dc.html` | One website's overview | Built: `#/s/<id>/overview` (restyled) |
| `ClientAccess.dc.html` | Client links for one website | Built: `#/s/<id>/access` (list, label, copy, revoke, what the client sees). The email invite card is not built |
| `ClientView.dc.html`, `MClient.dc.html` | What the client sees | Built: `#/c/<token>/…` (restyled, brand colour) |
| `Approvals.dc.html`, `MApprovals.dc.html` | Approvals across all websites | Built: `#/approvals`, plus the per-site page |
| `Team.dc.html` | Team and brand | Built: `#/team` (restyled) |
| `MPortfolio.dc.html`, `MSites.dc.html`, `MSite.dc.html`, `MShare.dc.html` | Phone layouts | Built: cards, an agency tab bar, and client access as a normal page rather than a sheet |
| `StyleMidnight.dc.html` | The style sample the owner picked | Reference |

**Not built:** inviting a client by email. It needs an email provider and a decision on whether clients get accounts. Today a client gets a no-login link, which can now be listed and revoked.
