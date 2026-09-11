# OpenVideo V6 — Connected Beta

This version connects the static GitHub Pages prototype to Supabase using the public publishable key.

## Real in V6
- Email/password signup
- Email/password login/logout
- Supabase session
- Automatic creator channel creation
- Authenticated video upload to the private `videos` bucket
- Video metadata saved to the `videos` table
- Owner playback using a temporary signed URL

## Still simulated
- Payments/tips/super comments
- Public multi-user playback of uploaded videos
- Ads/Premium payouts
- Moderation workflows

## Important
The Supabase publishable key is intentionally usable in browser code. Never place a service-role key, database password, Stripe secret, or other private credential in this repository.
