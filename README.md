# OpenVideo

Existing creator video application with an incremental Live module. The original design, uploads, profiles, Following and Studio are preserved.

- [Open the app](https://adrian1066-ai.github.io/Open-Video/)
- [Live](https://adrian1066-ai.github.io/Open-Video/#live)
- [Progress, audit and remaining work](OPENVIDEO_PROGRESS.md)
- [Live architecture and deployment](LIVE.md)

## Run locally

Serve this directory with any static HTTP server, for example `python -m http.server 8080`, then open `http://localhost:8080`. Camera/microphone require localhost or HTTPS and browser permission. Keep the broadcasting tab visible while recording.

The existing `index.html` contains public `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` settings. They are browser identifiers, not administrative credentials. There is no frontend build step or private frontend environment file. Changing the deployment domain also requires updating Edge Function CORS and Supabase Auth redirect URLs.

Never add a service-role key, Cloudflare API token, WHIP URL, playback signing key, or payment secret to HTML, assets, git, browser storage or public logs.

## Backend configuration

Use the existing Supabase schema. Root `SUPABASE_*.sql` files are legacy feature patches, not the complete original database bootstrap. Do not run all patches blindly on an existing deployment.

Live migrations are versioned under `supabase/migrations`. Apply only unapplied migrations in order. The second migration adds metadata and private replay publication controls without deleting existing media or users.

Deploy `supabase/functions/openvideo-live` after migrations. Supabase automatically provides server environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. `verify_jwt=false` permits guest access; the handler independently validates bearer tokens and enforces ownership/audience on every action. Live tables are not directly client-accessible.

Configure encrypted `openvideo_live_config` in Vault through trusted administration. See LIVE.md for field names; never copy values into a client build. The Cloudflare input must require signed playback. One configured input currently supports one concurrent broadcaster.

## Live and replay

Sign in, open Live, enter title/category and optional country/city, select public or channel-subscriber audience, and start broadcasting. WHIP transmits; WHEP plays. Chat, likes and audience estimates use Supabase.

Recording is optional. Ended broadcasts leave active discovery. Completed recordings appear in **My recordings** as private drafts; use **Watch replay**, then explicitly **Publish replay** if desired. **Unpublish replay** stops new viewer access. Subscriber recordings retain the same membership requirement. Use **Recover recordings** on the original device/account after interrupted uploads.

Cloudflare WebRTC does not create these replays automatically. Browser recording produces independent parts with possible brief transitions; a crash can lose the unfinished part. Signed links expire after two minutes; downloaded content cannot be recalled.

## Verification

Node 24 or newer:

```sh
node --test tests/*.test.mjs
node --check assets/live.js
```

Optional browser integration test: install Playwright in your development environment, set `OPENVIDEO_TEST_USERS_PATH` to a private JSON file with two dedicated accounts (`[{"email":"...","password":"..."},{"email":"...","password":"..."}]`, host first), then run `node tests/live-browser.cjs`. Set `BROWSER_EXECUTABLE` to your installed Chromium/Edge executable when needed and `PLAYWRIGHT_MODULE` if Playwright is outside normal module resolution. Set `LIVE_TEST_RECOVERY=1` to simulate failed uploads. This test uses the configured real backend and media service, briefly publishes synthetic test footage, then unpublishes it; run only on an authorized test environment. It retains completed recordings privately and writes screenshots to a temporary directory. Never commit the credentials file.

OPENVIDEO_PROGRESS.md distinguishes automated/live-service checks from remaining physical-device verification. Payment and other demonstration interfaces are not real transactions. Stripe is not configured; no customer is charged.

## Current community preview

The app extends the existing interface with reporting/blocking/moderation, an in-app inbox, challenges, XP/levels, voluntary requests, country/city Live discovery, missions and event perspectives. Deploy openvideo-safety and openvideo-community alongside openvideo-live after their migrations. Every safety/community action validates the account token before calling service-only functions. Moderator roles are server-managed.

Notifications reuse the original inbox. A database job checks deadlines once per minute. Push is not enabled. Challenges require new creator-owned proof and independent staff approval; Live proof verifies timing, not camera authenticity or location. Missions count newly approved challenges. XP awards are idempotent and level thresholds are configurable.

Multi-View groups existing Lives and switches the same player. One configured input still means one broadcaster at a time; concurrent perspectives need additional capacity and testing. Country/city is optional text; no device coordinates are collected.

Additional tests: tests/app-browser.cjs, tests/community-browser.cjs and rollback SQL tests under supabase/tests. Set OPENVIDEO_CHALLENGE_ID to a private staff-issued test challenge for integrated Live community checks. Use dedicated accounts and never commit credentials. See DEPLOYMENT.md and OPENVIDEO_PROGRESS.md for remaining launch work; this is a development preview.
