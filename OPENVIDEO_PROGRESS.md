# OpenVideo progress

## Scope and baseline — 2026-09-19

Source: supplied Open-Video-main.zip, compared with the current main branch (8f98f4d). Preserve existing design and features; implement Phase 1 before payment work. No existing users, channels, subscriptions or uploads removed.

Architecture: static index.html and assets on GitHub Pages; Supabase Auth, Postgres and Storage; openvideo-live Edge Function brokers Cloudflare WHIP/WHEP. Browser MediaRecorder creates parallel, independent 30-second replay files, persisted in IndexedDB before upload. Cloudflare WebRTC does not automatically record these sessions.

## Initial audit

- Real integrations present: authentication, video uploads and signed playback, creator profiles/media, likes/comments/follows, Following, Studio content and Live. These existing non-Live features were reviewed in source; not all were exercised end-to-end in this phase.
- Baseline Live tests: 14/14 passed. Existing implementation supports WHIP publishing, signed WHEP playback, polling chat/likes/presence and parallel recording. Prior verification is not a substitute for retesting current changes.
- Gaps: all finalized recordings automatically appeared in discovery; recording was mandatory; missing category/coarse location/start timestamp; starting broadcasts appeared before publishing connected; discovery limited rows before filtering active state.
- Monetization buttons and several analytics/admin/clips/promotion surfaces remain demonstrations. They do not collect real money. Stripe has not been configured.
- Live tables have RLS and no client grants; requests are authorized in the Edge Function. The service key and Vault media/signing configuration remain server-only. verify_jwt=false is intentional with current publishable keys: the handler independently verifies supplied bearer tokens against Auth.
- Current capacity is one simultaneous broadcast because only one Cloudflare Live Input is configured.
- Legacy root SQL patches exist, but a complete original schema bootstrap is absent. A fresh project is not reproducible using Live migrations alone.

## Phase 1 changes

- Additive migration: category, optional manually entered country/city, started_at, recording_enabled and replay_published_at. Existing access/state/ended_at represent visibility/status/end time; no schema rename or data deletion.
- Finalize saves private drafts. Only the creator can explicitly publish/unpublish a completed replay. Private drafts cannot obtain signed playback URLs from another account or guest. Published subscriber replays still require the correct active membership.
- Separate active discovery, published replays and owner recording library; public queries filter before limiting. End marks the session unavailable before media cleanup, retaining the input lease until teardown succeeds.
- Broadcast heartbeat requires an established publisher connection. Replay recording can be disabled without requiring MediaRecorder/local recording storage.
- Live form and library use existing classes, colors and layout. Other views remain unchanged.
- Files: index.html, assets/live.js, core.mjs, Edge Function index.ts, new SQL migration, Live tests, README.md, LIVE.md and this log.

## Verification and remaining work

- 21/21 Node tests pass: existing authorization/token rules plus private draft protection, owner-only publication, disabled recording, publisher connection requirement, immediate end visibility and authenticated library access. Frontend syntax check passes.
- Real Edge/Supabase/Cloudflare browser runs passed with separate host/viewer accounts: WHIP connected, WHEP decoded video and received audio packets, persisted chat/likes, counted viewer heartbeat, metadata/start time, multi-part replay, explicit publish/unpublish, and recording-disabled start/stop.
- A second run intentionally returned upload failures; recovery succeeded from IndexedDB and finalized a private draft. Test recordings remain private; no existing accounts/channels/subscriptions were deleted.
- Mobile viewport 390×844 passed without horizontal overflow; screenshot reviewed. Synthetic canvas/audio were used instead of a physical webcam. The reusable browser harness is tests/live-browser.cjs; credentials are supplied through a private external file.
- Comparison against the supplied ZIP confirms index.html outside the Live section is unchanged apart from final newline normalization. This is a preservation check, not a claim that every legacy workflow was tested.
- Cloudflare input Open Video Test Live remains enabled; WHIP/WHEP configured and signed playback required. No credential values were printed or committed.
- Migration 20260920040138_live_creator_replay_control applied; openvideo-live Edge Function version 3 deployed. Live tables retain their closed client permissions. Security advisors show existing legacy function/password warnings and intentional server-only Live RLS informational notices.
- Static-site release is prepared for GitHub Pages; deployment verification follows the release commit.

Physical desktop-camera to separate phone on a different network still requires an actual device check. Automated mobile viewport tests cannot prove all phone/browser/network combinations.

Replay limitations: browser tab must stay open; interrupted uploads can recover on the same device/account; independent parts may have brief gaps. Already issued replay links expire after 120 seconds; unpublishing cannot revoke bytes already downloaded. Creator library lists the latest 60 sessions.

## Next phases and launch blockers

Phase 2 needs a securely configured payment provider/Connect account and confirmed platform fee, supported countries/currency, refund and payout rules. No live charges or fabricated payment success. Plan for server-created checkout, verified idempotent webhooks, an immutable transaction ledger, subscription entitlements and payout reconciliation.

User action: verify one actual desktop-camera broadcast from a separate phone/network, and specify operating country, charging currency and platform commission for Phase 2. Stripe test credentials/webhook signing secrets must be configured through a trusted server-secret workflow, never pasted into chat or committed. Payment work is not represented as complete while these inputs are missing.

Before broad public launch, audit legacy profile role-column privileges/public profile fields, video bucket limits, existing SECURITY DEFINER functions and Auth password protections. Live chat throttling currently uses a non-atomic time-window query, requiring stronger limits in Phase 3. Subscriber-only media authorization is enforced; this is not complete DRM or production moderation. Do not claim the seven-phase roadmap is finished.
