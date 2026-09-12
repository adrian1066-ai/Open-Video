# OpenVideo V6.6 — Qualified Views

V6.6 makes the view counter more realistic.

A view now counts only after actual watch time:
- minimum 3 seconds
- normally 30% of the video
- capped at 10 seconds for longer videos

Repeat protection:
- the same signed-in account counts at most once per video every 24 hours
- a signed-out browser counts at most once per video every 24 hours
- the creator's own signed-in playback never counts

This is an early anti-abuse layer, not a full production fraud-detection system.
