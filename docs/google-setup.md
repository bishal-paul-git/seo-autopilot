# Connect Google: Search Console and Analytics

## What the connection is

You create a **service account**: a robot Google identity with an email address like `seo-autopilot@your-project.iam.gserviceaccount.com`. You then add that email as a **user** on your Search Console property (and, for traffic numbers, on your GA4 property). From then on the autopilot signs in as that robot, in the cloud, with a JSON key you store as a GitHub secret. No personal Google login is ever used, and the robot is **read-only** here.

## What it can do

| Google product | What the autopilot reads | Used for |
|---|---|---|
| Search Console: Search Analytics | clicks, impressions, position, per query and per page | daily report, keyword research, weekly digest |
| Search Console: URL Inspection | whether each URL is indexed, last crawl, canonical | index status, the "request indexing" list |
| Google Analytics 4: Data API (optional) | sessions and users | the "Analytics" line in the weekly digest |

## What it cannot do

- It cannot press **Request indexing** (Google only allows that by hand for ordinary pages).
- It cannot change anything in Search Console or Analytics. It has read-only access.
- It does not need, and never uses, your own Google password.

## Steps

### A. Create the service account (once, can serve many sites)

1. Open the [Google Cloud console](https://console.cloud.google.com/) and create or choose a project.
2. **APIs & Services > Library**: enable **Google Search Console API**. For traffic data also enable **Google Analytics Data API**.
3. **IAM & Admin > Service Accounts > Create service account**. Name it `seo-autopilot`. No roles are needed.
4. Open the account > **Keys > Add key > Create new key > JSON**. A file downloads. This is the secret key.
5. Note the account's **email address** (also inside the file as `client_email`).

### B. Give it access to your site

1. [Search Console](https://search.google.com/search-console) > your property > **Settings > Users and permissions > Add user**. Paste the service-account email. Permission **Restricted** is enough for reports; **Full** is needed for URL Inspection. Choose Full.
2. For a *Domain* property use `sc-domain:example.com` as `searchConsoleProperty` in the config; for a URL-prefix property use the exact URL with the trailing slash.
3. **GA4 (optional):** Analytics > Admin > Property access management > add the same email as **Viewer**. Copy the numeric **Property ID** (Admin > Property details) into `ga4PropertyId` in the config.

### C. Store the key

- In GitHub: **Settings > Secrets and variables > Actions > New repository secret** named `GOOGLE_KEY_JSON`, value = the **entire contents** of the JSON file.
- Then delete the downloaded file, or keep it **outside any repository**. Never commit it. The repo `.gitignore` created by `init` already blocks `*service-account*.json`.
- To test from your computer: `GOOGLE_KEY_FILE=/path/outside/repo/key.json npx seo-autopilot doctor`.

## Forgot what you set up?

- The service-account email is in the Google Cloud console under **IAM & Admin > Service Accounts**.
- Where it has access: Search Console > Settings > **Users and permissions**; Analytics > Admin > **Property access management**.
- Whether the key works: run `seo-autopilot doctor`. It signs in and queries Search Console, and names the problem if access is missing.
- If the GA4 line in the digest says "Unavailable": the Analytics Data API is not enabled in the Cloud project, or the account is not a Viewer on the property.

## Security

The key can read your search data. Treat it like a password: keep it only in GitHub secrets, rotate it from the Cloud console if it ever leaks, and never paste it into an issue, a workflow file or a chat.
