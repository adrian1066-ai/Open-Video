# OpenVideo progress — 2026-09-22

## Current release status

Existing OpenVideo was extended in place. The WHIP/WHEP and parallel browser-recording architecture is preserved. Stripe and all real payments remain explicitly postponed.

The previous turn stopped because automatic approval review exhausted its usage allowance, not because tests failed. The last integrated Live browser run subsequently completed successfully. Frontend publication is being verified separately; backend deployment alone does not publish the website.

## Implemented and verified

- Stabilization: real community Home/Explore feeds, truthful empty search results, file type/size checks, safe profile/channel/video column grants, and clearer prototype labels. Real uploads, playback, comments, likes, follows and Following passed browser regression.
- Live: title/category/coarse location, reconnect control, ended states, public/subscriber authorization, chat, likes, audience estimates, optional parallel recording, private drafts and explicit replay publication.
- Safety: reports for videos/Lives/comments/users, blocking, appointed moderator queue/review/audit, atomic rate limits, and restrictive hidden/blocked/age-restricted content policies. User specifically approved the safety migration, which was applied. Real two-account report/block/unblock and moderator-access denial passed.
- Notifications: existing inbox reused; owner-only reads and mark-read, follow/comment/Live/request/challenge/mission events, deduplication, opt-in country/city request alerts. Cross-account isolation and forged-notification denial passed. Database deadline job ran successfully.
- Challenges: staff-issued Live/video challenges, global/location/XP scopes, acceptance/deadlines/history, proof submission and independent moderator approval. A prerecorded upload cannot satisfy Live proof. Real Live proof submission passed. Sponsored challenges remain reserved.
- XP: immutable client-inaccessible award ledger, configurable levels, one award per source. Transaction tests verified approval awards and duplicate prevention.
- Requests: voluntary acceptance, new public Live association, start/completion/cancel/expiry and inbox events. Real browser creation, acceptance, area alerts and full Live-linked completion passed.
- Live Map: World → Country → City filtering from creator-shared text, no device coordinates. Real Live appeared with its country/city.
- Missions: configured count/type of new approved challenges, deadline/progress/history, retained proof associations and XP. Transaction tests verified two approved challenges complete one mission, with no duplicate award or reusable mission evidence.
- Multi-View: event grouping, owner-controlled Live membership and existing-player perspective selection. Real event playback used one media connection; other creators cannot attach someone else's Live.
- 32 Node tests passed before the interruption. SQL regression transactions were run as service_role and rolled back. Browser community routes passed at 390px without overflow or exceptions after correcting the new navigation wrapping.
- Most recent integrated media test: real WHIP connection, WHEP decoded video and received audio, chat/likes/presence, Live challenge proof, request/event/map associations, follower notification, stop, private replay, multi-part playback, explicit publish/unpublish, and recording-disabled start/stop all passed.

## Deployed backend

Migrations through legacy_interaction_hardening are applied; local migration names must match remote history. Edge Functions: openvideo-live v5, openvideo-safety v1, openvideo-community v2. Service-only community RPCs derive identity from an Auth-verified request, never a client actor field. Secrets and WHIP remain server-only.

The unused unlimited view counter was revoked. Read-only like/follow helpers now honor client access and do not update counts on page load. Qualified view writes are serialized and respect hidden/blocked/age-restricted content. Guest browser-key analytics remain susceptible to identity rotation and never award XP.

## Remaining launch work and honest limits

- Physical camera-to-separate-phone verification, ideally across networks, remains unverified. Synthetic camera/audio and a mobile viewport are not physical-device proof.
- Only one Cloudflare input is configured: one concurrent broadcaster. Multi-View supports grouping/switching, but concurrent perspectives require a capacity upgrade and concurrent-media testing.
- Staff moderation operations, age-verification/onboarding, controlled signup/email-confirmation/recovery, password protections and final security-advisor review remain launch work.
- Public search currently covers the loaded recent videos. Inbox and community endpoints return bounded recent lists. Large-audience notification fan-out needs queuing and pagination.
- Live proof verifies association/start time, not camera authenticity or actual geographic location. Mission rules currently support number/type of approved challenges.
- Existing analytics, wallet, promotion and related prototype surfaces still contain clearly labeled demonstrations. No actual financial balances or transactions.
- Replays require the broadcasting tab/device to remain available. Recovery is on the original device/account. Already-issued signed links last until expiry; downloaded media cannot be revoked. Blocking/moderation does not guarantee immediate shutdown of already-established media.
- Legacy SQL patches are not a complete clean-project schema bootstrap; backup/restore and deployment reproducibility need an operations pass.
- Never delete existing user accounts, channels, subscriptions or recordings as cleanup. Test uploads/replays are retained privately; test requests/events are closed.
- Payments are last: US account holder, USD, platform 20%, creator bears processing fees are recorded business decisions only. No Stripe setup until new explicit approval after launch work.

## Earlier release

PR #2 delivered optional private replays and publication controls, merged as b0145ba21ecba0f5f15a452fb6194388aedfd180. The baseline before this release was bfa792650aa47ce59d9497d6f4b81966834a021a. No design rebuild or streaming-provider replacement was performed.
