---
name: project-overview
description: aiwerewolf 的当前产品范围、架构、代码地图和工程约束
metadata:
  type: project
---

# AI Werewolf 项目概览

## 产品目标

构建一款沉浸式 AI 狼人杀网站：一名真人与 AI 玩家完成完整对局。产品采用黑白灰
手绘村庄风格；application-owned interface chrome 使用英文。用户输入、AI/player
发言或聊天、历史记录和 artwork text 保留各自内容来源，不属于 UI 文案纯度断言。
该边界已由 TC-009 R4、TC-007 R2 和 TC-011 R13 的 static/runtime allowlist、
negative controls 和生产 browser matrix 验证。核心差异不是让大模型自由编规则，而是让规则引擎和信念/行动层
决定局势，再由仓库内按角色分类的本地发言库和 Gemini 润色表达；发言库的外部来源
与许可状态为 `未验证`。

Evidence: `.codex-coordinator/runs/20260723T023929Z-b2258e1d/reports/TC-009/tester-r4.md`
and `.codex-coordinator/runs/20260723T023929Z-b2258e1d/reports/TC-011/tester-r13.md`.

首阶段支持两种板型：

- 9 人标准场：3 民、3 狼、预言家、女巫、猎人。
- 12 人预女猎白：4 民、4 狼、预言家、女巫、猎人、白痴。

## 当前阶段

当前阶段、测试基线与部署状态见
[coordination/PROJECT_STATE.md](coordination/PROJECT_STATE.md)（唯一事实源，
本文件只记录稳定架构事实）。

## 技术架构

| 层 | 实现 | 责任 |
| --- | --- | --- |
| Web UI | Vite + React 18 + TypeScript + Tailwind | 登录、选板、座位桌、日志、夜间操作、战绩面板。 |
| 游戏规则 | `src/gameEngine.ts` + `src/hooks/useGameState.ts` | 阶段机、夜晚结算、投票、死亡、胜负、猎人和女巫规则。 |
| AI 决策 | `src/ai/beliefTracker.ts` + `actionSelector.ts` | 可解释的怀疑度和行动候选，不把规则判断交给 LLM。 |
| AI 表达 | `aiOrchestrator.ts` + `speechLibrary.ts` + Gemini | 角色人设、发言库、狼队夜聊、Gemini 润色和失败回退。 |
| 后端代理 | `netlify/functions/genai-proxy.cjs` | Gemini API key 隔离、CORS、输入长度、模型白名单和每实例限流。 |
| 账户和战绩 | Supabase Auth + Postgres | 邮箱 OTP、`profiles`、`game_records`、RLS、游客本地记录。 |

源码中的 Gemini 默认模型是 `gemini-2.5-flash`。本地 Vite 场景不会调用生产代理，
AI 会回退到发言库，适合无密钥开发。生产 safe-method guard 已验证；外部 provider
功能可用性和可靠性仍为 `未验证`。

## 代码地图

- `src/App.tsx`：UI 编排和阶段界面。
- `src/hooks/useGameState.ts`：客户端游戏流程主状态机。
- `src/gameEngine.ts`：可单测的纯规则和对局摘要函数。
- `src/ai/aiOrchestrator.ts`：唯一应继续使用的 AI 对外入口。
- 旧 `src/services/aiPlayer.ts` 实现已删除；活动 AI 入口仍是 `src/ai/aiOrchestrator.ts`，不得重新引入旧路径。
- `src/data/*_speeches.json`：6 个按角色拆分的本地发言文件，Git 观察总计 8,521 条；外部语料来源与许可状态未验证。
- `src/hooks/useAuth.ts`、`src/services/supabaseClient.ts`：OTP、30 天本地会话恢复、
  档案和战绩访问。
- `docs/supabase-init.sql`、`docs/supabase-setup.md`：Supabase 初始化和 RLS 操作说明。
- `netlify.toml`：构建、SPA fallback、函数路径、缓存和基础安全响应头。

## 已实现的用户可见能力

- 邮箱验证码登录、游客试玩、30 天本地会话恢复、游戏战绩和胜率统计。
- 两种板型、三档难度、角色描述、昼夜阶段、轮流发言、投票、遗言、胜负结算。
- 预言家查验、女巫知晓刀口/救药/毒药、猎人开枪、白痴失票、狼队夜聊。
- 15 种 AI 角色人设，以及难度对行动准确度、表达质量和狼队协作的影响。
- 英文 application chrome、响应式三档 shell/game room、safe-area/keyboard/Dialog
  支持，以及保留来源语义的用户/AI/历史动态内容。
- 活动、阵营应援、通行证和 Wolf Village Preview 本地展示；单人 setup 可用，
  multiplayer、room actions、premium purchase 和 real rewards 保持不可用。
- 商品和余额可读，但 purchase controls 不可用；生产 empty unauthenticated payment
  POST 已验证为 HTTP 503 `PAYMENTS_NOT_CONFIGURED`，订单和余额正确性仍为 `未验证`。

These accepted implementation boundaries are covered by
`.codex-coordinator/runs/20260723T023929Z-b2258e1d/reports/TC-002/tester-r1.md`,
`reports/TC-003/tester-r3.md`, `reports/TC-006/tester-r2.md`,
`reports/TC-007/tester-r2.md`, and `reports/TC-011/release-evidence-r6.md`
under the same run root.

## 外部配置与安全边界

- 必需环境变量：`API_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；生产
  CORS 还应设置 `ALLOWED_ORIGIN`。
- Supabase 匿名/发布 key 可在前端使用，但 `service_role` key 绝不可进入代码或 Git。
- `profiles` 和 `game_records` 的 RLS 需在 Supabase Dashboard/SQL Editor 实际执行并
  验证；源码中的 SQL 只是声明，不等于已在线生效。当前生产 RLS 状态为 `未验证`。
- 邮箱 OTP 模板必须使用 `{{ .Token }}`。当前 Dashboard 模板状态为 `未验证`。

## 开发与验证

```bash
npm run dev       # Vite；Gemini 使用发言库回退
npm run test:run  # 全量单元/集成测试（基线见 PROJECT_STATE）
npm run build     # TypeScript + Vite 生产构建
```

变更前先按 `memory/INDEX.md` 的阅读顺序读取共享记忆；读写规则见
`memory/MEMORY_CONTRACT.md`。
