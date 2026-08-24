# 登录经济服务部署与验收手册

## 当前边界

`docs/economy-schema.sql`、`netlify/functions/economy.cjs` 及本地测试只定义候选契约。**截至本文件编写时，生产 SQL、RLS、RPC、环境变量、余额、inventory 和 ledger 状态均为未验证；本地测试通过不等于生产部署成功。** 本卡不执行在线 SQL，不修改 Supabase/Netlify Dashboard，也不发布 Function。

成功 GET 的 `data.checkIn` 精确包含 `streak`、`lastClaimDate`、`serverDate` 与
`claimedMilestoneDays`。其中 `claimedMilestoneDays` 始终是升序、去重、只含
`7/14/30/60/90` 的 JSON 整数数组；无历史领取时为精确 `[]`，不得省略或返回 `null`。
唯一事实来源是当前 `auth.uid()` 在 `public.economy_check_in_claims.streak_day` 中的历史
记录。当前 streak、last claim date、wallet、inventory、receipt、catalog 和分页 ledger
均不得反推或补齐该数组。

当前没有配置可信的 completed-game writer。浏览器可写的 `public.game_records` 仅是历史展示数据，其 `result` 不具奖励权威；只有无浏览器权限的 `economy_gameplay_eligibility` 才能记录服务器确认的完成事实与 outcome。在另一个经批准、服务端权威且可审计的 writer 上线前，普通登录用户的 gameplay reward 必须保持不可用并返回 fail-closed 错误；不得用客户端 boolean/status/result、trigger 复制或手工信任现有 `game_records.result` 绕过该边界。

该经济系统只有 `coins` 与 `crystals`，均为站内非现金资产。不得启用或修改现有 payment Function，不得接入真钱购买、PSP、webhook、退款、清算或 reconciliation；`PAYMENTS_NOT_CONFIGURED` 边界必须保持不变。

## 人工审核与执行顺序

以下步骤只能由 coordinator 在 owner 明确批准的独立变更窗口中执行：

1. 确认 `docs/supabase-init.sql` 的 `auth.users`、`public.game_records` 依赖已存在；先备份 schema 和相关表，并记录可恢复点。
2. 逐段审核 `docs/economy-schema.sql`：表约束、武侠目录种子、可信 eligibility 边界、RLS policy、列级 SELECT grant、私有 helper revoke、六个公开 RPC grant、固定 `search_path` 和 `auth.uid()` 检查。确认 `economy_gameplay_eligibility` 没有 browser grant、公开 writer RPC 或从 `game_records` 自动复制的 trigger。
3. 在非生产 Supabase 项目中以一个事务执行完整 SQL 文件；不要挑选性跳过约束或权限语句。失败时确认事务整体回滚。
4. 用 `anon` 与 `authenticated` 两种数据库角色执行下述 RLS/RPC smoke checks，并检查重复/并发请求的 ledger、receipt、wallet、inventory 和 state 原子一致性。必须使用两个真实数据库连接完成并发验证；本地 PGlite 只验证队列化并发调用、行锁/唯一约束与单效果，不替代该 gate。
5. 独立审核 HTTP Function：配置、origin、bearer、content type、body 大小、字段白名单、分页、RPC 白名单和错误脱敏。
6. 仅在 coordinator 独立验收 SQL 与 HTTP 契约后，配置预览环境并发布预览；再次完成端到端验收。frontend 不得在此 gate 前对接或宣称资产已生效。若可信 writer 仍未单独获批，预览与生产的 gameplay reward 均应明确保持 unavailable。
7. owner 另行批准生产窗口后，重复备份、人工 SQL 执行、权限检查、Function 发布和生产 smoke checks；保存不含 token、邮箱、密钥或原始响应的证据。

## 最小环境变量名称

Function 只需要下列服务端配置名称；本文件不记录任何值：

- `SUPABASE_URL`（可回退读取现有 `VITE_SUPABASE_URL`）
- `SUPABASE_ANON_KEY`（可回退读取现有 `VITE_SUPABASE_ANON_KEY`）
- `ALLOWED_ORIGIN`（逗号分隔的精确 origin；不允许路径或通配符）

该 Function 使用 anon key 与已验证用户 bearer 建立请求级客户端，使 `auth.uid()` 和 RLS 保持用户身份。它不需要 service-role key，不得把 bearer、key 值或认证响应写入日志或证据。

## RLS 与 RPC smoke checks

测试账号 A 与 B 必须隔离，所有检查均使用短期测试数据并在批准的非生产环境先完成：

- anon 角色不能读取 wallet、ledger、inventory、state、receipt 或 catalog，也不能执行任何经济 RPC。
- authenticated A 只能读取 A 的 wallet、ledger、inventory、state、check-in/gameplay claim 与 receipt；不能读取 B 的记录。
- anon/authenticated A 均不能 SELECT/INSERT/UPDATE/DELETE `economy_gameplay_eligibility`；该表没有 browser policy、grant 或公开 authoring RPC。
- authenticated A 只能读取 `active = true` 的 catalog 公共列；不能直接 INSERT/UPDATE/DELETE wallet、ledger、catalog、inventory、state、claim 或 receipt。
- 公开可执行对象只有 `economy_get_state` 与五个 mutation RPC；helper function 对 `public`、`anon`、`authenticated` 均无 EXECUTE。
- RPC 在缺少 `auth.uid()` 时拒绝；其签名没有 `user_id`、日期、价格、reward、余额、catalog、result 或完成状态参数。
- 同一用户、action、canonical payload 与幂等键的串行和并发重试返回保存结果，仅有一次 wallet/ledger/state 变化；同一键改 action 或 payload 返回冲突且不产生第二次变化。
- 同一 UTC 日并发签到只成功一次；断档重置、相邻日递增，7 日循环和第 7/14/30/60/90 日里程碑逐项核对，90 日以后不重放里程碑。
- `economy_get_state` 的 `checkIn.claimedMilestoneDays` 必须执行以下非生产 smoke checks：新用户及无 milestone claim 的用户返回精确 `[]`；A/B 各自只看到自己的 claims；当前 streak 断档重置为 `1` 后仍保留过去 milestone；把当前 streak 设为 `90/91` 但不写 claims 时不得反推任何 day；普通 streak day 被过滤；重复 milestone day 去重并固定升序；分别用不同 `ledgerLimit` 和有效 `ledgerCursor` 读取至少两页 ledger 时结果完全一致。
- 浏览器以 A 身份插入一条归属 A、`result = 'WIN'` 的 `game_records` 后，未存在 trusted eligibility 时必须得到 `GAMEPLAY_REWARD_UNAVAILABLE`，且 receipt/wallet/ledger/claim 均无变化。修改该 client result 也不得改变结论。
- 仅由测试中的数据库 owner 模拟未来可信 writer，写入同一 `(user_id, game_record_id)` 的 eligibility 与服务器 outcome 后，RPC 才可发奖；必须以 eligibility outcome 而不是 `game_records.result` 计算胜负奖励。跨用户、重复 record、未来完成时间均拒绝，并满足 UTC 日 5 局与 200 Coins 双上限。
- skin 解锁只使用 active purchase catalog 的服务器价格；余额不足、重复拥有和并发解锁均不部分扣款。equip 只能选择当前用户 inventory 中的 skin。
- catalog 必须精确核对 `mist-wanderer`、`bamboo-vigil`、`tidal-swordsman`、`moonlit-crane`、`jade-moon-oath`、`tidebreaker-vow`、`crimson-lotus-shadow`；第 60 日发 `mist-wanderer`，第 7/90 日分别发 `avatar-frame:ink-ring` / `avatar-frame:crimson-moon`。
- 尝试 UPDATE/DELETE ledger 会被 append-only trigger 拒绝。

每项 smoke check 应比较调用前后 wallet、ledger、inventory、receipt 和 state，而不是只看 HTTP 200/错误码。不得把预览环境结果描述为生产结果。

## HTTP 验收矩阵

| 场景 | 预期状态/错误码 |
| --- | --- |
| 配置缺失或畸形 | `503 ECONOMY_NOT_CONFIGURED`，无认证/RPC |
| origin 缺失或不在精确 allowlist | `403 ORIGIN_NOT_ALLOWED` |
| `OPTIONS` + 合法 origin | `204`，仅返回限定 CORS headers |
| 非 `GET`/`POST`/`OPTIONS` | `405 METHOD_NOT_ALLOWED` |
| bearer 缺失、畸形、无效或过期 | `401 UNAUTHORIZED` |
| POST content type 非 JSON | `415 UNSUPPORTED_MEDIA_TYPE` |
| body 超过 8 KiB | `413 BODY_TOO_LARGE` |
| JSON/对象/字段/action/参数/幂等键非法 | 对应稳定 `400` code |
| 幂等键被不同 action/payload 复用 | `409 IDEMPOTENCY_CONFLICT` |
| game record 存在但无可信 eligibility | `409 GAMEPLAY_REWARD_UNAVAILABLE`，无资产变化 |
| 已领取、日上限、余额不足、重复拥有、未拥有 | 对应稳定 `409` code |
| 资源不属于用户或商品不存在 | `404 NOT_FOUND` |
| 未识别的数据库/网络错误 | `502 ECONOMY_UPSTREAM_ERROR`，不含 SQL/堆栈/内部细节 |

还必须确认 GET 的分页范围为 1–100，响应只含 `coins`/`crystals`，且
`checkIn.claimedMilestoneDays` 符合上述精确 shape 与 claims-only 来源；GET body、未知 query
字段或 POST body 均不能提交 claimed state。Function 对 `economy_get_state` 的参数仍只有
`p_ledger_limit` / `p_ledger_cursor`；POST 到 RPC 的参数不含用户 ID、日期、价格、reward、
余额、catalog、milestone、claimed days、胜负或完成状态。现有 payment 模块不得被导入或调用。

上述 PGlite/HTTP 自动化与非生产 smoke 只验证候选契约，不证明生产 SQL/RLS/RPC/data、
Function 或真实账户状态已经部署或正确；没有直接线上证据时一律保持“未验证”。

## 禁用与回滚

优先采用可恢复的禁用，不删除 ledger 或用户资产：

1. 立即从 `authenticated` 撤销六个公开 RPC 的 EXECUTE，或撤下/路由禁用 `economy` Function；验证所有 mutation 已不可达。
2. 保留 wallet、append-only ledger、receipt、inventory、trusted eligibility 与 claim 数据用于核对，不运行破坏性 DROP/DELETE。若未来存在单独 writer，先撤销其 eligibility 写权限/入口并保留审计事实。
3. 若 schema 安装事务失败，依赖事务整体回滚；若部署后发现问题，从已记录备份点恢复，并由 coordinator 单独审核修复 SQL。
4. Function 回滚到上一已验证构建后，重新验证原有单机、认证和 `PAYMENTS_NOT_CONFIGURED` 行为。
5. 只有在数据核对、RLS/RPC 复验和 owner 再批准后才恢复 EXECUTE/路由。

生产执行、回滚和恢复结果都必须以 Dashboard/HTTP/数据库直接证据记录；没有这些证据时状态始终写作“未验证”。
