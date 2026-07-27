# Security Policy

## Reporting a Vulnerability

Do not open a public issue for vulnerabilities, exposed credentials, authentication bypasses, hidden-role disclosure, payment behavior, or unauthorized data access.

Use the repository's private GitHub security-advisory reporting flow. Include:

- Affected URL, Function, or source path
- Reproduction steps with secrets removed
- Expected and observed behavior
- Potential impact
- A minimal proof of concept, when safe

Do not access other users' data, perform denial-of-service testing, attempt social engineering, or retain credentials encountered during testing.

## Supported Version

Security fixes target the current `main` branch and production deployment. Earlier commits and preview deployments are not supported releases.

## Known Product Boundaries

- Real payment processing is disabled.
- Real-player multiplayer is not available.
- Production Supabase policies and stored data remain owner-operated and require environment-specific verification.
- Public client keys may appear in browser bundles by design; service-role keys and provider secrets must never do so.
