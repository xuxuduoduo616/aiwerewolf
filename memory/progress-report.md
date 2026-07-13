# AI Werewolf 进度与风险报告

**更新日期：** 2026-07-11  
**阶段：** 核心可玩完成；进入代码打磨、上线配置核验与公开展示准备。  
**证据级别：** 以下“本地已验证”均来自本次工作树检查；线上状态均明确标为待人工核验。

## 本地已验证

- `npm run test:run`：2 个测试文件、14/14 通过。
- `npm run build`：TypeScript 和 Vite 构建成功。
- 构建输出把各角色发言库分块加载；最大两个 gzip 后资源约为 185 kB 和 172 kB。
- 构建有一条非阻断警告：`aiOrchestrator.ts` 对 `geminiAdapter.ts` 同时静态和动态导入，
  因此动态导入不会拆出额外 chunk。

## 已完成能力

### 游戏与 AI

- 9 人与 12 人板型、昼夜阶段、投票、死亡、胜负和角色规则已经实现。
- `BeliefTracker` + `ActionSelector` 决定 AI 行动；角色人设、蒸馏发言库和 Gemini
  负责表达与补强，LLM 不应凌驾于规则层。
- 角色发言库共有 11,449 条：平民 4,284、狼人 3,987、预言家 1,015、伪预言家 925、
  守卫 629、灵媒 609。
- 已加入 15 种 AI 人设和新手/进阶/高手三档难度。

### 账户、战绩与代理

- Supabase 邮箱 OTP、档案、用户战绩、游客本地战绩和 30 天本地会话恢复已经实现。
- Netlify Gemini 代理包含 API key 隔离、模型白名单、8,000 字符提示上限、CORS、
  OPTIONS 响应和每实例每 IP 每分钟 30 次限流。
- 生产配置已有 SPA fallback、HSTS、`X-Frame-Options`、`nosniff`、Referrer Policy、
  Permissions Policy 和静态资源缓存。

## 近期已合并修复

- `143860d`：每次创建 Supabase client，并把 OTP 验证、档案写入、战绩读取放在同一
  新鲜会话中，修复验证码被旧 token 污染后误报过期的问题。
- `7aed332`：女巫可看见夜间刀口；查验标记仅对预言家/女巫显示。
- `6721ed5`：30 天免登录；暗牌局不展示死亡玩家身份。
- `2c62e5a`：修复预言家标记、死亡后发言和中文发言库过滤。
- `39588ee`：Gemini 默认迁移到 `gemini-2.5-flash`。
- `112c4d5`：把 `@google/genai` 放到根依赖，保障 Netlify Function 打包。

## 尚未完成或尚未证实

### 必须人工核验

1. Supabase 中的表、索引和 RLS 策略是否实际执行；匿名用户能否只访问自己的战绩。
2. Supabase 邮件模板是否使用 `{{ .Token }}`，以及真实邮箱 OTP 的发送/验证闭环。
3. Netlify 环境变量、`ALLOWED_ORIGIN`、部署函数和 `ai-werewolf.net` 的实际行为。
4. 完整真人对局的浏览器验收：9 人、12 人、每个特殊身份、断网时回退、登录和战绩。

### 明确的代码与交付缺口

| 优先级 | 项目 | 证据与建议 |
| --- | --- | --- |
| P1 | CSP | `netlify.toml` 未设置 Content-Security-Policy；新增前要列出 Google Fonts、Supabase、DiceBear、Gemini/同源请求等实际来源，避免误伤生产。 |
| P1 | 过时代码 | `src/services/aiPlayer.ts` 未被任何模块导入，且与 `aiOrchestrator.ts` 重复；先单独删除并运行全量验证。 |
| P1 | 类型安全 | `useAuth.ts` 有 3 处 `any`；`aiOrchestrator.ts` 以 `type as any` 传给行动选择器。应收紧为现有领域类型。 |
| P2 | 分享与索引 | `index.html` 缺少 description、Open Graph 和 Twitter metadata；仓库没有 `public/robots.txt`。 |
| P2 | 测试覆盖 | 当前 14 项测试集中在规则与集成流，缺少认证、Supabase client、代理输入验证和浏览器端到端场景。 |
| P3 | 性能整理 | 处理 Gemini 双重导入的构建警告，并评估最大的发言库首屏/运行时加载体验。 |
| P3 | 音效 | UI 有静音开关状态，但未发现音频资源或播放系统；这是可选体验增强，不是上线阻塞项。 |

## 建议执行顺序

1. 先完成 Supabase 和 Netlify 的人工核验，记录结果，不对线上环境做猜测。
2. 创建互不重叠的 Codex 任务：`legacy-ai-player-cleanup`、`type-safety-cleanup`、
   `seo-robots`。CSP 单独执行和验证。
3. 在每个任务的报告中记录 diff、测试命令和结果，再由 Claude Code 验收。
4. 通过浏览器走一局完整 9 人和 12 人对局后，再决定音效和性能优化是否进入范围。

## 工作树注意事项

协调 skill、`AGENTS.md`、`CLAUDE.md`、`memory/`、`.mcp.json`、`.env.example` 和
`Werewolf copy/` 当前均未提交或包含未提交内容。提交前必须由项目负责人审阅；不要把
`.env.local`、密钥、原始 worker 事件流或无关副本带入提交。
