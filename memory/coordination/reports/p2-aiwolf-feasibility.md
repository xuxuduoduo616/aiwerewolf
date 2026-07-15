# P2-A: AIWolf Data Feasibility Report

Date: 2026-07-15
Method: Read-only browsing of public aiwolf.org pages (Playwright navigation + page fetch). No downloads, no logins, no scraping.

## Summary

AIWolf (人狼知能, https://aiwolf.org) publishes large volumes of competition game logs as directly-downloadable ZIP archives with no login required. However, **no explicit data license or terms of service is published** for the logs, and the game's role model **does not match this project's role set** — AIWolf has no 女巫 (Witch), no 猎人-style death-triggered Hunter, and no 白痴 (Idiot). This significantly constrains how the data can be used.

---

## Q1. What public log data is available? Format?

Confirmed available on https://aiwolf.org/en/resource/ (Developer page) as direct ZIP links:

| Dataset | URL | Scale |
|---|---|---|
| 5th Intl Competition (2023) | `http://aiwolf.org/archive/gamelog15-2023-13600.zip` | 15-player, ~13,600 games |
| 4th Intl Competition (2022) | `http://aiwolf.org/archive/gamelog2022-686700.zip` | 15-player, ~686,700 games |
| 2nd Intl Competition (ANAC2020) | `http://aiwolf.org/archive/ANAC2020Log.zip` | — |
| CEDEC2018 | `.../log_cedec2018.zip` | — |
| GAT2018 / CEDEC2017 / GAT2017 (5p & 15p) / GAT2016 | various `.zip` | — |

- Format: **ZIP archives**. AIWolf's standard game-log format is line-oriented CSV/TSV-style text (one row per game event: day, type, agent, role, content) — this is the well-known AIWolf log format. **Not verified by opening a ZIP** (read-only, no downloads), but inferred from the AIWolf platform's documented log format.
- Logs are protocol-division logs (structured "utterances" using the AIWolf protocol grammar), not free natural-language logs, for these ZIPs. Natural-language division exists (see 2024/2025 NLP domestic competitions in the news feed) but I did **not** find a public NL-division log download link.

## Q2. How to download?

- **Direct HTTP links, no login, no request form.** URLs are plain `http://aiwolf.org/archive/*.zip`.
- I did NOT click/download them (read-only constraint). Availability confirmed only by the presence of the links on the public Resource page; actual reachability of each ZIP not verified.

## Q3. License / terms of service — can it be redistributed?

- **No explicit license or terms of service found** for the game logs on the Resource, Support, or Introduction pages.
- Only notice present: footer copyright `© 2015 Artificial Intelligence based Werewolf`.
- Finalist **source code** (not logs) is labeled MIT per-team; this does not cover the log datasets.
- `robots.txt`: only disallows `/control-panel/wp-admin/` (WP admin). It does **not** disallow `/archive/` or content pages — so pages/logs are not robots-excluded. This governs crawler etiquette, not data-reuse rights.
- **Conclusion: redistribution rights are unconfirmed.** Absence of a license is NOT permission to redistribute. Recommend: (a) do not redistribute raw logs; (b) if used, contact the organizers for written permission; (c) prefer storing derived/aggregated data rather than raw logs.

## Q4. Which roles does AIWolf support? Witch / Hunter?

I could **not** open the protocol spec PDF (WebFetch returned only page framing, not the role table). Based on the well-established AIWolf standard rule set (15-player and 5-player configs), the roles are:

- VILLAGER (村人)
- SEER (占い師) — investigates one player's human/werewolf status per night
- MEDIUM (霊媒師) — learns executed player's status
- BODYGUARD / GUARD (騎士・狩人) — protects one player from the night attack
- WEREWOLF (人狼)
- POSSESSED / MADMAN (狂人) — human-team-counted werewolf ally

Answering directly:
- **女巫 (Witch, save+poison potions): NOT present** in AIWolf.
- **猎人 (Hunter that kills a player upon dying): NOT present.** Note a naming trap: AIWolf's Japanese 狩人 translates as "hunter" but is functionally a **Bodyguard/Guard** (night protection), NOT the death-triggered shooter in this project. Do not conflate them.
- **白痴 (Idiot): NOT present.**

Caveat: role list above is from domain knowledge, not verified against the live protocol PDF this session.

## Q5. Role mapping (AIWolf ↔ this project)

| This project | AIWolf equivalent | Match |
|---|---|---|
| Werewolf | WEREWOLF | direct |
| Villager | VILLAGER | direct |
| Seer | SEER | direct |
| Witch | — | **no equivalent** |
| Hunter (death-trigger) | — (AIWolf 狩人 = Bodyguard, different mechanic) | **no equivalent** |
| Idiot | — | **no equivalent** |
| (—) | MEDIUM | project has no Medium |
| (—) | POSSESSED | project has no Possessed |

Only Werewolf, Villager, Seer map cleanly. Witch, Hunter, Idiot have **no usable behavioral source** in AIWolf data.

## Q6. Is RAG storage of conversation *summaries* (not raw logs) likely permissible?

- **More defensible than storing raw logs**, since summaries/statistics are transformative derivatives rather than verbatim redistribution. But with no license granting reuse rights, even derivative use carries some risk.
- Practical stance: storing internally-generated *summaries and aggregate behavioral statistics* for a RAG/knowledge base (not published/redistributed) is low-risk and reasonable. Redistributing or publishing raw logs is the higher-risk action to avoid.
- This is a judgment call, not a verified legal permission. Recommend confirming with organizers if the product is commercial.

## Q7. Data gaps for roles not covered

- Witch, Hunter (death-trigger), Idiot: **zero coverage** in AIWolf.
- AIWolf logs are also largely **protocol-grammar utterances**, not free natural language — limited value for training/retrieving natural conversational behavior. NL-division logs were not found as a public download.
- Language: AIWolf material is Japanese-centric; behavior/phrasing may not transfer to this project's target language.

---

## Recommended approach for the role behavior knowledge base

**Roles present in AIWolf (Werewolf, Villager, Seer): Option B — structured behavioral parameter distillation.**
Rationale: AIWolf logs are protocol-structured, high-volume, and ideal for extracting *statistics* (claim rates, counter-claim patterns, voting behavior, deception frequency) plus a small set of representative examples. This avoids raw-log redistribution concerns and yields reliable, reusable behavioral parameters. Pure RAG over raw logs (Option A) is weak here because the logs are grammar-token utterances, not natural dialogue, and raw-log storage/redistribution rights are unconfirmed.

**Roles absent from AIWolf (Witch, Hunter, Idiot): Option C — synthetic data with role-specific templates.**
No source data exists, so generate role-specific behavioral templates/synthetic examples grounded in the project's own game rules. Optionally seed with hand-authored strategy notes.

**On the user-suggested Option A (RAG from AIWolf summaries):** viable as a *supplement* for the three mapped roles if summaries are generated in-house (see Q6), but not sufficient alone and not applicable to the missing roles. Prefer B as the primary method, A as an optional retrieval layer over the distilled examples.

Suggested plan: B for Werewolf/Villager/Seer, C for Witch/Hunter/Idiot, unify both into one behavioral-parameter schema so the knowledge base is consistent across all roles.

---

## Explicitly NOT verified
- Contents/exact format inside any ZIP (no downloads performed).
- Reachability of each archive URL.
- The live protocol PDF role table (fetch returned only page framing).
- Any license page behind links not surfaced on the public pages checked.
- Existence of a public natural-language-division log download.
