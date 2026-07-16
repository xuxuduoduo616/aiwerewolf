# AIWolf (aiwolf.org) Data Research

Date: 2026-07-16
Method: robots.txt check, direct fetch of public pages (WebFetch/curl), WebSearch, GitHub API. No logins, no captchas, no large downloads (HEAD requests only for archive sizes).

## TL;DR

- aiwolf.org publicly hosts **protocol-format game logs** (not natural language) from past competitions, incl. **13,600 games** (5th intl, 2023) and **686,700 simulated games** (4th intl, 2022, 3.2 GB).
- **No explicit license is stated for the game logs anywhere** on aiwolf.org (JA or EN). Software (server/client/common) is MIT. Log license: **unclear / not explicitly granted**.
- Roles confirmed from official source code: **WEREWOLF, VILLAGER, SEER, MEDIUM, BODYGUARD, POSSESSED** (+ deprecated FREEMASON, never used). **No Witch, no death-triggered Hunter, no Idiot** — hypothesis confirmed. (Note: Bodyguard is called 狩人/騎士 "hunter/knight" in Japanese but is a night-guard role, not a death-shot role.)
- Natural-language (dialogue) logs from the NLP division (aiwolfdial) are **not centrally published for public download**; Japanese + English (intl. contests are English-only since 2025).

## 1. robots.txt

URL: https://aiwolf.org/robots.txt

```
User-agent: *
Disallow: /control-panel/wp-admin/
Allow: /control-panel/wp-admin/admin-ajax.php
```

Only WordPress admin is disallowed. All content pages and /archive/ downloads are crawlable.

## 2. Publicly available data

### 2a. Protocol-division game logs (download page: https://aiwolf.org/resource/ , EN: https://aiwolf.org/en/resource)

| Dataset | URL | Size (HEAD) | Notes |
|---|---|---|---|
| 5th Intl Competition, 15-player, 13,600 games | https://aiwolf.org/archive/gamelog15-2023-13600.zip | 73.3 MB | published 2024-02-27 (announcement: https://aiwolf.org/archives/3028) |
| 4th Intl Competition, 15-player, 686,700 games (simulator-generated from finalists) | http://aiwolf.org/archive/gamelog2022-686700.zip | 3.24 GB | announcement: https://aiwolf.org/archives/2937 |
| 2nd Intl Competition (ANAC 2020) | http://aiwolf.org/archive/ANAC2020Log.zip | 57.5 MB | |
| 1st Intl Competition 2019, 15-player | http://aiwolf.org/archive/2019final-log15.tar.gz | 49.1 MB | |
| 1st Intl Competition 2019, 5-player | http://aiwolf.org/archive/2019final-log05.tar.gz | (not HEAD-checked) | |
| CEDEC2018 | http://aiwolf.org/control-panel/wp-content/uploads/2018/08/log_cedec2018.zip | | |
| GAT2018 / CEDEC2017 / GAT2017 (15p & 5p) / GAT2016 | http://aiwolf.org/archive/GAT2018Log.zip , cedec2017Log.zip , GAT2017Log15.zip , GAT2017Log05.zip , GAT2016Log.zip | | |

None of these download links carries any license text, terms-of-use page, or copyright notice beyond the site footer "© 2015 Artificial Intelligence based Werewolf".

### 2b. Agent source code from past competitions

Finalist agent source code is published per-team with **explicit MIT license per team** (e.g., 4th intl finalists table at https://aiwolf.org/en/archives/2840 lists every team's zip as "MIT").

### 2c. Platform software (GitHub org https://github.com/aiwolf)

- AIWolfServer — MIT (https://github.com/aiwolf/AIWolfServer)
- AIWolfCommon — MIT (https://github.com/aiwolf/AIWolfCommon)
- AIWolfClient — sample agents
- AIWolfPy — **no license file** (https://github.com/aiwolf/AIWolfPy)
- wolfbbs_annotations — MIT (annotations over human 人狼BBS play; note the underlying BBS text has its own copyright, MIT covers only the annotations)

### 2d. NLP division / aiwolfdial (GitHub org https://github.com/aiwolfdial , site https://aiwolfdial.github.io/aiwolf-nlp/)

- Tooling repos are MIT: aiwolf-nlp-server, aiwolf-nlp-agent, aiwolf-nlp-agent-llm, aiwolf-nlp-common, aiwolf-nlp-viewer.
- Log-related repos (aiwolf-nlp-log-picker, aiwolf-nlp-log-translator, AIWolfLogAnalyzer, AIWolfNLPServer) have **no license** and contain tooling, not datasets. aiwolf-nlp-log-translator confirms NLP logs are CSV with TALK/WHISPER rows and that intl. logs are English (it translates EN→JA).
- **No public bulk download of dialogue logs found** on the aiwolfdial site or org. 2026 spring domestic rules only say preliminary-round logs "may be viewed/used by other teams" (participants, not public). Competition results are analyzed in AIWolfDial workshop papers (e.g., https://aclanthology.org/2024.aiwolfdial-1.1/ — paper text is CC-BY 4.0, but that does not license the game data).

## 3. Roles (verified)

Source of truth: official Role enum, https://github.com/aiwolf/AIWolfCommon `src/org/aiwolf/common/data/Role.java` (master and 0.6.x branches):

- BODYGUARD (Team VILLAGER) — night guard (JA 狩人; NLP division calls it 騎士/knight)
- FREEMASON (Team VILLAGER) — marked `@deprecated`, "not used in ver0.1.x"; not used in competitions
- MEDIUM (Team VILLAGER) — learns species of the executed
- POSSESSED (Team WEREWOLF, Species HUMAN) — the "madman"
- SEER (Team VILLAGER)
- VILLAGER (Team VILLAGER)
- WEREWOLF (Team WEREWOLF, Species WEREWOLF)

Confirmed: **no Witch, no death-triggered Hunter, no Idiot** — those are Chinese/Western variants absent from AIWolf.

Village compositions in use:
- Protocol division 15-player: villager x8, werewolf x3, seer, medium, bodyguard, possessed (standard AIWolf 15).
- NLP division (2026): 5-player (villager x2, seer, possessed, werewolf) and 9-player (villager x3, seer, bodyguard, medium, possessed, werewolf x2); 13-player retired 2026-03. Source: https://aiwolfdial.github.io/aiwolf-nlp/ regulation pages.

## 4. Data format and language

Protocol-division logs are **CSV text, one event per line**, format confirmed from AIWolfServer source (`src/org/aiwolf/server/AIWolfGame.java`, master):

```
day,status,agentIdx,role,ALIVE|DEAD,agentName
day,talk,talkIdx,agentIdx,content        # content = AIWolf protocol utterances, e.g. COMINGOUT/VOTE/DIVINED..., or Skip/Over
day,whisper,idx,agentIdx,content
day,vote,agentIdx,targetIdx
day,attackVote,agentIdx,targetIdx
day,divine,agentIdx,targetIdx,result
day,guard,agentIdx,targetIdx,targetRole
day,execute,agentIdx,role
day,attack,agentIdx,true|false
day,result,aliveHumanCount,aliveWolfCount,winner
```

Language: protocol logs contain **no natural language** — talk content is the AIWolf protocol grammar (https://aiwolf.org/protocol/, ver3.6). NLP-division dialogue is Japanese (domestic) and English (international, English-only since 2025), but not publicly downloadable in bulk.

## 5. License and redistribution

- Game logs: **unclear / not explicitly granted.** No license, terms-of-use, or copyright statement accompanies any log download on aiwolf.org (checked JA + EN resource pages, announcement pages, and site-wide grep for license/CC/terms keywords). The only "License" mentions on the site are per-team MIT licenses on agent source code.
- Software: MIT (AIWolfServer, AIWolfCommon, aiwolf-nlp-* tooling).
- Redistribution of raw logs: not explicitly permitted -> should be treated as **not granted** until the organizers (人狼知能プロジェクト, contact via https://aiwolf.org/member/ or Mattermost) confirm.

## 6. Can we distill behavioral parameters?

Assessment (not legal advice):

- The logs are deliberately published by the organizers for research/development ("公開しています"), and the community routinely trains agents and publishes statistics from them.
- Deriving **aggregate behavioral parameters** (vote distributions, claim timing, deception rates, win rates) is factual/statistical extraction, not redistribution of the work — practically low-risk, especially since protocol logs contain no creative natural-language text.
- However, since no explicit license exists: (a) do NOT redistribute the raw logs in our repo; (b) distilled parameters + attribution ("derived from AIWolf competition logs, aiwolf.org") is the safe pattern; (c) for anything commercial or for redistributing derivatives at scale, email the organizers first.
- Per-task guidance: report license as **"unclear / not explicitly granted"**.

## 7. Key URLs

- https://aiwolf.org/robots.txt
- https://aiwolf.org/resource/ (JA) / https://aiwolf.org/en/resource (EN) — all log + platform downloads
- https://aiwolf.org/archives/3028 (5th intl logs announcement), https://aiwolf.org/archives/2937 (4th intl)
- https://aiwolf.org/protocol/ — protocol grammar versions
- https://github.com/aiwolf (platform, MIT) / https://github.com/aiwolfdial (NLP division, tooling MIT, no public datasets)
- https://aiwolfdial.github.io/aiwolf-nlp/ — NLP division site (village configs, regulations)
- https://aclanthology.org/2024.aiwolfdial-1.1/ — AIWolfDial 2024 contest summary paper
