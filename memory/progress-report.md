# AI Werewolf ROADMAP 与剩余工作

**Canonical owner:** coordinator。当前已验证状态见
[coordination/PROJECT_STATE.md](coordination/PROJECT_STATE.md)（本文件不重复维护发布身份或测试基线）。

**更新日期:** 2026-07-27（产品任务池已发布、完成生产验收，并由 TC-008 R4 完成 evidence-only closeout）

## 当前派发状态

`coordination/tasks/` 中没有可直接派发的 active card；其中内容是历史任务记录。
本次 owner-approved run 位于 `.codex-coordinator/runs/20260723T023929Z-b2258e1d/`。
TC-001 至 TC-007、TC-009、TC-012、TC-011 R13 和 TC-008 R4 均有 sealed
independent PASS。当前计划任务池与 closeout 队列为空。

## 本轮已完成范围

| Area | Result | Current boundary |
|---|---|---|
| Memory governance | TC-001 PASS | 唯一/不确定历史资料保留；仅删除有精确哈希证据的重复 Function aliases。 |
| Payments | TC-002 PASS + production replay | 生产 payment POST fail-closed；真实 PSP 未接入，订单/余额正确性 `未验证`。 |
| Lobby operations | TC-003 PASS R3 | Activity、Faction Support、Battle Pass 和 Wolf Village Preview 为本地展示状态；premium/real rewards 禁用。 |
| Responsive shell | TC-004 PASS R2 | `390x844`、`768x1024`、`1440x900`、safe area、44px targets、Dialog/Tab/focus restore 通过。 |
| Responsive game room | TC-005 R19 / tester R11 PASS | R17 transitions 与 R19 nearest-aligned log follow 为最终实现；R18 timing compensation 已被取代。 |
| Application integration | TC-006 PASS R2 | 单人启动流和 utility surfaces 可用；多人/房间/高级能力禁用。 |
| English interface | TC-009 PASS R4 | 应用自有 UI 文案为英文；动态用户/AI/历史/artwork 内容保留来源语义。 |
| Integrated acceptance | TC-007 PASS R2 | `111 total = 93 nominal + 18 effective-200%-zoom`，payment/copy/art/rule/geometry gates 通过。 |
| Function packaging | TC-012 PASS R1 | `supabase-admin` generic 405 contract 通过；AC-05 由精确生产 replay 闭合。 |
| Production release | TC-011 PASS R13 | Exact commit/deploy、Actions、14/14 bytes、Functions/payment guards 和直接生产 Chrome matrix 通过。 |
| Final closeout | TC-008 PASS R4 | R3 artifact identity FAIL 经两行 metadata repair 修复；AC-01..12 独立复跑通过。 |

## Owner 后续工作（不属于当前任务池）

1. **Credential rotation and local cleanup:** owner 轮换凭据并清理本地敏感/auth artifacts；不得输出值，也不得使用宽泛 staging。
2. **Production order/balance reconciliation:** owner 主导核对历史订单与余额。当前正确性为 `未验证`；不得由本轮直接修改生产数据库。
3. **Real payment planning:** 只有在 PSP、商户认证、server-only secrets/certificates、signed webhooks、idempotency、exactly-once ledger、退款/争议和 reconciliation 方案获批后才能重新开放。

## 待重新规划（不是现成任务卡）

| # | Task ID | 优先级 | 说明 |
|---|---|---|---|
| 1 | `speech-placeholder-resolution` | P1 | 显示层仍可能出现 "that player" 等占位符，需单独验证并解析为座位号。 |
| 2 | `zh-display-language-purity` | P1 | 动态中文发言模式的 fallback 语言纯度不属于 English application chrome 范围。 |
| 3 | `katakana-entity-follow-up` | P2 | 片假名实体清理属于语料/表达层，不属于 TC-009 应用 UI 文案。 |
| 4 | `cloud-tts-implementation` | P2 | Gemini TTS Netlify 适配层；外部服务配置状态 `未验证`。 |
| 5 | `visibleText-dead-code-cleanup` | P3 | `useGameState` 中未消费导出的独立清理。 |

## 长期路线约束

- 当前阶段仍是单机 AI 对局加社交基础；真人联机必须遵守 ADR-003 的服务端权威、秘密信息隔离、RLS、幂等和恢复约束。
- 不得把本地运营展示、disabled room actions 或 future multiplayer copy 描述为已上线能力。
- 游戏规则继续由 `gameEngine.ts`、`beliefTracker` 和 `actionSelector` 决定；LLM 只负责表达。

## 历史说明

旧 task cards、reports、handoffs、失败报告和被 supersede 的 revision 均为不可变历史证据，不代表当前状态。当前状态只认 [coordination/PROJECT_STATE.md](coordination/PROJECT_STATE.md)；本次 run 的最终生产 verdict 只认 TC-011 R13/release evidence R6，最终 closeout verdict 只认 TC-008 tester R4 PASS。
