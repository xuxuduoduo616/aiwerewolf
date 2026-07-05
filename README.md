# 🐺 AI Werewolf · AI 狼人杀

一款沉浸式 AI 狼人杀网站：一名真人玩家与多个 AI 玩家同台竞技。黑白灰素描风格，中英文双语，严格遵循网易狼人杀规则。

> AI 玩家的发言经由 [aiwolf.org](https://aiwolf.org) 国际大赛对局记录蒸馏训练，配合信念推理引擎，实现接近真人的局内推理与角色扮演。

## ✨ 特性

- **两种板子**：9 人标准场（3民3狼+预女猎）、12 人场（4民4狼+预女猎白）
- **15 种 AI 性格**：悍跳狼、倒钩狼、深水狼、正统预言家、花板子预言家、保守/激进女巫等
- **三档难度**：新手（AI 暴露漏洞）、进阶（标准策略）、高手（接近最优）
- **严格规则**：顺时针发言、全场遗言、发言倒计时、女巫不自救、猎人被毒不开枪
- **狼队夜聊**：刀口、悍跳、冲锋、倒钩、补位策略标签
- **账号系统**：邮箱 OTP 登录 + 战绩记录（胜率、常用角色）；游客模式本地存储
- **发言库 fallback**：即使 AI 服务不可用，游戏也能流畅进行

## 🏗️ 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vite + React 18 + TypeScript + Tailwind CSS |
| AI 推理 | Gemini 2.0 Flash（免费层，服务端代理）+ 蒸馏发言库 |
| 托管 | Netlify（免费层）|
| 认证/数据库 | Supabase Auth（邮箱 OTP）+ Postgres |

## 🧠 AI 架构（三层）

```
Layer 1 — BeliefTracker（信念追踪，纯 TS）
  └── 每回合更新每位玩家对他人的可疑度 (0–1)
Layer 2 — 发言库（从 aiwolf.org 蒸馏 11,449 条发言）
  └── 按角色/场景匹配真实发言模板
Layer 3 — Gemini 润色（可选 LLM，失败自动降级）
  └── 根据局势生成个性化中文发言
```

**关键设计**：Layer 1 决定行动目标，Layer 2/3 只负责发言——防止 AI 幻觉出未验证的信息。

## 🚀 本地开发

```bash
npm install
npm run dev          # http://localhost:5173（AI 使用 fallback 发言）
npm run test:run     # 运行游戏引擎单元测试
npm run build        # 生产构建
```

> 本地 `npm run dev` 不运行 Netlify Functions，AI 使用发言库 fallback。
> 要测试真实 Gemini，用 `netlify dev` 并配置 `API_KEY`。

## 🔑 环境变量

复制 `.env.example` 到 `.env.local`：

| 变量 | 用途 | 获取 |
|------|------|------|
| `API_KEY` | Gemini API（服务端）| https://aistudio.google.com/apikey |
| `VITE_SUPABASE_URL` | Supabase 项目 URL | Supabase Dashboard |
| `VITE_SUPABASE_ANON_KEY` | Supabase 匿名 key | Supabase Dashboard |
| `ALLOWED_ORIGIN` | CORS 白名单（生产）| 你的域名 |

## 📦 部署到 Netlify

1. 推送代码到 GitHub
2. Netlify → Import project → 选择仓库
3. 构建设置自动读取 `netlify.toml`
4. Site settings → Environment variables 添加上述变量
5. Supabase 数据库设置见 [`docs/supabase-setup.md`](docs/supabase-setup.md)

## 📊 数据采集

```bash
python3 scripts/scrape_aiwolf.py   # 从 aiwolf.org 采集对局并构建发言库
```

## 🔒 安全

- API key 仅存于服务端 Netlify Function，绝不暴露到前端
- Supabase RLS 强制用户只能访问自己的数据
- AI 代理含限流（30 req/min/IP）、CORS 白名单、输入验证、模型白名单

## 📁 项目结构

```
src/
├── App.tsx              # UI 编排层
├── hooks/               # useAuth, useRecords, useGameState
├── ai/                  # beliefTracker, actionSelector, geminiAdapter, aiOrchestrator
├── services/            # speechLibrary, aiStyles, supabaseClient
├── data/                # 蒸馏发言库 JSON
├── components/          # PlayerCard, ActionBar, WolfChannel, ...
├── gameEngine.ts        # 核心规则（+ 单元测试）
└── constants.ts         # 板子配置、角色、黑话
netlify/functions/       # genai-proxy.js（Gemini 代理）
scripts/                 # scrape_aiwolf.py
```

## 📝 License

私有项目 · Mingzhe Xu 2026
