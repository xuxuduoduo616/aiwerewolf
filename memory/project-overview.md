---
name: project-overview
description: aiwerewolf 的当前产品范围、架构、代码地图和工程约束
metadata:
  type: project
---

# AI Werewolf 项目概览

## 产品目标

构建一款沉浸式 AI 狼人杀网站：一名真人与 AI 玩家完成完整对局。产品面向中文
狼人杀体验，采用黑白灰手绘村庄风格，同时保留中英混合的界面文案和发言库回退。
核心差异不是让大模型自由编规则，而是让规则引擎和信念/行动层决定局势，再由真实
对局蒸馏发言库和 Gemini 润色表达。

首阶段支持两种板型：

- 9 人标准场：3 民、3 狼、预言家、女巫、猎人。
- 12 人预女猎白：4 民、4 狼、预言家、女巫、猎人、白痴。

## 当前阶段

项目处于 **v1 核心可玩完成后的打磨与上线验证阶段**。2026-07-11 本地验证：
Vitest 14/14 通过，生产构建成功。线上 Netlify、Supabase RLS、邮件模板和环境
变量不能从本地源码自动证明，必须作为远程人工验证项处理。

## 技术架构

| 层 | 实现 | 责任 |
| --- | --- | --- |
| Web UI | Vite + React 18 + TypeScript + Tailwind | 登录、选板、座位桌、日志、夜间操作、战绩面板。 |
| 游戏规则 | `src/gameEngine.ts` + `src/hooks/useGameState.ts` | 阶段机、夜晚结算、投票、死亡、胜负、猎人和女巫规则。 |
| AI 决策 | `src/ai/beliefTracker.ts` + `actionSelector.ts` | 可解释的怀疑度和行动候选，不把规则判断交给 LLM。 |
| AI 表达 | `aiOrchestrator.ts` + `speechLibrary.ts` + Gemini | 角色人设、发言库、狼队夜聊、Gemini 润色和失败回退。 |
| 后端代理 | `netlify/functions/genai-proxy.js` | Gemini API key 隔离、CORS、输入长度、模型白名单和每实例限流。 |
| 账户和战绩 | Supabase Auth + Postgres | 邮箱 OTP、`profiles`、`game_records`、RLS、游客本地记录。 |

Gemini 当前默认模型是 `gemini-2.5-flash`。本地 Vite 场景不会调用生产代理，AI
会回退到发言库，适合无密钥开发。

## 代码地图

- `src/App.tsx`：UI 编排和阶段界面。
- `src/hooks/useGameState.ts`：客户端游戏流程主状态机。
- `src/gameEngine.ts`：可单测的纯规则和对局摘要函数。
- `src/ai/aiOrchestrator.ts`：唯一应继续使用的 AI 对外入口。
- `src/services/aiPlayer.ts`：未被导入的旧实现，保留待明确清理，不得作为新功能基础。
- `src/data/*_speeches.json`：按角色拆分的蒸馏发言库；摘要统计为 11,449 条。
- `src/hooks/useAuth.ts`、`src/services/supabaseClient.ts`：OTP、30 天本地会话恢复、
  档案和战绩访问。
- `docs/supabase-init.sql`、`docs/supabase-setup.md`：Supabase 初始化和 RLS 操作说明。
- `netlify.toml`：构建、SPA fallback、函数路径、缓存和基础安全响应头。

## 已实现的用户可见能力

- 邮箱验证码登录、游客试玩、30 天本地会话恢复、游戏战绩和胜率统计。
- 两种板型、三档难度、角色描述、昼夜阶段、轮流发言、投票、遗言、胜负结算。
- 预言家查验、女巫知晓刀口/救药/毒药、猎人开枪、白痴失票、狼队夜聊。
- 15 种 AI 角色人设，以及难度对行动准确度、表达质量和狼队协作的影响。
- 黑白灰动态村庄背景、座位桌、倒计时、发言高亮、获胜画面和双语相关开关。

## 外部配置与安全边界

- 必需环境变量：`API_KEY`、`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`；生产
  CORS 还应设置 `ALLOWED_ORIGIN`。
- Supabase 匿名/发布 key 可在前端使用，但 `service_role` key 绝不可进入代码或 Git。
- `profiles` 和 `game_records` 的 RLS 需在 Supabase Dashboard/SQL Editor 实际执行并
  验证；源码中的 SQL 只是声明，不等于已在线生效。
- 邮箱 OTP 模板必须使用 `{{ .Token }}`。本地无法确认 Dashboard 当前模板。

## 开发与验证

```bash
npm run dev       # Vite；Gemini 使用发言库回退
npm run test:run  # 14 个当前单元/集成测试
npm run build     # TypeScript + Vite 生产构建
```

变更前先阅读 `memory/coordination/PROJECT_STATE.md`。完整待办、测试缺口、近期提交
和优先级在 `memory/progress-report.md`。
