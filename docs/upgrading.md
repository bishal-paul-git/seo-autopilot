# Upgrading

`init` copies the GitHub workflows into your repository. Those copies do not change by themselves, so a project set up on an older version keeps its old workflows even though the job code they call (`npx ...#v2`) is newer. New jobs (for example `geo`, `speed`, `refresh`) will not run until the workflows are updated. `upgrade` does that safely.

## The three steps

```bash
# 1. See what is missing or different. Changes nothing.
npx github:bishal-paul-git/seo-autopilot#v2 upgrade

# 2. Add missing workflows and refresh the playbooks and agents (your existing workflow edits are kept).
npx github:bishal-paul-git/seo-autopilot#v2 upgrade --apply

# 3. Review and commit.
git diff
```

- `--diff` lists the lines that differ for each changed workflow, so you can copy the new parts into your customised file.
- `--force` replaces workflow files that differ with the current templates. Commit first so `git diff` shows exactly what changed.
- `doctor` also tells you when workflows are missing or out of date.

## Which version do I follow?

The workflows contain a line like `SEO: "github:bishal-paul-git/seo-autopilot#v2"`. `upgrade` keeps whatever you have there.

| Tag | Meaning | Use it when |
|---|---|---|
| `#v2` | newest 2.x release | you want fixes and features as soon as they ship |
| `#v2-stable` | a 2.x release that has had a few days without problems | you want fewer surprises |
| `#v2.7.0` (an exact version) | never changes | you want to control upgrades yourself |

Each release is listed on the [Releases page](https://github.com/bishal-paul-git/seo-autopilot/releases) with its changelog entry. To move to a new version, change the tag in the `SEO:` line of each workflow (or use `upgrade --force` after editing the tag in one file), then run `upgrade`.

## After upgrading
- New optional features stay off until you switch them on (`SEO_AUTOMERGE`, `SEO_REVIEW`, `BACKLINKS_LIVE` are repository variables; the speed job uses an optional `PAGESPEED_API_KEY` secret).
- Run `doctor` to check secrets and variables, then start the daily workflow once by hand.
- Saved reports live on the `seo-data` branch and carry over untouched.
