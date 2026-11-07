# Release checklist

Use for every engine release and every production change to the portal. Tick each line in the PR description.

## Engine release (vX.Y.Z)
- [ ] `npm test` green on the release commit (also on CI: Node 20 and 22, Go, Python)
- [ ] `node scripts/build-registry.mjs` leaves no diff
- [ ] `CHANGELOG.md` has `## X.Y.Z` on top; `package.json` version matches
- [ ] `node scripts/build-site.mjs` regenerated `site/`
- [ ] Docs match the code: `docs/jobs.md`, `docs/registry.md`, `docs/deployment-status.md`
- [ ] Merged by the owner; tags through Actions > tag-release (`v2`, `v2-stable` moved only for a stable release)
- [ ] One real site upgraded (`seo-autopilot upgrade --diff`, then `--apply`) and its next scheduled run checked green

## Portal or Supabase change
- [ ] Migration reviewed for RLS, `security definer` checks, grants and revokes
- [ ] `bash cloud/portal/supabase/test/run.sh` green, with a new check for the change
- [ ] Owner go-ahead recorded; migration applied; `supabase_migrations` shows it
- [ ] Functions redeployed from a pinned commit; smoke test (403 without credentials, one real call)
- [ ] Portal page rebuilt with the anon key only (`grep -c service_role dist/index.html` is 0) and published; Hostinger build completed
- [ ] Rollback written down before applying (see [deployment-status.md](deployment-status.md))
- [ ] `docs/deployment-status.md` and `docs/implementation/STATUS.md` updated with versions and evidence
