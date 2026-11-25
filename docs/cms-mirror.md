# CMS mirror (EmDash)

Some sites keep their posts in a CMS database instead of files in git. The `markdown` adapter and the pull-request flow (review, the content-loss guard, `git revert`) need files. The CMS mirror bridges the two: each post is kept as one Markdown file in a git repository, a pull request changes the file, and merging publishes it through the CMS API. The CMS stays the place the site reads from.

Supported CMS: [EmDash](https://github.com/emdash-cms/emdash) 0.1.0 (REST content API, Portable Text bodies). Code: `src/cms/` (client `emdash.mjs`, converter `portable-text.mjs`, file format and checks `mirror.mjs`, commands `commands.mjs`). No dependencies.

## File format

`<dir>/<slug>.md`, flat front matter with JSON values (strings in double quotes, `null`, `true`/`false`, `["a","b"]`), then the body in Markdown.

| Key | Editable | Notes |
|---|---|---|
| `id` | no | CMS id. Empty for a post that does not exist yet. |
| `slug` | new posts only | Never changed for an existing post: a URL change needs a person and a redirect. New slugs must match `--slug-pattern` (default lowercase Latin, digits and hyphens), because the CMS keeps explicit slugs as given and its automatic slug drops non-Latin letters. |
| `title`, `excerpt` | yes | Title up to 200 characters. |
| `seoTitle`, `seoDescription`, `seoImage`, `canonical`, `noIndex` | yes | Sent to the CMS only at publish (they go live at once on any write). `canonical` must be an http(s) URL. |
| `status`, `publishedAt`, `categories`, `tags`, `image`, `imageAlt`, `byline`, `locale` | no | Read-only copies of the CMS, for review and for the content-loss guard. |
| `baseRev` | no | The CMS revision token at the last export or publish. Informational: conflicts are found by comparing content (below). |

Body: headings, paragraphs, bold, italic, inline code, strike-through, links, bullet and numbered lists (two spaces per level), block quotes, fenced code, images, hard line breaks (`\` at the end of a line). Every block is checked on export: it is rendered, parsed back and compared. A block that would not come back identical (an empty paragraph, a custom block type, an unusual mark) is kept as one line of JSON, `<!--ec:block {...} -->`. Leave those lines alone or delete them whole; `validate` rejects a broken one.

## Commands

All print a JSON report on stdout. Connection: `EMDASH_URL` (or `--url`) and `EMDASH_TOKEN` (environment only). The token needs the `content:read` scope, and `content:write` for `draft`, `publish` and `preview-check`. https is required except for localhost.

| Command | What it does | Writes to the CMS |
|---|---|---|
| `cms export --dir posts [--sitemap /sitemap.xml] [--status published\|all]` | One file per post. A post whose body would not convert back unchanged is skipped and listed. Reports pending drafts, posts missing from the sitemap, and files for posts the CMS no longer lists (never deleted). | no |
| `cms validate --dir posts [--files a.md,b.md] [--base-ref origin/main]` | Checks the files (slug, file name, lengths, types, broken JSON blocks, empty body, duplicate ids and slugs). With a base: read-only keys and slugs of existing posts must not change; `noIndex` turned on and `canonical` changes are listed as high risk. No network. | no |
| `cms schema` | Can the token read the collection settings; are revisions and SEO on. | no |
| `cms preview-check --title "..." --slug throwaway-slug` | Creates one throwaway draft (or reuses it), proves that a draft save leaves the row alone (revisions), asks for a preview link and opens it, checks the public URL is 404, the draft is not in the sitemap or RSS, and a few published pages keep their status and word count. | one draft, never published |
| `cms draft --file posts/x.md --base-ref origin/main` | Saves the file as a draft revision and asks for a preview link. The live page does not change. | draft only |
| `cms publish --file posts/x.md --base-ref <commit before the change> [--write-back]` | Saves the draft, publishes it, sets the five SEO fields if they differ, then reads the post back and compares it with the file. `--write-back` refreshes `id`, `status`, `publishedAt` and `baseRev` in the file. | yes |

Common options: `--collection posts`, `--fields title=title,excerpt=excerpt,body=content,image=featured_image` (field names in the collection), `--url-pattern /posts/{slug}` (public URL of a post), `--taxonomies category,tag`, `--dry`.

Exit codes: 0 ok, 1 error or invalid files, 2 published but the CMS does not match the file afterwards, 3 refused for safety.

## Safety rules

- **Revisions must be proven before any write to a live post.** On a collection without revisions, EmDash 0.1.0 writes a draft save straight to the live post. `draft` and `publish` read the collection settings first; a content-only token cannot (403), so they refuse (exit 3) unless `--revisions-proven` or `EMDASH_REVISIONS_PROVEN=true` is set. Set it only after `preview-check` reported `"revisions": true` on that site.
- **Drift stops the write.** With `--base` or `--base-ref`, the live post must still match the previous version of the file. If someone edited the post in the CMS admin after the export, the write is refused: export again first. Re-running a publish that already landed is a no-op, not drift.
- **Someone else's unpublished draft stops the write.** Publishing would publish their draft too.
- **After a draft save**, the live post is read again: if it moved, the command stops with exit 2 and says so.
- **Revert = publish the previous file.** `git revert` the change, then `cms publish` with `--base-ref` set to the reverted commit. The revisions "restore" endpoint is never used (in 0.1.0 it writes the live row and skips the cache purge).
- **New posts** need an explicit slug. A re-run reuses the draft with that slug; a slug that belongs to a published post is refused.
- The token is never printed. Reports list each call as method, path and status only.

## In a pull-request workflow

1. A change to `posts/*.md` opens a pull request. CI runs `cms validate --files <changed> --base-ref origin/<default>` and the content-loss guard (below). Optional: `cms draft` per changed file and post the preview link in the pull request.
2. A person (or the autopilot policy, for routine changes) merges.
3. On the default branch, a job runs `cms publish --file <changed> --base-ref HEAD^1 --revisions-proven --write-back` per changed file and commits the write-back. High-risk changes (`noIndex`, `canonical`) and new posts should keep needing a person, as in decision D17.
4. To undo: revert the merge commit; the same job publishes the old file.

The content-loss guard (`src/analysis/content-loss.mjs`, `textFacts`) reads mirror files directly: ATX headings, `[text](url)` links, `![alt](src)` images and the front-matter `image`. Mirror files also expose the same facts through `fileFacts()` in `src/cms/mirror.mjs` (words, headings, links, images, opaque blocks) and `validate` reports `before.words` when given a base. Note: CMS media URLs such as `/_emdash/api/media/file/<key>` may have no file extension, so a guard that counts images by extension will not see them.

## Known limits

- Written against EmDash 0.1.0. Other versions are not tested.
- The preview link needs `EMDASH_PREVIEW_SECRET` set on the site. Without it `draft` reports `previewError: NOT_CONFIGURED` and `preview-check` reports the preview as not ok; everything else still works.
- EmDash 0.1.0's content loader (`getEmDashEntry`) does not read the SEO table, so a template that calls `getSeoMeta(entry)` falls back to the title and excerpt. SEO fields written by `publish` are stored and returned by the API, but such a template does not show them. Check the template before relying on `seoTitle` or `seoDescription`.
- `publishedAt`, bylines, featured images and taxonomy terms are read-only here; change them in the CMS admin and export again.
- Tested end to end against a local EmDash 0.1.0 with a local database (export, edit, draft, preview, publish, re-run, revert). Unit tests use an in-memory stand-in of the API.
