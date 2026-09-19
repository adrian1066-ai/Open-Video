# OpenVideo Live

Live is an additive module for the existing V7.3 application. The video upload, profile,
following, comments and Studio implementations retain their existing behavior and styles.
Open **Live** in the sidebar to discover broadcasts and replays or broadcast from your channel.

## Media and access

- Browser transmission uses native WebRTC **WHIP**; playback uses **WHEP**.
- Supabase Edge Function `openvideo-live` proxies SDP negotiation. Neither the WHIP URL nor the
  Cloudflare signing key is returned to the browser, stored in public tables, or committed.
- Configuration is encrypted in Supabase Vault under `openvideo_live_config`. Only the service
  role can call the configuration RPC. Do not put its value into this repository or build variables.
- The existing Cloudflare input requires signed playback, including public sessions. After
  checking access, the server signs a 60-second token and negotiates WHEP without exposing that token.
- `live_subscriptions` contains channel-specific entitlements with an expiration date. They are
  separate from free follows and platform Premium. Only an administrator/backend can grant them.
  No Stripe or payment integration is configured. To grant access, insert the verified channel ID,
  verified user ID and expiration timestamp through the Supabase dashboard, never from a client.
- All Live tables have RLS enabled and revoke `anon`/`authenticated` access. The Edge Function
  validates Supabase Auth and checks ownership or membership before privileged reads and writes.
- Guests can view public streams. Signed-in viewers can chat and like. Viewer counts use distinct
  authenticated users or guest browser-session IDs with 45-second heartbeat expiry, not Cloudflare metrics.
  Guest counts are an estimate, not billing or anti-fraud metrics. The broadcaster is excluded.
- Chat, likes and counts refresh every four seconds. Chat messages render as text, not HTML.

## Replay

Cloudflare WebRTC does not record broadcasts. A parallel browser `MediaRecorder` saves complete
30-second media files to IndexedDB and uploads them to the private `live-replays` bucket.
The replay becomes discoverable only after all numbered parts are verified as uploaded.
The replay player moves through parts in order and lets viewers select a part. There can be
brief transitions between parts; this is not a continuous HLS recording or DVR.

Use **End & save replay** and keep the tab open until upload finishes. If an upload fails,
use **Recover recordings** on the same device while signed in as the original broadcaster.
Already uploaded files are not uploaded twice. Local pending files are removed only after
server acknowledgement. Closing/crashing the browser can lose the currently open 30-second part;
previously saved parts can be recovered. Private/incognito mode may discard local recordings.
Background suspension can interrupt recording; keep the broadcast tab visible.

Each file is limited to 20 MiB and 120 seconds. Sessions support at most 1,440 parts (about 12 hours).
Subscriber replays require the same active entitlement as their live session. Playback links
expire after two minutes and are issued per part. As with other signed media, revocation cannot
erase data already downloaded. WebRTC authorization is checked at session establishment;
the application rechecks while open, but a malicious viewer can retain an already established
media connection until the broadcast ends.

## Deployment

1. Apply `supabase/migrations/*_live_whip_whep.sql` once to the existing Supabase project.
2. Store the input's `whip`, `whep`, `inputUid`, `host`, signing `keyId` and base64 `jwk` as one JSON
   value in Vault named `openvideo_live_config`, using trusted administration only.
3. Enable `recording.requireSignedURLs` on the Cloudflare input. Its recording mode does not
   create a WebRTC replay; leave existing recording settings intact.
4. Deploy `supabase/functions/openvideo-live` with JWT gateway verification disabled. The function
   implements its own JWT validation with `/auth/v1/user`, necessary for public guest discovery.
5. Publish the existing static site plus `assets/live.js` and `assets/live.css`.
   The function allows the existing GitHub Pages origin and localhost for development.

The supplied test input is a shared beta resource: the database allows one broadcaster at a time.
New concurrent streams require separate provisioned inputs and per-input configuration.
WHIP and signing credentials remain entirely server-side, even when different channel owners
use this input at different times. Ending a broadcast closes its media sessions before releasing it.

## Verification

Run `node --test tests/*.test.mjs` (Node 24+) for API authorization, access rules, lease expiry, credential projection,
endpoint allowlisting and signature validation. Run `node --check assets/live.js` for client syntax.
Browser verification should cover two authenticated users and a public guest, denied subscriber
access, a granted then expired entitlement, WHIP/WHEP connection, chat, likes, heartbeat expiry,
replay upload, recovery after interruption, and navigation cleanup. Use synthetic media for tests.

Validated on this deployment: 14 automated tests; browser WHIP transmission and WHEP video/audio;
persisted chat, likes and viewer presence; multi-part replay; retry/recovery after an intentionally
failed upload; and subscriber replay access before grant, while active and after expiration.
Direct anonymous reads of Live tables and the Vault configuration RPC were rejected.
Database advisors report no new warnings for this module. The informational “RLS enabled without
policies” notices are intentional for these server-only tables; existing unrelated warnings remain.

Official references: [Cloudflare browser WHIP/WHEP](https://developers.cloudflare.com/stream/examples/browser-based-webrtc/),
[WebRTC limitations](https://developers.cloudflare.com/stream/webrtc-beta/),
[signed playback](https://developers.cloudflare.com/stream/viewing-videos/securing-your-stream/),
[Supabase Edge Auth](https://supabase.com/docs/guides/functions/auth).
