# Decisions

## 2026-10-18 Business model: open core, service first (proposed, owner to confirm)
Keep the engine MIT; sell hosting, multi-client operations, approvals, scheduled runs, reporting and support; start with a done-for-you service through Erudience to validate demand. Alternatives and risks: `docs/strategy.md`. Consistent with the agency-first hypothesis in `SEO-PRODUCT-BUILD-BRIEF.md`, which also says prices are unvalidated.

## 2026-10-18 Roadmap relationship to the product brief
`SEO-PRODUCT-BUILD-BRIEF.md` is the owner's plan for the hosted product and takes precedence where they overlap. Roadmap briefs 05 (dashboard), 06 (CMS connectors) and 07 (hosted cloud) are superseded by its phases 1 to 4 and must be planned through its Phase 0 reuse audit first. Briefs 01, 02, 03, 04, 08 and 09 do not depend on that decision and can proceed. Note the product brief's rule: platform detection is not a working publishing integration; start with one GitHub-backed publishing path.

## 2026-10-12 to 2026-10-17 Engine decisions (already implemented)
- Dependency-free Node core; Go and Python engines optional.
- Agents are Markdown definitions; the `team` job routes deterministically from reports; a human approves what goes live.
- Site profile decides edit vs advise mode; agents never edit when the source is not in the repository.
- Users bring their own Google and AI accounts; no maintainer keys.
