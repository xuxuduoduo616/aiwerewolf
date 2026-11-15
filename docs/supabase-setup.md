# Supabase Setup

Supabase provides authentication, user profiles, and authenticated match records. Guest identity, guest records, and cosmetic presentation state remain local to the browser. Configuration instructions describe the implementation requirements; they do not prove that a particular production project has been configured or independently verified.

## Schema and ownership

For a new project, review [supabase-init.sql](supabase-init.sql). It defines:

- `profiles`, owned by the authentication UUID, with a unique normalized Username and a non-empty Nickname in `display_name`;
- `game_records`, with an owner UUID, board, role, outcome, round count, and summary;
- an index on the owner and record creation time;
- row-level security and owner-scoped access policies.

For an existing profile table, review [profile-identity-migration.sql](profile-identity-migration.sql) instead of recreating it. The migration preserves valid unique usernames, backfills missing or invalid handles without deriving them from email, and adds explicit format, uniqueness, and access constraints. Historic SQL policy identifiers are intentionally retained where needed for compatibility.

Applying any migration requires separate authorization, a review of the existing data, and post-migration access checks. Reading or sharing these files does not execute SQL or change a hosted project.

## Authentication

Configure the Email provider to support the account flows used by the application. New accounts use email and password registration; returning accounts can use password or email-code login.

- Keep email confirmation enabled. New users verify ownership of the address before completing their profile.
- Both the **Confirm signup** and **Magic Link** email templates must contain `{{ .Token }}`. The application accepts a typed verification code rather than depending on a callback link.
- Match the configured code length to the client, which accepts 6-10 digits.
- If CAPTCHA is enabled, configure Turnstile for the intended site. The client submits a one-time CAPTCHA token to registration, password login, and code-sending requests, then obtains a new token.
- For public email delivery, configure and verify a custom SMTP service, sender domain, quotas, and delivery behavior. SMTP credentials remain server-side.
- Passwords are sent only through the authentication service. They are not stored in profiles, public user metadata, or browser persistence.

Existing email-code-only users can continue to use the Verification code option. The application does not include a password-reset or password-creation flow for those legacy accounts.

## Browser and server configuration

The browser uses only the public project URL and anonymous/publishable client key. Row-level security must enforce ownership regardless of what the client submits. Service-role credentials and administrative operations remain on protected server boundaries.

Local environment files must stay outside Git. The deployed frontend and server functions must use the intended project and approved origins. Never place a service-role key, provider key, SMTP credential, or authentication capture in the source distribution.

## Economy schema

The optional economy implementation is described by [economy-schema.sql](economy-schema.sql); legacy coin-escrow declarations are in [coin-escrow-schema.sql](coin-escrow-schema.sql). These are source artifacts, not evidence that real payments, rewards, or merchant services are available.

Payments remain disabled. Authenticated gameplay rewards require a separately approved trusted server-side eligibility writer; browser-authored match outcomes are not reward authority. Do not enable these services by trusting a client-supplied result or by changing access policies to make a test pass.

## Verification

Before relying on an authenticated deployment, use controlled test accounts to verify registration, email-code login, password login, refresh/session restoration, and ownership of saved records. Check that:

- unauthenticated clients cannot read private profiles or match records;
- one account cannot read or mutate another account's rows;
- valid usernames remain unique after normalization;
- invalid usernames and empty nicknames are rejected;
- the frontend has no administrative credentials;
- guest records are not silently imported into authenticated history;
- email templates, CAPTCHA, SMTP delivery, and session refresh work in the target environment.

A local unit test or successful schema declaration is not a substitute for these deployment checks.
