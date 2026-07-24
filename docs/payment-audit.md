# Payment Closure Audit

**Task:** TC-002
**Baseline:** `ceb3aeb444ca6e501ab971b5e01301d7c064fda7`
**Audit method:** local source review and isolated mocks only
**External access:** none; no Supabase, Netlify, PSP, network, schema, data, RLS,
or environment mutation

## Result

Payments are closed. Coin products, prices, wallet balances, and existing order
history remain readable. There is no reachable purchase path that fetches the
payment Function, creates an order, writes local storage, or increases a wallet
balance.

Every POST to `/.netlify/functions/payment-escrow` returns HTTP 503 with exactly:

```json
{"code":"PAYMENTS_NOT_CONFIGURED"}
```

The response is produced before body parsing, JWT inspection, privileged client
acquisition, order access, or wallet access. OPTIONS and non-POST method
handling remain non-mutating.

## Boundary Map

| Boundary | Read behavior | Write behavior after TC-002 | Evidence |
|---|---|---|---|
| Netlify payment Function | Reads request method and CORS origin only. | POST returns the exact 503 contract. It does not import the admin helper, parse the body, verify JWTs, access tables, or call external services. | `netlify/functions/payment-escrow.cjs`; `netlify/__tests__/payment-escrow.test.js` |
| `useWallet.purchase` | Does not inspect pack data, session data, endpoint responses, or cached wallet state. | Returns `{ success: false, error: "充值功能暂不可用" }` for every input. It never fetches, calls a state setter, creates a local order, or calls `localStorage.setItem`. | `src/hooks/useWallet.ts`; `src/hooks/useWallet.test.ts` |
| Non-purchase wallet reads | Guest/local and authenticated/Supabase balance reads remain available, including existing order history. | Read failures may select the existing local read fallback, but no read path writes, repairs, or increments wallet data. | `loadLocalWallet`, bootstrap effect, and `refresh` in `src/hooks/useWallet.ts` |
| Coin store | Displays six packs, their prices/bonuses, and current wallet balances. | All six pack controls and the final purchase control are disabled and reference one visible unavailable explanation. The retained `onPurchase` integration callback is never invoked. | `src/components/CoinStore.tsx`; `src/components/CoinPackCard.tsx`; `src/components/CoinStore.payment.test.tsx` |
| Existing schema and admin helper | Unchanged. Existing rows may still be read through existing non-purchase paths. | Unreachable from the retained payment Function. No schema, policy, service helper, or live data change was authorized or made. | Import/call absence in `payment-escrow.cjs`; scoped diff review |

## Former Grant Paths And Closure Evidence

| Former path | Previous effect | Closure |
|---|---|---|
| Missing service configuration in Function | Returned a simulated order, pending status, and balance. | The simulated response and order ID generator are removed. POST returns the exact 503 contract before configuration or admin-client access. |
| Authenticated Function request | Verified a JWT, inserted `coin_orders`, read `user_coins`, and upserted an increased balance. | All auth, insert, wallet read, and upsert code is removed from the payment Function. Tests assert zero `getUser`, `from`, `insert`, and `upsert` calls. |
| Wallet-upsert partial failure | Could leave a pending order after a wallet update failure. | There is no order insert, so the partial order-without-wallet state cannot originate from this endpoint. |
| Successful endpoint response in client | Replaced wallet state with `new_balance` and increased lifetime purchased coins. | Client purchase no longer fetches or parses endpoint responses and never calls a wallet state setter. |
| Guest success path | Persisted a returned balance to `werewolf_wallet`. | Purchase has no storage call. Existing guest wallet data remains byte-equivalent. |
| Network failure fallback | Applied hardcoded pack rewards, created a local completed order, and persisted guest data. | Pack reward mappings, `applyPurchase`, `buildOrder`, local order IDs, and `saveLocalWallet` are removed. Network state cannot affect the stable unavailable result. |
| Unknown pack handling | Returned a pack-specific failure before other purchase behavior. | Known, unknown, empty, and malformed runtime pack IDs receive the same stable unavailable failure with no side effects. |
| Pending/simulated response | Could be treated as purchase success when a balance was present. | No request is made and no response shape is accepted. A mocked pending balance response is demonstrably ignored. |
| Store pack selection and purchase button | Enabled selection and invoked `onPurchase`; success could show a completion toast. | All pack and purchase buttons are disabled. Selection, processing, success, and network-error UI branches are removed. |

## Failure And Repetition Matrix

| Case | Endpoint result | Client result | Order/balance effect |
|---|---|---|---|
| Guest or missing authorization | Exact 503 code | Stable unavailable failure | None |
| Authenticated request | Exact 503 code before JWT verification | Stable unavailable failure | None |
| Invalid or expired JWT | Exact 503 code before JWT verification | Stable unavailable failure | None |
| Missing or malformed body | Exact 503 code before body read/parse | Stable unavailable failure | None |
| Known or unknown pack | Exact 503 code | Same result for both | None |
| Missing server configuration | Exact 503 code | No request is made | None |
| Privileged server configuration present | Exact 503 code without acquiring it | No request is made | None |
| Network rejection | No upstream network call exists | Stable unavailable failure without fetch | None |
| Would-be pending response | No downstream request exists | Response is not requested or consumed | None |
| Repeated/concurrent requests | Every POST returns exact 503; no rate branch precedes it | Every call returns the same failure | None; cached wallet bytes unchanged |
| Huge or stale cached balance | Not read by POST | Purchase does not read or write it | Byte-equivalent |
| Local storage failure | Not applicable to POST | Purchase never calls storage | No mutation attempt |

## Accessible Unavailable State

- The six pack names, prices, bonuses, and badges remain in the document.
- Each pack is a native disabled button whose accessible name includes the
  unavailable state.
- Each pack and the final purchase button uses
  `aria-describedby="payments-unavailable-description"`.
- The referenced visible status says that payment service is not configured and
  that orders and coins cannot currently be issued.
- Test-mode, purchase-success, processing, and network-retry claims are absent.

## Owner-Only Prerequisites To Reopen Payments

Reopening payments requires a separately authorized plan. At minimum, the owner
must provide or approve:

1. A contracted PSP account and server-side secret management through the
   deployment platform; no PSP credential may enter the client or repository.
2. A server-authoritative product catalog and validation of product, amount,
   currency, account ownership, and request version. Client reward values must
   never be trusted.
3. A signed PSP webhook/callback verification path. Wallet credit may occur only
   after a verified completed payment, never when an order is merely created or
   pending.
4. Idempotency keys and replay protection across intent creation, webhook
   retries, client retries, and concurrent delivery.
5. One atomic ledger transaction that records the verified payment event and
   grants the wallet balance exactly once, with auditable before/after values.
6. Reconciliation for PSP settlements, internal orders, wallet ledger entries,
   refunds, chargebacks, disputes, manual corrections, and historical pending
   orders.
7. A separately reviewed schema/migration/RLS plan, least-privilege server
   access, retention rules, abuse controls, monitoring, alerting, and redacted
   operational logs.
8. Local integration tests plus authorized preview and production acceptance
   against non-production PSP fixtures before any purchase control is enabled.

## Verification

- Focused payment suite: 3 files, 20 tests passed.
- Required endpoint/hook suite: 2 files, 18 tests passed.
- Full regression: 34 files passed, 1 skipped; 387 tests passed, 5 skipped.
- TypeScript: `npx tsc --noEmit` passed.
- Guarded build: passed with a process-local non-release Turnstile placeholder;
  no owner environment value was read or persisted.
- Scope/static review: no payment Function admin/table/write branch and no
  client purchase fetch/storage/reward branch remain.

## Limitations

- TC-002 does not delete, refund, reconcile, or otherwise alter existing
  `coin_orders`, `user_coins`, or guest wallet records. Existing data is
  intentionally left unchanged.
- The shared admin helper and documented historical schema remain in the
  repository but are not imported or reached by the retained payment Function.
- No claim is made about live deployment state. Integration, deployment, and
  production verification are coordinator/owner responsibilities.
