# Task: ui-profile-inventory

## Status

Accepted

## Objective

Build the 我的 (Profile & Inventory) view with 6 sub-tabs (时装/装饰/跑跑狼/场景/皮肤/背包), implementing the Outfits, Backpack, and Skin collection panels in detail with hardcoded test data.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `src/types.ts`
- `index.css`

## Context

- This is a brand new view accessed via the bottom nav "我的" tab
- 6 sub-tabs at the top: 时装, 装饰, 跑跑狼, 场景, 皮肤, 背包
- Must implement 3 panels in detail:

### 时装 (Outfits) panel:
- Top half: character fitting room preview (centered character, right-side "已穿戴" checkbox)
- Middle filter bar: 我的, 普通, 高级, 稀有, 极品
- Bottom half: outfit grid. Hardcode 2 test outfits:
  - Outfit A: "默认时装", quality "普通", status "永久拥有", selected with yellow highlight border
  - Outfit B: "新服盛典限定时装", quality "高级", status "永久拥有"

### 背包 (Backpack) panel:
- Filter bar: 礼物, 宝箱, 道具, 碎片, 优惠券
- Item grid: each cell has icon placeholder, name, effect description (亲密度+1), green 送礼 button, bottom count (x9)
- Hardcode 3-4 test items

### 皮肤 (Skin Collection) panel:
- Sub-categories: 典藏皮肤, 主题季皮肤, 联动皮肤
- Top progress text: "已集齐主题: 0/8 | 全部皮肤: 0/137"
- Large banner stream showing set collection progress bars (0/25 详情>>)

## Allowed changes

- `src/components/ProfileView.tsx` — new file: main profile/inventory view
- `src/components/OutfitsPanel.tsx` — new file: outfits showcase panel
- `src/components/BackpackPanel.tsx` — new file: backpack inventory panel
- `src/components/SkinCollectionPanel.tsx` — new file: skin collection gallery
- `src/components/ProfileSubTabs.tsx` — new file: sub-tab navigation
- `index.css` — add profile-specific CSS classes (do NOT modify existing game CSS)

## Do not change

- Game logic, existing components, existing types, useGameState, gameEngine, aiOrchestrator
- Existing .sketch-scene, .seat-stage, .center-console CSS classes
- Deployment or environment configuration

## Acceptance criteria

1. Profile view renders with 6 sub-tabs, all clickable
2. 时装 panel: character preview area with "已穿戴" checkbox, 5-item filter bar, 2 hardcoded outfit cards with correct quality labels and yellow highlight on selected
3. 背包 panel: 5-item filter bar, grid of items with name, effect, 送礼 button, count badge
4. 皮肤 panel: 3 sub-categories, progress text, banner cards with progress bars
5. All icons are SVG placeholders — no external images
6. `npm run test:run` + `npm run build` succeed

## Verification

```bash
npx tsc --noEmit
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/ui-profile-inventory.md`
- Worker must set this card to `Ready for review` or `Blocked`
