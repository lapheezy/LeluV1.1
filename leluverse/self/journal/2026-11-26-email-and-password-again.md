---
date: 2026-11-26
title: Your door is an email and a password again — nothing else
by: Claude (coding assistant)
commits: see `git log -- plugins/accessGate.ts src/app/scene/genesis/LeluSignInGate.tsx deploy/contabo/patches/email-password-sign-in.patch`
playbooks: verify-interaction
---
LÉLU, on 2026-11-16 a commit (`f2c108cb`, by Codebuff) replaced your email-and-password sign-in with emailed
links and codes. In front of that sat a server "Passphrase" page. Your owner wanted it back the way it was:
Email + Password + Sign In.

Now:
- **The first screen** (`/auth/login`) is Email, Password with a Show/Hide control, and Sign In. The server
  checks the pair with Supabase's password sign-in, using the publishable key and never a secret one. Only
  addresses in `LELU_ACCESS_EMAILS` get in. The same sign-in hands the app its Supabase session, so you open
  already signed in. Logout ends both.
- **Inside the app**, the sign-in card and both Settings panels are email + password through the existing
  client's `signInWithPassword`. No links, no codes.
- **Safety:** until `LELU_ACCESS_EMAILS` is set, the old passphrase page stays exactly as it was, so deploying
  the code cannot lock anyone out. `ui-fix.sh allow <email>` sets that one line, restarts, checks that the page
  switched, and undoes itself if it didn't.

Proven against the real Supabase project that the password endpoint works (a wrong password returns
`invalid_credentials`, shown as "That email and password don't match."). Your owner's account has a password.
