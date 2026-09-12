# Deploy OpenVideo V6.7

1. Run `SUPABASE_V6_7_REAL_LIKES.sql` in Supabase SQL Editor.
2. Upload these files to the root of the existing GitHub Open-Video repository:
   - index.html
   - README.md
   - FEATURES.md
   - DEPLOYMENT.md
   - SUPABASE_V6_7_REAL_LIKES.sql
3. Commit directly to `main`.
4. Wait for GitHub Pages.
5. Test:
   - signed out: real like total is visible, clicking Like asks for sign in
   - signed in: Like increments by 1
   - refresh/reopen: liked state persists
   - click Like again: total decreases by 1
   - Creator Studio Content shows the real Likes count
