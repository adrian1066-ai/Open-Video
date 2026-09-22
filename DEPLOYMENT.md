# OpenVideo deployment checklist

This upgrades the existing Supabase project. Legacy root SQL files are not a complete fresh-project bootstrap. Preserve all existing users, channels, subscriptions, uploads and Vault configuration.

1. Compare current main and the intended release. Review changed files and applied migration history. Use normal managed backup practices.
2. Apply only unapplied migrations in version order. Do not rerun old SQL patches. New safety/community tables have RLS and no direct client access.
3. Deploy openvideo-live, openvideo-safety and openvideo-community after migrations. Each validates bearer tokens itself; safety/community require authentication for every action. Administrative and media keys remain server-only.
4. Verify the openvideo-community-deadlines database job is active and recent cron runs succeeded. It checks deadlines each minute and writes in-app notices only.
5. Run Node tests, relevant browser harnesses and SQL rollback regressions with dedicated accounts. End broadcasts, unpublish synthetic replays and close test requests/events. Never commit test credentials.
6. Publish through a PR to the existing GitHub Pages repository. Confirm the Pages deployment succeeds for the merged commit and verify the actual public files.
7. Test public Live with two separate browser accounts: video, audio, chat, stop, private recording, explicit replay publishing/unpublishing. Check mobile navigation, Auth, uploads, playback and community routes.

Before broad launch, address the remaining items in OPENVIDEO_PROGRESS.md: physical-device testing, concurrent Live capacity, moderation/age operations, Auth protections, signup/recovery, scalable fan-out/pagination and schema/backup reproducibility.

Only one Live input is configured. Do not advertise concurrent Multi-View until additional capacity is configured and tested.

Payments are last. Do not configure Stripe, paid memberships, payouts or actual transactions without a new explicit approval after the preceding work is stable.
