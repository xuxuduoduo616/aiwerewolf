# Roadmap

This roadmap distinguishes shipped behavior from planned work. Dates are intentionally omitted until external-service, moderation, security, and data requirements are verified.

## v1.0 - Playable AI Werewolf

Status: complete and deployed.

- 9-player and 12-player boards
- Full day/night loop, voting, role actions, deaths, and win resolution
- Three difficulty levels and role-specific AI behavior profiles
- Belief tracking, action selection, AI dialogue, and offline fallback speech
- Responsive desktop, tablet, and mobile interface
- English application chrome
- Guest trial, email OTP integration, profiles, and game records
- Netlify production deployment and build verification

## v1.1 - AI Quality

Status: planned.

- Resolve residual generic player references in generated dialogue
- Improve fallback-language consistency without changing user-authored content
- Evaluate cloud text-to-speech behind a provider adapter and graceful fallback
- Continue speech-corpus provenance and licensing review

Release gate: dialogue evaluation must preserve legal game knowledge, avoid invented facts, and degrade cleanly without an external provider.

## v1.2 - Social Foundation

Status: planned; current lobby social surfaces are previews only.

- User-owned profiles and privacy controls
- Friend requests, blocking, and reporting
- Direct or lobby messaging with rate limits and moderation boundaries
- Presence and basic party coordination
- Production verification of row-level security and backups

Release gate: every table and realtime channel must define ownership, read/write permissions, deletion behavior, abuse controls, and recovery procedures.

## v2.0 - Server-Authoritative Multiplayer

Status: planned.

- Private rooms, invitations, seating, ready state, and match start
- Server-validated commands and versioned match state
- Per-player projections for roles and other secret information
- Reconnect, retry, timeout, and abandoned-room handling
- Auditable match events and saved results

Release gate: clients cannot submit authoritative outcomes; duplicate, stale, unauthorized, or out-of-phase commands must be rejected without corrupting a match.

## Deferred Commerce

Payment controls remain disabled. Commerce will not open until a payment provider, merchant verification, signed webhooks, idempotent ledger, reconciliation, refund/dispute handling, monitoring, and production rollout plan are separately approved and tested.
