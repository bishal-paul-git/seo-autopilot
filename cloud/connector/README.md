# Hosted connector (Claude, ChatGPT and other MCP clients)

This is a remote MCP server. People add its URL as a custom connector in Claude (claude.ai, the desktop app) or ChatGPT, sign in with GitHub, and then ask questions about their site's SEO reports, for example:
- "what changed in my rankings this week?"
- "which pages earn impressions but are weakly linked?"

It reads what the site's scheduled seo-autopilot workflows already save in the site's own repository: the `seo-data` branch, plus `seo-autopilot.config.json` on the default branch. Decision D20 in `docs/implementation/DECISIONS.md` explains the design.

**What it does and does not do**
- **Read-only.** The GitHub App asks only for *Contents: read* and *Metadata: read*. It cannot change a site, a repository or a setting, and it runs no jobs.
- **Only what the user allows.** It sees the repositories the user installed the app on, and serves only files listed under that site's report folder on the state branch.
- **The tools match the local `seo-autopilot mcp` server, minus `run_job`.** They are `list_sites`, `site_overview`, `list_reports`, `read_report`, `search_queries` and `page_report`, from the same code (`src/mcp/core.mjs`).
- **No dependencies.** It is a Cloudflare Worker built on Web APIs only, and it stores its OAuth records in one KV namespace.

## How sign-in works
The connector is its own OAuth 2.1 server, which is what MCP clients expect:
- metadata at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`;
- dynamic client registration at `/register`;
- PKCE (S256 only), single-use codes that last 5 minutes, access tokens that last an hour, and refresh tokens that rotate.

It hands the sign-in itself to GitHub:
1. Before going to GitHub, the connector shows its own consent page naming the app that asked. A cookie ties that page to the GitHub return, so another site cannot approve on the user's behalf.
2. The user's GitHub token is stored only encrypted (AES-GCM with `TOKEN_KEY`).
3. KV keeps only hashes of the connector's own tokens and codes.

## Set it up (about 15 minutes, once)
You need a Cloudflare account (the free plan is enough to start) and a GitHub account.

1. **Create the GitHub App:** GitHub → Settings → Developer settings → GitHub Apps → New GitHub App.
   - **Callback URL:** `https://<your worker>/callback`. The default worker address is `seo-autopilot-connector.<your-subdomain>.workers.dev`.
   - **Expire user authorization tokens:** leave it ticked. The connector renews tokens with GitHub's refresh token.
   - **Webhook:** untick *Active*.
   - **Repository permissions:** *Contents: Read-only*. *Metadata: Read-only* is added automatically. Add nothing else.
   - **Where can this app be installed:** *Only on this account* for your own sites, or *Any account* to offer the connector to others.
   - After creating it, note the **Client ID**, generate a **client secret**, and note the app's URL name (its slug).
2. **Create the KV namespace:** in this folder, run `npx wrangler kv namespace create OAUTH_KV`, then paste the id it prints into `wrangler.toml`.
3. **Add the secrets:**
   ```
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put TOKEN_KEY      # 32 random bytes, base64: openssl rand -base64 32
   ```
   Put the slug in `GITHUB_APP_SLUG` in `wrangler.toml` so the home page links to the install screen.
4. **Deploy:** `npx wrangler deploy`.
5. **Install the GitHub App** on each website repository that runs seo-autopilot.
6. **Add the connector** with the URL `https://<your worker>/mcp`. Menu names change, so check the app's own help if these have moved:
   - **Claude:** Settings → Connectors → Add custom connector.
   - **ChatGPT:** add a custom connector or app with the same URL (it needs developer mode).

`TOKEN_KEY` encrypts the stored GitHub tokens. Changing it signs everyone out, which is harmless: they sign in again.

## Test it
- `npm test` at the repository root runs `test/connector.test.mjs`, with GitHub and KV faked. It covers registration, consent, the GitHub return, PKCE, single-use codes, refresh rotation, expiry, confidential clients, and the read-only tools on a state branch, including reads outside the report folder.
- `npx wrangler dev` runs it locally in Cloudflare's runtime.

## Known limits
- **KV is eventually consistent.** A code or refresh token used twice within seconds, from two Cloudflare locations, could be accepted twice. PKCE and the client check still apply. A Durable Object would make single use exact; it is not needed at this scale.
- **No rate limiting on `/register`.** Add a Cloudflare rate-limiting rule before offering the connector widely.
- **Reports are as fresh as the last workflow run**, and `list_reports` shows their age. The connector runs nothing itself.
- **At most 30 repositories per user**, the most recently pushed first.
