# Security

- **Keys:** Google service-account keys belong in GitHub secrets (`GOOGLE_KEY_JSON`) or a file outside your repository. The scaffolded `.gitignore` blocks common key file names. Rotate a key from the Google Cloud console if it leaks.
- **Prompt injection:** search queries, feed items and page text are public and untrusted. They are sanitised and passed to AI only as data; the implementer workflow tells Claude to ignore instructions found in them and limits its tools and branch.
- **Least privilege:** the Google account is read-only. The implementer cannot push to your main branch. Backlink submissions are dry runs until you set `BACKLINKS_LIVE=true`, and the tool never solves CAPTCHAs, creates accounts or pays.
- **Optional automation is off by default:** auto-merge (`SEO_AUTOMERGE`), the reviewer agent (`SEO_REVIEW`) and real backlink submissions (`BACKLINKS_LIVE`) are repository variables you must set. Auto-merge only merges `seo/*` branches from your own repository, after your build passes, and only when every changed file is inside your content folders.
- **Workflow safety is tested:** the templates are checked on every change for pinned third-party actions, explicit permissions, no `pull_request_target` and no untrusted text in shell scripts.
- **Versions:** follow `#v2` for the newest release, `#v2-stable` for a release that has had time to prove itself, or an exact version tag to never change. See docs/upgrading.md.
- **Reporting a vulnerability:** open a private security advisory on this repository (Security tab > Report a vulnerability). Please do not post details in a public issue.
