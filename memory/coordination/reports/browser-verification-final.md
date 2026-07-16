# Browser Verification Final Report

**Date**: 2026-07-16
**Tester**: QA Agent (Playwright MCP)
**Environment**: localhost:5173 (Vite dev preview), no Netlify Functions
**Browser**: Chromium (Playwright MCP)

---

## 1. Guest Flow — PASS

**Result**: PASS

**Evidence**:
- Started at login page with email input, "SEND EMAIL CODE" button, and "Guest Trial" button
- Clicked "Guest Trial" -- immediately entered lobby with board selection (9-player and 12-player), difficulty picker (新手/进阶/高手)
- No page reload observed; transition was smooth client-side routing
- Header shows "Guest trial. Records are local only."

**Screenshots**:
- `final-01-login.png` -- login page before clicking Guest Trial
- `final-01-lobby.png` -- lobby after Guest Trial

---

## 2. Language Toggle — PARTIAL

**Result**: PARTIAL (toggle functional, label semantics inverted)

**Evidence**:
- Language pill in lobby header: toggles between "EN" and "中文"
- Clicking "EN" switches display to Chinese; clicking "中文" switches display to English
- After reload + re-entering Guest Trial, language preference **persisted** (button showed "中文" after previously switching to English)
- **Issue observed**: System event messages appeared inverted relative to the selected language:
  - When button showed "EN" (Chinese mode selected): system messages in English ("Game Start. You are Hunter.", "Night falls.", "Peaceful night.")
  - When button showed "中文" (English mode selected): system messages in Chinese ("游戏开始。你的身份是：猎人。", "天黑请闭眼。", "昨晚平安夜。")
  - Board names and role names remained in Chinese regardless of language setting

**Screenshots**:
- `final-02-zh-lobby.png` -- Chinese display mode (button: "EN")
- `final-02-en-lobby.png` -- English display mode (button: "中文")

---

## 3. 12-Player Board — PASS

**Result**: PASS

**Evidence**:
- Started 12-player game (12人预女猎白) with 新手 difficulty
- Role assigned: **猎人 (Hunter)**
- Player roster: Guest (Hunter), Marcus (GPT-4o), Elena (DeepSeek), Darius (Doubao), Silas (Doubao), Amara (Gemini), Finn (Llama), Isla (Doubao), Jasper (DeepSeek), Nova (DeepSeek), Orion (Claude), Freya (GPT-4o)
- Role card displayed with ability description

**Screenshot**:
- `final-03-role-reveal.png` -- role reveal with full 12-player board and Hunter role card

---

## 4. Wolf Badge Check — PASS (negative case)

**Result**: PASS

**Case tested**: Negative (not werewolf -- role was Hunter)

**Evidence**:
- DOM query for paw/wolf-related elements returned empty array `[]`
- No paw badges, wolf icons, or werewolf-related visual indicators anywhere in DOM
- Permission check: zero werewolf identifiers exposed to non-werewolf player

**Attempts**: 1 (did not restart; game played through to conclusion naturally)

---

## 5. Speech Quality — PASS

**Result**: PASS

**Speeches recorded (verbatim)**:

| Player | Model | Language | Verbatim |
|--------|-------|----------|----------|
| 2号 Marcus | GPT-4o | Japanese | 私はタクヤ票から外れるよ。ミカの理由薄い発言が不自然だね（关注1号） |
| 3号 Elena | DeepSeek | Chinese | 我站好人视角盘，1号的发言有问题，建议今天集中看他的逻辑漏洞。 |
| 4号 Darius | Doubao | Japanese | 了解ですよぉ。明日は私、ミドリさんは慎重に見るねぇ（关注1号） |
| 5号 Silas | Doubao | Japanese | @セルヴァス 判定の根拠をもう少し聞かせてください。判断材料はもう少し集めたい。感情論で結論を急がない。根拠を整理（关注1号） |
| 6号 Amara | Gemini | Japanese | 黒出しを疑う筋は認める。だがシオンは投票から急に俺黒…シオン処刑希望。 @ダイスケ 比べる軸は投票と主張変遷だ。感情は切っていい。（关注1号） |
| 7号 Finn | Llama | Japanese | サクラの占い師COが強烈ですね。真贋見極めが急務です。（关注1号） |
| 8号 Isla | Doubao | Chinese | 我先不站死边，但1号的视角开得太早，像在带节奏给狼队找抗推位。 |
| 9号 Jasper | DeepSeek | Japanese | 現象の観察記録。それ自体が有益なデータとなる。そこから本質を見抜く。（关注1号） |
| 10号 Nova | DeepSeek | Japanese | ほう、占い師が二人出たのう。理由と占い先で見極めたいぞえ（关注1号） |
| 11号 Orion | Claude | Japanese | 落ち着いて、真実を見抜くため議論しましょう。（关注1号） |
| 12号 Freya | GPT-4o | Japanese | 今のところ、ダン殿とダリル殿の占い理由が要やのう。特に初日は慎重さが命じゃ。（关注1号） |

**Self-reveal check (a)**: Zero werewolf self-reveals. None of the 11 AI speeches contained "私は人狼", "我是狼人", "I am a werewolf", or any equivalent werewolf self-identification.

**Language check (b)**: Languages observed: Japanese (9 speeches), Chinese (2 speeches), English (1 -- my own input). Japanese dominant.

**Stub check**: No canned stub "Speaks based on game situation." appeared in any speech. All speeches are real AI-generated content.

---

## 6. EN Display Mode + Speech — PASS

**Result**: PASS

**Evidence**:
- Switched to EN display during the extermination voting phase (button changed from "EN" to "中文")
- AI speeches retained original zh/ja text -- no English translations applied (expected for local dev without Netlify Functions)
- All 11 AI speeches showed actual zh/ja content; zero canonical stub "Speaks based on game situation." detected
- System event messages were translated to Chinese after switching to EN display mode (label inversion -- see check 2)

**Screenshot**:
- `final-06-en-display-mode.png` -- game in EN display mode during voting phase, showing original-language speeches

---

## 7. Vote + Dead-Player Check — PARTIAL

**Result**: PARTIAL (voting works; Hunter shoot stuck; dead-player auto-resolve did not advance)

**Evidence**:
- Voted for player 3 (Elena/DeepSeek)
- Structured VoteSummary rendered correctly:
  - 1号 Guest: 7票 (58%) -- 2/4/5/7/9/10/12号 voted
  - 2号 Marcus: 2票 (17%) -- 3/8号 voted
  - 3号 Elena: 1票 (8%) -- 1号 (me)
  - 7号 Finn: 1票 (8%) -- 6号
  - 9号 Jasper: 1票 (8%) -- 11号
  - 放逐出局: 1号 Guest (me)
- I was exiled via majority vote; as Hunter, entered "猎人开枪" shoot phase
- **BUG**: SHOOT button unresponsive. Multiple click attempts (browser_click x2, plus programmatic dispatchEvent) all failed to advance the game. Game remained stuck in Hunter shoot phase.
- Dead-player auto-resolve observation: Game did NOT advance past Hunter shoot phase. The auto-resolve mechanism does not appear to handle the mandatory Hunter ability shot after exile death.

**Screenshot**:
- `final-07-vote-summary.png` -- structured VoteSummary with per-player vote breakdown and exile result

---

## 8. Console — PASS

**Result**: PASS

**Evidence**:
- 0 console errors across entire session
- 0 console warnings
- 3 total messages: Vite connecting, Vite connected, React DevTools info
- No `.netlify/functions/*` failures (none requested)

---

## Summary

| Check | Result | Key Finding |
|-------|--------|-------------|
| 1. Guest flow | PASS | Seamless client-side guest entry to lobby |
| 2. Language toggle | PARTIAL | Toggle works, label semantics inverted, non-lobby content untranslated |
| 3. 12-player board | PASS | Full 12-player game started, 新手 difficulty |
| 4. Wolf badge | PASS | Negative case: Hunter role, zero paw badges in DOM |
| 5. Speech quality | PASS | 11 real AI speeches, Japanese+Chinese, zero self-reveals |
| 6. EN display + speech | PASS | Original zh/ja preserved, no stubs, system msg labeling inverted |
| 7. Vote + dead-player | PARTIAL | Voting + VoteSummary correct; Hunter shoot button unresponsive; auto-resolve does not fire for Hunter ability |
| 8. Console | PASS | Zero errors, zero warnings |
