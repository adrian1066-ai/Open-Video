# OpenVideo V6.4 — Real Views

V6.4 connects real public video playback to Supabase view counts.

- Home/Explore display each real video's `view_count`.
- A view is counted when the real HTML video actually begins playing, not merely when the card is clicked.
- The frontend calls the `increment_video_view` Supabase RPC created in the V6.4 SQL step.
- The displayed count updates after playback begins.
- V6.3 public community feed and playback remain intact.
