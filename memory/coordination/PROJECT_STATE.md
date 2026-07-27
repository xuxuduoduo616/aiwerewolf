# Project Coordination State

**Last verified:** 2026-07-27（TC-008 R4 对精确发布与最终报告完成独立 closeout PASS）
**Project phase:** Stage 1 — 单机 AI 对局加社交基础设施，暂不支持真人联机对局。长期路线见 `memory/decisions/ADR-003-scalable-social-multiplayer-roadmap.md`。
**Engineering phase:** 计划内产品实现已经发布并完成直接生产验收；TC-008 R4 已独立 PASS，evidence-only closeout 完成。

## Verified Baselines

| Surface | Verified state | Evidence |
|---|---|---|
| Production identity | `HEAD`、`main`、`origin/main` 与生产 `commit_ref` 均为 `aec5c2a1be9154041ba145e031cfbfa86808ce82`；GitHub Actions `30204225961` 成功；Netlify deploy `6a660d745602a026c8001bc8` 为 `ready` / `production` / `main`，发布于 `2026-07-26T13:37:18.327Z`。 | `.codex-coordinator/runs/20260723T023929Z-b2258e1d/reports/TC-011/release-evidence-r6.md` |
| Clean release gates | 502 tests passed / 5 skipped；TypeScript 无诊断；guarded 1,615-module / 5-Function build、memory validate/audit、范围/空白/敏感值检查通过；生产静态文件 14/14 与 clean build 字节一致。 | `reports/TC-011/release-evidence-r6.md` in the run root |
| Integrated acceptance matrix | `111 total = 93 nominal + 18 effective-200%-zoom` application rows；另有 six marquee Range rows、24 geometry-closure rows、143 screenshots 和 31/31 art/font/binary hash pairs。该集成矩阵是发布前完整覆盖，不冒充最终生产行。 | `reports/TC-007/tester-r2.md` |
| Responsive game room | TC-005 R19 / tester R11 PASS：9/12 人 desktop/mobile/tablet、desktop-origin transitions、room-owned wheel、responsive scroll preservation，以及 nearest-aligned log follow 均通过；R18 timing compensation 不是最终实现。 | `reports/TC-005/tester-r11.md` |
| Production browser | TC-011 R13 以真实 Turnstile 和原生 Guest Trial 直接覆盖生产 Lobby、9/12 人游戏、resize/log/wheel/final state、Shop、运营页、utility routes 与错误/资源/布局检查。 | `reports/TC-011/tester-r13.md` |
| Production Functions | 五个 Function 路径可达；`supabase-admin` GET/empty POST/OPTIONS 为精确 405 generic guard；empty unauthenticated payment POST 为精确 HTTP 503 `{"code":"PAYMENTS_NOT_CONFIGURED"}`；TC-012 AC-05 由生产 replay 闭合。 | `reports/TC-011/release-evidence-r6.md`; `reports/TC-012/tester-r1.md` |

## Owner-Approved Release Run

| Card | Current verified result | Evidence |
|---|---|---|
| `TC-001` | PASS；保守记忆治理和精确哈希重复清理完成。 | `reports/TC-001/tester-r2.md` |
| `TC-002` | PASS；支付在 auth/order/wallet/provider/network mutation 前 fail closed。 | `reports/TC-002/tester-r1.md` |
| `TC-003` | PASS R3；运营页为用户隔离的本地展示状态，禁用控件达到 44px 且 effect-free。 | `reports/TC-003/tester-r3.md` |
| `TC-004` | PASS R2；三档 responsive shell、safe area 和 Dialog focus lifecycle 通过。 | `reports/TC-004/tester-r2.md` |
| `TC-005` | PASS R19 / tester R11；最终采用 R17 transition behavior 与 R19 nearest-aligned log follow。 | `reports/TC-005/tester-r11.md` |
| `TC-006` | PASS R2；单人启动流、lobby launchers 和八个 utility destinations 通过。 | `reports/TC-006/tester-r2.md` |
| `TC-009` | PASS R4；application-owned chrome 为英文，动态内容边界保持 provenance-bound。 | `reports/TC-009/tester-r4.md` |
| `TC-007` | PASS R2；完整集成矩阵 `111 = 93 + 18` 及 payment/copy/art/rule/geometry gates 通过。 | `reports/TC-007/tester-r2.md` |
| `TC-012` | PASS R1；`supabase-admin` packaging repair 独立通过，AC-05 后由精确生产 replay 闭合。 | `reports/TC-012/tester-r1.md`; `reports/TC-011/release-evidence-r6.md` |
| `TC-011` | PASS R13；精确发布身份、HTTP/Functions、字节一致和直接生产浏览器矩阵闭合。 | `reports/TC-011/tester-r13.md`; `reports/TC-011/release-evidence-r6.md` |
| `TC-008` | PASS R4；R3 final-report identity FAIL 由精确两行 metadata repair 修复，独立 tester 复跑 AC-01..12 全部通过。 | `reports/TC-008/tester-r4.md`; `reports/TC-008/tester-evidence-r4/verification-summary.md` |

Paths shown without the `.codex-coordinator/...` prefix are relative to run root `.codex-coordinator/runs/20260723T023929Z-b2258e1d/`.

## Current Product Boundaries

- Application-owned interface chrome is English. User-authored content, AI/player speech or chat, stored historical text, and artwork text remain excluded from that assertion.
- Single-player is the only enabled game mode. Multiplayer, Create/Join/Spectate, premium purchase, and real rewards remain unavailable and effect-free.
- Activity, Faction Support, Battle Pass, and Wolf Village Preview use versioned, user-isolated local presentation state; claims/contributions grant no wallet, backend, or production-asset authority.
- Production payment remains unavailable. Empty unauthenticated POST returns HTTP 503 with exact `{"code":"PAYMENTS_NOT_CONFIGURED"}` before privileged or mutation work; products and balances remain readable and purchase controls remain disabled.

## External And Data Status

- External AI/provider functional availability and reliability beyond observed UI fallback behavior: `未验证`.
- Current production orders, wallet balances, reconciliation correctness, Supabase RLS/data, backups, and email-template configuration: `未验证`.
- Current credential validity/rotation and cleanup of local sensitive/auth artifacts: `未验证`.
- Real PSP merchant onboarding, credentials/certificates, callbacks, signed webhooks, idempotent ledger, tax, refunds, chargebacks, disputes, settlement, and reconciliation readiness: `未验证`.
- Physical-device safe areas and browser engines beyond verified Chrome/Chromium coverage: `未验证`.

## Remaining Owner Or Coordinator Work

1. Rotate credentials and clean local sensitive/auth artifacts without exposing values or using broad staging.
2. Perform owner-led production order/balance reconciliation; this closeout must not mutate production data.
3. Reopen payments only after a separately approved PSP, webhook, idempotency, ledger, reconciliation, refund/dispute, security, monitoring, and rollout plan.

## Coordinator Rules

- No future deploy, push, or external-service mutation without owner approval and the applicable deployment gate.
- Worktree dispatch starts from a clean recorded Git baseline; only independent tester-PASS patches may be integrated.
- Never place secrets, raw transcripts, auth captures, or private session history in shared memory or routed evidence.
- Current state belongs only in this file; roadmap, architecture, decisions, and historical evidence keep their separate canonical owners.
