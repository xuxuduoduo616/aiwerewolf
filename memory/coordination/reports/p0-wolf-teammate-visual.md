# Report: p0-wolf-teammate-visual

## Changed files

- `src/components/PlayerCard.tsx`
- `src/App.tsx`
- `src/components/PlayerCard.wolfvision.test.ts` (new)

## What was implemented

### PlayerCard.tsx

- Added `isWolfTeammate?: boolean` to `PlayerCardProps`.
- Imported `PawPrint` and `Moon` from `lucide-react`.
- When `isWolfTeammate` is true, renders a `PawPrint` icon badge at bottom-left of the avatar with `aria-label="狼队友"`, styled in red (`bg-red-950/90 border-red-700 text-red-300`). Badge renders regardless of `player.isAlive`, satisfying the "dead teammates still identifiable" requirement.
- When `isMe && player.role === Role.WEREWOLF`, renders a small `Moon` icon (`w-3 h-3 text-red-400`) inline with the "YOU" name label as the self-wolf indicator. This is visually distinct from the teammate PawPrint badge (different icon, different position, different size).

### App.tsx

- In the seat-stage `map`, converted the arrow function to a block body to compute two derived values per player:
  - `isHumanWolf = game.me?.role === Role.WEREWOLF && game.me?.isAlive === true`
  - `isWolfTeammate = isHumanWolf && player.id !== MY_PLAYER_ID && player.camp === 'WEREWOLF'`
- Passes `isWolfTeammate` prop to `PlayerCard`. The `customBadge` logic (wolf kill target, seer check result) is unchanged.

## Permission gate

The gate is `me.isAlive === true && me.role === WEREWOLF`. If the human player is dead or not a werewolf, `isHumanWolf` is false and no `isWolfTeammate` prop is ever true. Non-wolf roles (villager, seer, witch, hunter) are fully protected by this gate.

## Test results

```
 ✓ src/components/PlayerCard.wolfvision.test.ts (10 tests)
 ✓ src/guestLobbyTransition.test.ts (4 tests)
 ✓ netlify/__tests__/genai-proxy.test.js (6 tests)
 ✓ src/services/supabaseClient.test.ts (2 tests)
 ✓ src/gameEngine.test.ts (11 tests)
 ✓ src/integration.test.ts (3 tests)

 Test Files  6 passed (6)
      Tests  36 passed (36)
```

Tests cover:
- Wolf sees badge on live AI wolf teammate
- Wolf sees badge on dead AI wolf teammate (badge persists)
- Human wolf's own card is NOT flagged as teammate
- Live non-wolf teammates (villager, seer, witch, hunter) get no badge
- Villager, seer, witch, hunter see NO wolf badges on any player
- Dead human werewolf sees no badges after own death
- `me = undefined` produces no badges

## Build result

```
✓ built in 973ms
```

TypeScript compilation clean. No type errors.

## VERDICT: PASS
