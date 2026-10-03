# Add a project to the SEO pack

The pack lives once, here in this repo. Projects do not each carry a copy. A project is connected by
one entry in `sites.json` plus three one-time steps on the project itself. Total time: about 15 minutes.

## How the pieces fit
```
 project repo (website)            seo-autopilot (runs in GitHub Actions)          portal
 ----------------------            --------------------------------------------------         ------
 sitemap.xml  <------ reads ------ daily.mjs  -> Search Console + URL Inspection  --sync--> Supabase os_seo_* --read--> /seo screens
 <key>.txt    <------ checks ----- indexnow.mjs -> Bing/Yandex/Seznam/Naver
 content/code <--- edits (only after approval) --- agent chain (playbook) <--- Approve button <--- proposals
```
Research, decisions and publishing all happen from here. The project only needs to be a git repo with a
sitemap, a build command and a way to deploy on push.

## Steps for each new project
1. **Search Console.** Add the property (Domain or URL prefix), verify it, then add the service-account
   email as a user (Full for inspection; Restricted works for reports). The email is the `client_email`
   inside the key file. Never put the key file in any repo.
2. **Sitemap.** The site must serve `/sitemap.xml` (full URLs in `<loc>`). Submit it in Search Console.
3. **IndexNow key.** Choose a key (8 to 128 letters, digits, dashes, ideally random). Add
   `public/<key>.txt` (or your static folder) containing only the key, deploy, and confirm
   `https://<domain>/<key>.txt` returns the key. Set an environment variable on your computer, for example
   `INDEXNOW_KEY_MYSITE=<key>`.
4. **Register the site** in `sites.json`:
   ```json
   {
     "id": "mysite", "name": "My Site", "url": "https://mysite.com/",
     "searchConsoleProperty": "https://mysite.com/",
     "sitemap": "https://mysite.com/sitemap.xml",
     "repoPath": "/path/to/mysite",
     "indexNowKeyEnv": "INDEXNOW_KEY_MYSITE",
     "ga4PropertyId": null
   }
   ```
   For a Domain property use `sc-domain:mysite.com` as `searchConsoleProperty`.
5. **Test.** `GOOGLE_KEY_FILE=<key path> node daily.mjs mysite` then
   `INDEXNOW_KEY_MYSITE=<key> node indexnow.mjs mysite --dry`.
6. **Add the site to the portal** (a row in `os_seo_sites`) once the sync script exists.

## Per-project file (optional but recommended)
Add a short `SEO.md` to the project root so any agent knows the conventions before editing:
```
# SEO conventions
- Content lives in: <paths>
- One primary keyword per page; titles under 60 chars, descriptions under 155.
- Build: <command>. Link check: <command>. Deploy: push to main.
- Never invent clients, stats, prices or guarantees.
- Pages not to touch: <list>
```

## Scheduling
One scheduled Claude Code task per day runs, for every site in `sites.json`: `daily.mjs`, `indexnow.mjs`,
then the proposal step. It runs on this computer under the Claude subscription, so the machine must be on.
Edits to a project happen only after Approve, and only inside that project's `repoPath`.

## What cannot be automated
- Google "Request indexing": manual in Search Console, about 10 a day per site. The Indexing API is not
  for ordinary pages.
- Anything that needs a login the service account lacks (GA4 needs the Analytics APIs enabled in the
  Google Cloud project and Viewer access on each property).

## Reuse in other tools
The scripts have no dependencies beyond Node 18. To use them from a project that wants its own copy,
copy `daily.mjs`, `indexnow.mjs` and `lib/` and point `sites.json` at that one site. Prefer the central
copy so improvements reach every project.
