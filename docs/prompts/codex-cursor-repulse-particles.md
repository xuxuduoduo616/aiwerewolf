# Codex 任务提示词：鼠标排斥粒子背景（本地预览版）

> 适用仓库：`aiwerewolf`（Vite 5 + React 18 + TypeScript + Tailwind 3）
> 建议 Task ID：`MOTION-CURSOR-001`
> 本任务只做「全站背景粒子层 + 鼠标排斥」，**不做页面转场幕布**，**不做部署**。
> 把本文件全文交给 Codex，或让 Codex 直接读取本文件。

---

## 0. 角色、权限与硬边界

你是本仓库的 **worker**，不是 coordinator。

开始前必须：

1. 读取 `AGENTS.md`、`CLAUDE.md`（若存在），再按 `memory/INDEX.md` 的顺序读取共享状态；若存在 `memory/coordination/tasks/MOTION-CURSOR-001.md`，以任务卡为准。
2. 执行并记录：
   ```bash
   git rev-parse HEAD
   git branch --show-current
   git status --short
   ```
3. 当前预期基线是 `2d065d9` 或其后提交；**以实际 HEAD 为准**。若工作区有未提交改动、或 HEAD 与 coordinator 告知的不一致，**停止并报告**，不要覆盖用户改动。
4. 若宿主提供 `$aiwerewolf-worker`，按该 skill 的流程执行；不要自行提升为 coordinator。

硬边界（违反即停止）：

- **不 commit、不 merge、不 push、不创建 PR、不管理 worktree。**
- **不部署**：不执行 `netlify deploy`（包括 draft/preview）、不执行任何 `netlify deploy --prod`、不上传 `dist/`、不调用 `aiwerewolf-release-sync`、不改 DNS/环境变量。
- 不改 `netlify.toml`、`netlify/functions/*`、Supabase、支付、经济、认证、AI/规则逻辑。
- 不改 `gameEngine.ts`、`useGameState.ts`、`beliefTracker.ts`、`actionSelector.ts`、`src/ai/*`。
- 不修改 `PROJECT_STATE.md`、`progress-report.md`、ADR、他人任务卡；只写自己的报告。
- 不引入 Motion、GSAP、SmoothUI、three.js、OGL 或新的 UI 框架；本任务只用 tsParticles。
- 不升级无关依赖；不切换 npm/pnpm/yarn。

完成后必须停在「本地预览」阶段，等待 owner 明确宣布「可以全平台同步」后才允许另开部署任务（见 §6）。

---

## 1. 目标

在真实应用（登录页、Lobby、对局房间）的根层加入**全屏、持久、低干扰**的神经网络粒子背景：

- 鼠标在页面任意位置移动时，**指针半径内的粒子被推开**，形成跟随鼠标的“空洞/斥力场”。
- 鼠标移开后，粒子在约 0.5–1 秒内平滑回到漂移状态，不瞬移、不永久消失。
- 粒子为紫 / 红 / 青三色，带低透明度连线，符合暗黑悬疑 / 赛博哥特 / 神经网络计算感。
- 粒子层必须在**内容下方**（不能盖住文字或按钮），且不能拦截任何点击。
- 在登录页、Lobby、9/12 人对局三个表面都**实际可见**；如果被现有不透明背景挡住，允许只调整背景渐变的 alpha（见 §3.7）。

必须达到的体感：

1. 鼠标快速划过 Lobby 空白区域，能看到约 170px 的粒子被推开并回弹。
2. 鼠标停在某处，周围粒子持续被推开，外部粒子缓慢漂移。
3. 点击底部导航、开始游戏、返回大厅、弹窗按钮完全不受影响。
4. 触屏 / `prefers-reduced-motion` 设备上不出现鼠标排斥，也不产生持续掉帧。

---

## 2. 当前代码事实（不要假设）

| 事实 | 影响 |
|---|---|
| 当前 `package.json` **没有** tsParticles | 本任务第一步是安装依赖 |
| `src/index.tsx` 只渲染 `<App />`，没有根级背景层 | 需要在这里加根层 |
| 没有 react-router；视图由 `activeView` / `game.phase` 条件渲染 | 不用做路由监听，背景层必须比 `App` 的分支更持久 |
| 游戏房间渲染在 `GlobalShell` **之外**（`App.tsx` 约 324 行） | 粒子层必须在 `index.tsx` 根部，不能放进 Lobby/GameRoom |
| `.wol-shell` 的背景是**不透明**的线性渐变（`src/styles/mobile-shell.css:50-53`） | 不改 alpha 的话粒子在 Lobby 完全看不见 |
| 登录页 `.sketch-scene` 的背景也是**不透明**渐变（`index.css:126-129`） | 登录页同理 |
| `body` 背景已是 `#050505` | 不会出现白屏，但需要保证空档是深色 |
| 已有 6 处 `prefers-reduced-motion` 处理 | 新动效必须接同一套降级 |
| 已安装 `@playwright/test`，`playwright.config.ts` 固定 5173 / 127.0.0.1 | 本地预览与 e2e 端口必须一致 |

---

## 3. 实现方案

### 3.1 安装依赖

```bash
npm install @tsparticles/react @tsparticles/engine @tsparticles/slim
```

- 使用 `loadSlim`（它已包含 `repulse` 交互），不要用 `loadFull` / `@tsparticles/all`。
- 记录实际安装版本到报告；不要手动降级/升级其他包。

### 3.2 新增文件

```
src/motion/particleEngine.ts      // 只做 initParticles(engine) -> loadSlim
src/motion/particleOptions.ts     // 纯函数：根据环境生成 options
src/motion/ParticleField.tsx      // React 组件：Particles + 媒体查询 + 可见性暂停
src/motion/particleOptions.test.ts
```

### 3.3 根层挂载（关键）

`ParticlesProvider` 的 `init` 必须是**模块级稳定函数**；Provider 只包住粒子层，**不要把 `<App />` 包进去**——否则 tsParticles 初始化完成前 App 不会渲染，初始化失败会整站空白。

`src/index.tsx` 参考：

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ParticleField from './motion/ParticleField';
import { initParticles } from './motion/particleEngine';
import { ParticlesProvider } from '@tsparticles/react';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ParticlesProvider init={initParticles}>
      <ParticleField />
    </ParticlesProvider>
    <div className="app-layer">
      <App />
    </div>
  </React.StrictMode>
);
```

`src/motion/particleEngine.ts`：

```ts
import type { Engine } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';

export const initParticles = async (engine: Engine): Promise<void> => {
  await loadSlim(engine);
};
```

说明：

- `@tsparticles/react@4.5.4` 的 `ParticlesProvider` 在 init 完成前渲染 `null`；App 在 Provider 外，所以启动不受影响。
- 若安装到的版本没有 `ParticlesProvider`，改用该版本官方的 `initParticlesEngine` 单例模式；**只初始化一次**，不能每次挂载/每个视图初始化。以 `node_modules` 里的实际导出与类型为准，不要猜 API。
- `Particles` 的 `options` 和 `particlesLoaded` 必须是稳定引用（`useMemo` / `useCallback`），否则 tsParticles 会在每次渲染时销毁并重建 canvas。

### 3.4 options 参考实现

`src/motion/particleOptions.ts`：

```ts
import type { ISourceOptions } from '@tsparticles/engine';

export type ParticleProfile = {
  compact: boolean;
  coarsePointer: boolean;
  reducedMotion: boolean;
};

export const PARTICLE_COLORS = ['#7c3aed', '#e11d48', '#22d3ee'] as const;

export const buildParticleOptions = ({
  compact,
  coarsePointer,
  reducedMotion,
}: ParticleProfile): ISourceOptions | null => {
  if (reducedMotion) return null;

  const interactive = !coarsePointer;

  return {
    fullScreen: { enable: true, zIndex: 0 },
    fpsLimit: compact ? 45 : 60,
    detectRetina: !compact,
    interactivity: {
      // 必须用 window：canvas 在内容下方，canvas 自身收不到 hover
      detectsOn: 'window',
      events: {
        onHover: { enable: interactive, mode: 'repulse' },
        onClick: { enable: false },
      },
      modes: {
        repulse: {
          distance: compact ? 120 : 170,
          duration: compact ? 0.4 : 0.55,
          speed: compact ? 0.9 : 1.15,
        },
      },
    },
    particles: {
      number: { value: compact ? 36 : 80, density: { enable: true } },
      color: { value: [...PARTICLE_COLORS] },
      links: {
        enable: !compact,
        distance: 140,
        color: '#8b5cf6',
        opacity: 0.16,
        width: 1,
      },
      move: {
        enable: true,
        speed: compact ? 0.35 : 0.55,
        direction: 'none',
        random: true,
        straight: false,
        outModes: { default: 'out' },
      },
      opacity: { value: { min: 0.15, max: 0.55 } },
      size: { value: { min: 0.6, max: 2.4 } },
      shape: { type: 'circle' },
    },
  };
};
```

如果 TypeScript 对 `detectsOn` 或 `shape.type` 的字符串联合报错，按 `@tsparticles/engine` 的枚举修正（例如 `InteractivityDetect.window`），不要用 `as any` 绕过。

参数意图：

- `distance: 170`：桌面端斥力半径；`speed: 1.15`、`duration: 0.55` 让推开明显但不飞散。
- `compact` 下半径 120、速度 0.9、粒子 36、无连线；触屏关闭 hover repulse。
- 颜色固定紫 / 血红 / 青；不要加第四种颜色。
- 不要开 `onClick` 的 push/bubble/remove；本任务只有 hover repulse。
- 不要加 `grab`/`connect`，会和 repulse 的“远离”语义冲突。

### 3.5 `ParticleField.tsx` 参考实现

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Particles from '@tsparticles/react';
import type { Container } from '@tsparticles/engine';
import { buildParticleOptions } from './particleOptions';

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};

const ParticleField = () => {
  const compact = useMediaQuery('(max-width: 767px)');
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const containerRef = useRef<Container | undefined>(undefined);

  const options = useMemo(
    () => buildParticleOptions({ compact, coarsePointer, reducedMotion }),
    [compact, coarsePointer, reducedMotion],
  );

  const onLoaded = useCallback(async (container?: Container) => {
    containerRef.current = container;
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const container = containerRef.current;
      if (!container) return;
      if (document.hidden) {
        void container.pause();
      } else {
        void container.play();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!options) return null;

  return (
    <Particles
      id="tsparticles"
      options={options}
      particlesLoaded={onLoaded}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default ParticleField;
```

注意：

- `options` 依赖三个媒体查询结果；跨断点时才重建，不能每次 render 新建。
- `onLoaded` 必须稳定，不能内联箭头函数。
- 组件本身不包 `div`；`Particles` 会渲染 `#tsparticles` 容器，canvas 由引擎注入。
- 页面隐藏时暂停；回到前台恢复。不要用 `setInterval` 手动暂停。

### 3.6 根层 CSS

在 `index.css` 增加：

```css
.app-layer {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  min-height: 100dvh;
}

/* 粒子层永远不拦截指针事件；detectsOn: window 仍能收到鼠标 */
#tsparticles,
#tsparticles canvas,
canvas#tsparticles {
  pointer-events: none !important;
}
```

如果实际 DOM 里 canvas 不在 `#tsparticles` 内，按真实选择器补一条，但**不要**给全局 `canvas` 加 `pointer-events: none`（可能影响未来其他画布）。

### 3.7 让粒子在现有深色背景后可见（允许的最小改动）

只调整 alpha，不改变色相、布局、字号、间距、组件结构。

`src/styles/mobile-shell.css` 的 `.wol-shell`（约 50–53 行）：

```css
background:
  radial-gradient(ellipse at 50% 20%, rgba(60, 45, 20, 0.25), transparent 55%),
  radial-gradient(ellipse at 80% 80%, rgba(30, 20, 50, 0.20), transparent 50%),
  linear-gradient(180deg, rgba(13, 13, 16, 0.76) 0%, rgba(10, 10, 15, 0.82) 40%, rgba(8, 8, 12, 0.90) 100%);
```

`index.css` 的 `.sketch-scene`（约 126–129 行）：

```css
background:
  radial-gradient(circle at 50% 35%, rgba(120, 120, 120, 0.16), transparent 34rem),
  linear-gradient(180deg, rgba(21, 21, 21, 0.78) 0%, rgba(6, 6, 6, 0.92) 72%);
```

调参范围：

- 如果 Lobby 里粒子太淡：把 `.wol-shell` 最后两段降到 `0.78` / `0.86`，最低不要低于 `0.68`。
- 如果正文对比度下降或画面发灰：升到 `0.86` / `0.94`，最高不要超过 `0.94`。
- 不改 `body` 的 `#050505`；不加 `backdrop-filter`；不把粒子层移到内容上方。
- 登录页、Lobby、对局各截图确认；如果三者中任何一个完全看不到粒子，继续调 alpha 或检查是否有别的祖先容器不透明，**不要用“把 canvas 放到最上层”来绕过**。

### 3.8 不要做的事

- 不做页面转场幕布、不接 Motion/GSAP/SmoothUI。
- 不做自定义光标、不做点击爆裂、不做 cursor trail。
- 不把粒子 canvas 放进 `GlobalShell`、`GameRoom` 或任何条件渲染分支。
- 不改 `App.tsx` 的视图切换、游戏状态、AI 调用、TTS、认证、支付。
- 不改 `package.json` 里现有依赖版本，不执行 `npm audit fix`。
- 不改 `index.html` 的 meta/字体。

---

## 4. 本地预览（本任务的硬性要求）

实现完成后，**必须在本地真实应用里跑起来供 owner 预览**，不能只交代码。

### 4.1 启动

```bash
npm run dev -- --port 5173 --strictPort --host 127.0.0.1
```

- 端口必须是 **5173**（`playwright.config.ts` 与本地 Gemini fallback 都依赖它）；`--strictPort` 保证不会静默换端口。
- 用受管后台任务保持运行，不要阻塞当前 shell；记录任务 ID。
- 如果 5173 被占用：不要自己换端口，报告占用情况并询问 owner/coordinator。
- 不要启动 DSH Web GUI 或其他服务器；只启动这个 Vite dev server。
- 启动后验证：
  ```bash
  curl -I http://127.0.0.1:5173/
  ```
  返回 200 后把 **确切 URL** 写入报告。

### 4.2 供 owner 预览的步骤（写进报告）

1. 打开 `http://127.0.0.1:5173/`。
2. 登录页：在空白区域移动鼠标，确认粒子被推开。
3. 点击 `Play as Guest`（或现有游客入口），进入 Lobby；在空白区域画圈移动鼠标，确认 170px 左右的斥力场。
4. 点击 `Start Game` → `Single-Player` → `9-Player Standard` → 开始；在对局房间的座位区域移动鼠标，确认同样生效。
5. 点击底部导航、打开/关闭弹窗、返回大厅；确认点击不被 canvas 拦截。
6. 用 DevTools 切到 390×844 移动端：确认无横向溢出、无 hover 排斥、粒子减少。
7. 用 DevTools 模拟 `prefers-reduced-motion: reduce`：确认不创建粒子 canvas（或至少无动画/无 repulse）。
8. Console：0 error；Network：无新增外部请求。

### 4.3 证据

- 如果环境已有 Playwright 浏览器：截 3 张图（登录 / Lobby / 对局）到 `output/cursor-particles/`，并附鼠标位于中心与角落的各一组；不要为了截图安装新的浏览器。
- 如果无法截图：不阻塞，报告里写清楚手动步骤，并明确「等待 owner 本地验收」。
- 不要把截图/录屏提交到 Git。

---

## 5. 验证命令与验收标准

### 5.1 必跑

```bash
npm run test:run
npx tsc --noEmit
npm run build
```

- `npm run build` 只做本地构建验证，**不上传、不部署**；`dist/` 已被 gitignore。
- 新增测试至少覆盖 `buildParticleOptions`：
  - `reducedMotion: true` 返回 `null`；
  - 桌面端 `detectsOn === 'window'`、`onHover.mode === 'repulse'`、`distance === 170`；
  - `coarsePointer: true` 时 `onHover.enable === false` 且无 links；
  - `compact: true` 时粒子数 36、`detectRetina === false`；
  - 颜色包含紫/红/青三色。
- 不要写依赖真实 canvas 的 jsdom 测试；options 纯函数测试即可。
- 如果环境有 Playwright 浏览器，追加：
  ```bash
  npx playwright test --project=smoke
  ```
  只作为回归，不要求新增 e2e spec。

### 5.2 验收清单

| ID | 验收项 | 通过标准 |
|---|---|---|
| AC-01 | 根层 | 全站只有 1 个 `#tsparticles` 粒子容器；切换视图不重建（DevTools 里节点保持） |
| AC-02 | 鼠标排斥 | 桌面端指针半径约 170px 内粒子明显向外移动；移开后 1s 内回弹 |
| AC-03 | 可见性 | 登录页 / Lobby / 对局三个表面都能看到粒子与斥力场 |
| AC-04 | 交互无回归 | 导航、开局、返回、弹窗、输入框点击全部正常；canvas `pointer-events: none` |
| AC-05 | 降级 | `prefers-reduced-motion` 下无动画/无 canvas；`pointer: coarse` 下无 hover repulse |
| AC-06 | 移动端 | 390×844 无横向溢出；粒子数减少；无明显掉帧 |
| AC-07 | 测试/构建 | `test:run`、`tsc --noEmit`、`build` 全通过；新增测试覆盖 options |
| AC-08 | 性能 | 桌面 60fps 目标、移动 45fps 目标；无 >50ms 长任务；页面隐藏后暂停 |
| AC-09 | 零部署 | 没有 commit/push/Netlify/Supabase/release 操作 |
| AC-10 | 范围 | 未改游戏规则、AI、认证、支付、TTS、Netlify Functions |

### 5.3 性能记录

在报告里写：

- 新增依赖及版本；
- `npm run build` 前后主 JS gzip 体积（至少给出 `dist/assets/*.js` 的最大文件变化）；
- 桌面 1440×900 与移动 390×844 的肉眼帧率/是否有卡顿；
- 粒子数、links 开关、DPR 策略；
- 若 bundle 增量 > 100KB gzip，先在报告里标注，不要自行删功能或换库。

---

## 6. 发布闸门（必须遵守）

**本任务到本地预览为止。**

禁止执行（包括“只试一下”）：

```bash
git push
gh pr create
netlify deploy
netlify deploy --prod
npm run deploy
```

同时禁止：

- 调用 `aiwerewolf-release-sync` 或任何发布 skill；
- 修改 `netlify.toml`、环境变量、Supabase、DNS、生产配置；
- 上传 `dist/` 或本地构建产物；
- 把“测试通过 / 构建通过”当作部署授权。

只有 owner 在对话中明确写出 **「可以全平台同步」** 后，才允许进入独立的发布任务；发布任务需要单独的授权与验收，不在本 prompt 范围内。

如果 owner 在预览后要求调整，继续在本地修改并重新预览；仍然不部署。

---

## 7. 写回与交付

实现并本地跑起来后，写：

```
memory/coordination/reports/MOTION-CURSOR-001.md
```

内容至少包含：

- `base_commit`：开始时 `git rev-parse HEAD` 的完整 SHA；
- 变更文件列表（含新增/修改）；
- 新增依赖与版本；
- 执行的命令与结果（test/tsc/build/smoke，若有）；
- **本地预览 URL** 与启动命令；
- 截图路径（若有）；
- 已知限制（例如：登录页 Turnstile iframe 上方 mouse move 不触发、移动端关闭 repulse 等）；
- `Status: Ready for review — local preview only`；
- `Deployment: NOT DONE — waiting for owner's "可以全平台同步"`；
- 下一步：owner 本地验收 → 通过后另开 release 任务。

不要：

- 修改 `PROJECT_STATE.md`、`progress-report.md`、ADR、别人的任务卡；
- commit/push；
- 在报告里写“已部署/已上线”。

---

## 8. 停止条件（遇到就停下来报告）

1. 工作区不干净、HEAD 与预期不一致、或存在用户未提交改动。
2. 安装的 tsParticles 版本没有 `ParticlesProvider` / `detectsOn` / `repulse`，且官方替代方案无法在 30 分钟内稳定落地。
3. 为了让粒子可见，必须大幅改色/改布局/改组件结构，或正文对比度明显下降。
4. `npm run test:run` / `tsc` / `build` 出现与本次改动无关的基线失败；报告失败项与基线差异，不要顺手修无关代码。
5. 5173 被占用且无法确认是否可复用；不要静默换端口。
6. 需要部署、push、改生产配置才能继续验证。

---

## 9. 参考

- tsParticles React 官方 README（`ParticlesProvider` / `Particles` / `loadSlim`）：  
  https://github.com/tsparticles/tsparticles/tree/main/wrappers/react
- Interactivity / `detectsOn: "window"`：  
  https://github.com/tsparticles/tsparticles/blob/main/markdown/Options/Interactivity.md
- Interactivity Modes / Repulse：  
  https://github.com/tsparticles/tsparticles/blob/main/markdown/Options/Interactivity/Modes.md
- 粒子背景与转场的整体选型（本任务只取背景层）：  
  `docs/motion-transition-selection.md`
- 本地 e2e 端口与 guest 流程：  
  `playwright.config.ts`、`e2e/helpers/game.ts`

---

## 10. 一句话总结

**在 `index.tsx` 根层加一个持久的 tsParticles 背景（`loadSlim` + `detectsOn: "window"` + `repulse`），只在必要时把 `.wol-shell` / `.sketch-scene` 背景 alpha 调低，本地 5173 跑给 owner 看；不 commit、不 push、不 deploy，等「可以全平台同步」。**
