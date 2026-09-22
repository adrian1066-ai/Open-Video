# OpenVideo feature status

## Real integrations

- Supabase authentication, creator channels, uploads/signed playback, likes/comments/follows and Following.
- Cloudflare WHIP transmission and WHEP playback through the existing server broker.
- Live chat, audience estimates, likes, public/subscriber authorization, stop/reconnect and optional private replay publication.
- Reports, blocking, moderator review/audit and basic abuse controls.
- In-app event notifications, mark-read and opt-in country/city request alerts.
- Staff challenges with Live/video proof and deadlines; independent approval; configurable creator XP/levels.
- Voluntary community requests linked to a creator's public Live.
- World/country/city Live discovery from optional creator-shared metadata.
- Missions based on new approved challenges, with proof associations and once-only XP.
- Multi-View event grouping and one-at-a-time perspective playback.

## Reserved or limited

- Stripe, money transfers, paid membership purchases, tips/payouts and sponsored challenge rewards are not implemented.
- Existing financial/analytics/promotion prototypes remain simulations.
- Push notifications are not enabled. Current inbox delivery is in-app only.
- One configured Cloudflare input means one broadcaster at a time.
- Live proof does not authenticate the scene or a creator's location.
- Public launch still needs physical-device, account lifecycle, moderation/age, operations and scale checks.

See OPENVIDEO_PROGRESS.md for actual test evidence and DEPLOYMENT.md for the release checklist.
