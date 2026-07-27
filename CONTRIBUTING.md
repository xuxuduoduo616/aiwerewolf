# Contributing

Thank you for helping improve AI Werewolf. The most useful contributions are focused bug reports, reproducible UI issues, accessibility improvements, tests, and small changes that respect the existing architecture.

## Before Opening an Issue

- Search existing issues for the same behavior.
- Confirm the issue on the current production site or the latest `main` branch.
- Include the browser, viewport, reproduction steps, expected result, and actual result.
- Remove emails, tokens, account details, and other private data from screenshots and logs.
- Report security concerns privately according to [SECURITY.md](SECURITY.md).

## Pull Requests

1. Open or reference an issue that defines the expected behavior.
2. Keep the change narrowly scoped and avoid unrelated formatting or refactors.
3. Preserve the separation between deterministic rules, AI decisions, and generated expression.
4. Add or update tests in proportion to the behavior changed.
5. Run `npm run test:run` and `npm run build` before requesting review.
6. Document user-visible changes and any remaining verification limits.

Do not include copied game assets, speech corpora, credentials, browser profiles, authentication captures, or material you do not have permission to contribute.

This project is currently source-available rather than permissively licensed. By submitting a contribution, you represent that you have the right to provide it and grant the project owner permission to use, modify, and distribute it as part of AI Werewolf. Opening an issue does not transfer ownership of its text or attachments.
