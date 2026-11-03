# Client portal designs ("Style A")

Reference designs for `cloud/portal/app/index.html`, chosen by the owner on 2026-11-03. They are static mockups with sample data (names and numbers are invented for the mockup and are not real clients). Open any file in a browser; each one is self-contained apart from Google Fonts.

**Look:** midnight navy shell `#0b1437`, indigo actions `#4f46e5`, cool grey page `#f4f6fb`, white cards, Geist. Green, amber and red are only for status. On a client link the agency's brand colour replaces the indigo.

| File | Screen | In the portal today |
|---|---|---|
| `Main.dc.html` | Portfolio (agency home) | Built: `#/` (totals, needs attention, next daily run, websites table) |
| `Sites.dc.html` | Websites list with filters | Partly: the Portfolio table; filters and pagination not built |
| `AddSite.dc.html` | Connect a website, 3 steps | Partly: `#/add` and the Connection page; the stepper is not built |
| `SiteOverview.dc.html` | One website's overview | Built: `#/s/<id>/overview` (restyled) |
| `ClientAccess.dc.html` | Client links for one website | Partly: "Client link" makes and copies a link; listing and revoking links needs a new RPC |
| `ClientView.dc.html`, `MClient.dc.html` | What the client sees | Built: `#/c/<token>/…` (restyled, brand colour) |
| `Approvals.dc.html`, `MApprovals.dc.html` | Approvals across all websites | Per website only (`#/s/<id>/approvals`); a cross-site page is not built |
| `Team.dc.html` | Team and brand | Built: `#/team` (restyled) |
| `MPortfolio.dc.html`, `MSites.dc.html`, `MSite.dc.html`, `MShare.dc.html` | Phone layouts | Built for Portfolio and site pages (cards, bottom tab bar); the share sheet is not built |
| `StyleMidnight.dc.html` | The style sample the owner picked | Reference |

**Proposed, not in the backend:** inviting a client by email (only share links and team invites exist), a list of a site's client links with revoke in the page (the `share_links` table has `revoked_at`, but no RPC lists links), and client-link counts on the Portfolio.
