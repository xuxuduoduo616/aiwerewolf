# Cloud TTS Adapter Spike — Adversarial Review

**Reviewer:** aiwerewolf-debugger
**Date:** 2026-07-18
**Reviewed:** `memory/coordination/reports/cloud-tts-adapter-spike.md` + `tts-adapter.types.ts`

---

## 1. Requirement-by-Requirement Findings

### 1.1 No product code changed

`git diff HEAD --stat` shows:
```
src/App.tsx           |  5 +++
src/hooks/useGameState.ts | 61 ++++++++++++++++++++++
```

These are **vote-countdown timer changes**, not TTS changes. The diff content (vote deadline, `VOTE_DURATION_MS`, `computeVoteRemaining`) matches the concurrent `vote-countdown-diagnosis-and-fix` task, which runs in the same wave per the spike card's own declaration. The spike itself created only:
```
?? memory/coordination/reports/cloud-tts-adapter-spike.md
?? memory/coordination/reports/cloud-tts-adapter-spike/
 M memory/coordination/tasks/cloud-tts-adapter-spike.md
```
**Verdict: PASS.** The spike itself touched no product code. The src/ diffs belong to the vote-countdown task.

### 1.2 Types file compiles standalone

`npx tsc --noEmit memory/coordination/reports/cloud-tts-adapter-spike/tts-adapter.types.ts` exits 0 with no errors.
**Verdict: PASS.**

### 1.3 Types file has no imports from src/

The file contains zero `import`, `from`, or `require` statements. The only match for a code-like pattern is `API_KEY` appearing in a comment (`// ... same API_KEY as genai-proxy`). No runtime logic, no network code, no `fetch`, no `process.env` reads.
**Verdict: PASS.**

### 1.4 npm test:run + npm build pass

- `npm run test:run`: 328 passed, 5 skipped, 0 failures (29 test files)
- `npm run build`: tsc + vite build succeed, producing all expected bundles
**Verdict: PASS.**

---

## 2. Capability Matrix Verification

### 2.1 Primary recommendation: Gemini 2.5 Flash TTS — VERIFIED

| Spike Claim | Official Source | Match? |
|---|---|---|
| Model ID: `gemini-2.5-flash-preview-tts` | https://ai.google.dev/gemini-api/docs/speech-generation | MATCH |
| Endpoint: `POST .../v1beta/interactions` | Same page, "Interactions API" | MATCH |
| Pricing: $0.50/1M input, $10.00/1M output | https://ai.google.dev/gemini-api/docs/pricing | MATCH |
| Free tier: "Free of charge" | Same pricing page | MATCH |
| 30 prebuilt voices | Speech-generation docs: "30 prebuilt voice options" | MATCH |
| Audio: PCM WAV 24kHz 16-bit mono | Speech-generation docs code examples | MATCH |
| No streaming (2.5 Flash TTS) | Docs: "streaming supported for 3.1+" | MATCH |
| Multi-speaker up to 2 | Docs: "assign speaker names" | MATCH |
| Auth: `x-goog-api-key` header | GenAI API docs standard auth pattern | MATCH |
| Context: 32k tokens | Docs: "32k context window limit" | MATCH |
| 25 tokens/sec audio | Pricing page footnote | MATCH |

### 2.2 Gemini 3.1 Flash TTS — VERIFIED

| Spike Claim | Official Source | Match? |
|---|---|---|
| Model ID: `gemini-3.1-flash-tts-preview` | Speech-generation docs model list | MATCH |
| Pricing: $1.00/1M input, $20.00/1M output | https://ai.google.dev/gemini-api/docs/pricing | MATCH |
| Free tier: Free of charge | Same page | MATCH |
| Streaming: Yes | Docs: "streaming supported for 3.1+" | MATCH |

### 2.3 Cloud Text-to-Speech — FACTUAL ERRORS

| Spike Claim | Actual (official pricing page) | Correct? |
|---|---|---|
| WaveNet: $4.00/1M chars | **$16.00/1M chars** | **WRONG (4x understated)** |
| Chirp 3 HD: $30/1M chars | **$100.00/1M chars** | **WRONG (3.3x understated)** |
| WaveNet free tier: 4M chars/mo | **1M chars/mo** | **WRONG** |
| Standard: $4.00/1M chars | $4.00/1M chars | OK |
| Standard free tier: 4M chars/mo | 4M chars/mo | OK |

**Source issue:** The spike says prices were "confirmed via WebSearch cross-reference (costbench.com, diyai.io, xpay.sh)" — third-party aggregators, NOT the official pricing page at https://cloud.google.com/text-to-speech/pricing. The official page clearly shows WaveNet at $16/1M and Chirp 3 HD at $100/1M. This is a methodology failure: the spike should have cited the primary official source, not third-party mirrors.

### 2.4 aicodemirror — CORRECTLY MARKED

"尚未确认 — 无公开 TTS 文档" with explanation: homepage 403, zero search results for TTS. Honest gap reporting. **PASS.**

### 2.5 deepseek — CORRECTLY MARKED

"无 TTS 能力 — official docs list only text chat/completion features" with specific reference to https://api-docs.deepseek.com/. **PASS.**

---

## 3. Cost Analysis Sanity Check

### 3.1 Per-speech token estimate

The spike uses **150 audio tokens per speech** (150/25 = 6 seconds audio per ~66-char speech). This is a reasonable middle-range estimate at natural speaking rate. **PASS.**

### 3.2 Gemini 2.5 Flash TTS arithmetic

- 9p: 50 speeches x 150 tokens = 7,500 output tokens. 7,500 / 1M x $10.00 = **$0.075**. Input: 819 / 1M x $0.50 = $0.00041. Total: **$0.07541**. Matches the detailed analysis. **PASS.**
- 12p: 70 speeches x 150 = 10,500 tokens. 10,500 / 1M x $10.00 = **$0.105**. Matches. **PASS.**

### 3.3 Executive summary inconsistency

The exec summary states: **"$0.01--0.03/game for first-generation TTS"**. The detailed cost analysis (section 4.2) shows **$0.08/9p game and $0.11/12p game**.

Neither figure matches the exec summary:
- Without free tier: $0.08/9p, $0.11/12p
- With free tier: $0.00 (free)
- The $0.01--0.03 range appears to be the **existing text-AI budget range**, not the TTS cost

**This is misleading.** The exec summary should state the actual figures from the detailed analysis, or explicitly note that the free tier makes first-gen effectively free during the preview period. **FAIL.**

### 3.4 Section 7 comparison table — Chirp 3 HD costs

The comparison table says:

| Chirp 3 HD 9p | Chirp 3 HD 12p |
|---|---|
| $0.10 | $0.14 |

At actual $100/1M pricing (not $30/1M):
- 9p: 3,275 chars x $100 / 1M = **$0.33**
- 12p: 4,585 chars x $100 / 1M = **$0.46**

These are off by 3.3x. **FAIL.**

### 3.5 Budget guard assessment

At $0.08/game, $1/day supports ~12 first-gen games. Still within the $1/day guard. This part of the analysis is sound regardless of the errors above. **PASS.**

### 3.6 Worst-case figures

50 calls/9p, 70 calls/12p. Speech counts are consistent with the speech library analysis (8,521 entries, ~200-300 unique per role). **PASS.**

---

## 4. Cache Design

### 4.1 Cache key comprehensiveness

`SHA-256(text) + ":" + language + ":" + voiceId + ":" + rate + ":" + modelVersion` — covers all dimensions that could produce different audio output:

- text hash: deterministic, collision-resistant ✓
- language: separate field for multi-lang replay ✓
- voiceId: provider voice ✓
- rate: affects audio content ✓
- modelVersion: prevents cross-version cache corruption ✓

**PASS.**

### 4.2 Speech library reuse

The report explicitly references the 8,521-entry speech corpus, estimates ~200-300 unique lines per role as primary reuse targets, and notes sanitization produces deterministic strings for caching. The storage estimate (~30MB for 2,000 cached entries) is reasonable. **PASS.**

### 4.3 Post-sanitization corpus with fixed entries

The report mentions "after sanitization (roster-guard name substitution, translation)" produces deterministic strings. The types file explicitly says `text` is "final displayed text, post translation + roster guard." This correctly identifies that TTS input is post-processing text, which makes caching effective. **PASS.**

---

## 5. Cloud-via-Netlify-Function Architecture

### 5.1 Key isolation

The design routes all cloud TTS calls through `POST /.netlify/functions/tts-adapter`. The API key is read from `process.env.GEMINI_API_KEY` only — never sent to the frontend. This mirrors the existing `provider-adapter.cjs` isolation pattern. **PASS.**

### 5.2 Interface completeness

Request fields: `text`, `language`, `voiceId`, `rate`, `requestId`, `abortSignal` — all required fields present. Response contract: `audioData`, `audioFormat`, `durationSeconds`, `cacheHit`, `costEstimateUsd`, error taxonomy (10 categories). **PASS.**

### 5.3 Routing chain

browser-default -> cloud-opt-in -> fallback cloud->browser->text-only. Per-speech granularity. **PASS.**

---

## 6. Follow-Up Card Draft

### 6.1 Scope and paths

The draft `cloud-tts-gemini-mvp` card has:
- Clear objective (implement Gemini TTS as opt-in premium tier)
- Allowed paths: `src/services/speechAudio.ts`, `src/services/ttsAdapter.ts`, `netlify/functions/tts-adapter.cjs`, `src/App.tsx` — all reasonable for the implementation scope
- Do-not-change: `provider-adapter.cjs`, `genai-proxy.cjs`, `gameEngine.ts`, `ai/**`, `package.json`
- Depends on `browser-tts-mvp` (reads its card/report)

**PASS.**

### 6.2 Acceptance criteria

10 AC items covering: toggle behavior, key isolation, cache verification, budget guard, fallback chain, error handling, voice determinism, tests, baseline pass. Actionable and verifiable. **PASS.**

### 6.3 Format compliance

The draft lives as a report section (not a `tasks/` file), marked DRAFT with "do not pull until owner approves." **PASS.**

---

## 7. "尚未确认" Discipline

| Provider | Spike Statement | Accurate? |
|---|---|---|
| aicodemirror | "尚未确认 — 无公开 TTS 文档. Homepage returned 403. Zero search results." | YES |
| deepseek | "无 TTS 能力 — official docs list only text chat/completion features" | YES |

No "probably", "should", or "likely" statements found about unverified capability. The spike explicitly states its uncertainty where docs are absent. **PASS.**

---

## 8. Summary of Defects

| # | Severity | Defect | Location |
|---|---|---|---|
| 1 | HIGH | Cloud TTS WaveNet pricing: $16/1M, not $4/1M | Section 2 (capability matrix) |
| 2 | HIGH | Cloud TTS Chirp 3 HD pricing: $100/1M, not $30/1M | Section 2 (capability matrix) |
| 3 | MEDIUM | Cloud TTS WaveNet free tier: 1M chars/mo, not 4M | Section 2 (capability matrix) |
| 4 | MEDIUM | Exec summary says $0.01-0.03/game; detailed analysis shows $0.08/game | Section 1 (exec summary) vs Section 4.2 |
| 5 | LOW | Section 7 Chirp 3 HD cost/game figures wrong (derive from pricing error) | Section 7 (comparison table) |

**Root cause:** The spike used third-party pricing aggregators (costbench.com, diyai.io, xpay.sh) for Cloud TTS pricing instead of the official source at https://cloud.google.com/text-to-speech/pricing. The official page shows different (higher) prices for WaveNet and Chirp 3 HD.

**Impact on recommendation:** The errors understate Cloud TTS costs, making Cloud TTS appear cheaper than it actually is. However, the spike's recommendation correctly advises AGAINST Cloud TTS (due to auth complexity, not cost), so the pricing errors do not weaken the recommendation — if anything, the corrected higher prices strengthen it.

---

## 9. Repair List

1. **Fix Cloud TTS pricing in capability matrix (Section 2):**
   - WaveNet: change `$4.00 / 1M chars` to `$16.00 / 1M chars`
   - Chirp 3 HD: change `$30 / 1M chars` to `$100.00 / 1M chars`
   - WaveNet free tier: change `4M chars/mo` to `1M chars/mo`
   - Source: update from third-party aggregators to the official page https://cloud.google.com/text-to-speech/pricing (accessed 2026-07-18)

2. **Fix Section 3.2 (Cloud TTS analysis) Chirp 3 HD cost estimate:**
   - Change "~$0.10/game at 3,275 chars (9p)" to "~$0.33/game at 3,275 chars (9p)"

3. **Fix Section 7 comparison table:**
   - Chirp 3 HD 9p: change `$0.10` to `$0.33`
   - Chirp 3 HD 12p: change `$0.14` to `$0.46`

4. **Fix executive summary cost figure (Section 1):**
   - Replace `$0.01--0.03/game for first-generation TTS` with the actual paid-tier figure (`$0.08--0.11/game`), OR state that the free tier makes it `$0.00/game during the preview period`, OR match the detailed analysis exactly

---

VERDICT: FAIL
