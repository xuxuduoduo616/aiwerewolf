# Report: p0-fix-guest-lobby-deadlock

## Summary

Fixed a one-line bug where the Guest Trial button failed to transition `game.phase` from `LOGIN` to `LOBBY`, leaving users in a broken game view after clicking "Guest Trial".

---

## Changed Files

| File | Change |
|------|--------|
| `src/App.tsx` | Line 96 — expanded callback to also call `game.setPhase(GamePhase.LOBBY)` |
| `src/guestLobbyTransition.test.ts` | New — regression test (4 cases) |

---

## What Was Fixed and How

**Root cause**: `App.tsx` line 96 called `auth.handleGuest(rec.loadLocalRecords)`, which correctly set `isGuest=true` and loaded local records, but never transitioned `game.phase` to `LOBBY`. Because `isAuthenticated = session || isGuest` became true, the login UI hid. But `game.phase` was still `LOGIN`, causing the app to fall through to a broken game view.

The OTP handler on line 87 already did the right thing:
```tsx
auth.handleVerifyOtp(records => { rec.setRecords(records); game.setPhase(GamePhase.LOBBY); })
```

**Fix** — expanded the Guest Trial callback to match:
```tsx
// Before (broken)
onClick={() => auth.handleGuest(rec.loadLocalRecords)}

// After (fixed)
onClick={() => auth.handleGuest(() => { rec.loadLocalRecords(); game.setPhase(GamePhase.LOBBY); })}
```

No other code was changed. `useAuth.handleGuest` signature and internals are untouched.

---

## Test Results

```
npm run test:run

 ✓ netlify/__tests__/genai-proxy.test.js     (6 tests)
 ✓ src/guestLobbyTransition.test.ts          (4 tests)
 ✓ src/gameEngine.test.ts                   (11 tests)
 ✓ src/services/supabaseClient.test.ts       (2 tests)
 ✓ src/integration.test.ts                   (3 tests)

 Test Files  5 passed (5)
      Tests  26 passed (26)
   Duration  317ms
```

The 4 regression tests in `src/guestLobbyTransition.test.ts`:
1. **BUG REPRODUCTION** — proves the old code left phase at `LOGIN`
2. **FIX VERIFICATION** — proves the fixed callback transitions to `LOBBY`
3. **Guard** — callback always runs regardless of record state
4. **OTP non-regression** — OTP path still correctly reaches `LOBBY`

---

## Build Result

```
npm run build

tsc && vite build
✓ 1571 modules transformed.
✓ built in 971ms
```

No TypeScript errors. No warnings on changed files.

---

## VERDICT: PASS
