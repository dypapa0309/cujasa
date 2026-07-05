# CUJASA Settings Reset / Upload Gap Checklist

## 1. Immediate Findings

- [x] Confirm affected customer symptom: posts did not upload for 2026-05-17, 2026-05-18, and 2026-05-19 KST.
- [x] Identify likely affected account: `당고` / `@dangzang.gogo`.
- [x] Confirm daily scheduler ran for affected dates.
- [x] Confirm account result was `NO_DRAFT_POSTS` with `queuedCount: 0`.
- [x] Confirm repeated OpenAI `429 quota exceeded` logs during topic/post generation.
- [x] Confirm settings-save bug class: omitted fields could be treated as `undefined` and normalized back to defaults.

## 2. Code Fixes

- [x] Fix account settings sanitizer to ignore `undefined` fields before normalization.
- [x] Add regression test for preserving existing schedule settings when partial payloads contain `undefined`.
- [x] Audit every account settings write path for accidental full-object saves.
- [x] Audit customer beta settings panel save payloads.
- [x] Audit classic customer settings page save payloads.
- [x] Audit admin account settings save payloads.
- [x] Replace customer PATCH route destructuring with an allowlist that only forwards submitted fields.
- [x] Audit assistant-generated settings drafts so they only patch explicit fields.
- [x] Audit product-level settings patch routes for the same `undefined` merge/reset pattern.
- [ ] Add shared helper for dropping `undefined` recursively from patch payloads if needed.
- [ ] Add route-level tests for partial customer account patch payloads.
- [ ] Add route-level tests for partial admin account patch payloads.

## 3. Data Repair

- [ ] Export current active account schedule settings before any repair.
- [ ] Identify accounts changed around 2026-05-18 17:59-18:03 UTC.
- [ ] Compare account settings against historical queue patterns where possible.
- [ ] Restore affected accounts that were unintentionally reset to standard defaults.
- [ ] Restore `당고` to the customer-requested daily count and preferred upload time.
- [ ] Create an audit note for every manual repair.
- [ ] Verify repaired accounts show expected settings in customer UI/API response.

## 4. Upload Recovery

- [ ] Fix OpenAI billing/quota or switch the production model/key to a healthy quota source.
- [ ] Add explicit alert when OpenAI 429 causes fallback-only generation.
- [ ] Improve pipeline result messaging so `NO_DRAFT_POSTS` is surfaced as system-side failure, not customer misconfiguration.
- [ ] Regenerate missing queue for `당고`.
- [ ] Run manual pipeline for `당고` after quota/settings repair.
- [ ] Verify at least one scheduled queue item exists after recovery.
- [ ] Verify actual Threads upload after the next scheduled slot.
- [ ] Check other running accounts with `NO_DRAFT_POSTS` on 2026-05-17 through 2026-05-19.
- [ ] Regenerate queues for all affected running accounts.

## 5. Regression Checks

- [x] `node --test src/services/accountService.test.js`
- [x] `npm test --prefix server`
- [x] `npm run build --prefix client`
- [ ] Manual API check: PATCH one field only and verify schedule fields remain unchanged.
- [ ] Manual UI check: save customer profile/text fields and verify daily count/time remain unchanged.
- [ ] Manual UI check: save schedule fields and verify only intended fields change.

## 6. Deployment

- [ ] Review diff for only intended settings-save changes.
- [ ] Deploy backend hotfix.
- [ ] Confirm production health after deploy.
- [ ] Confirm the sanitizer fix is live by running a production-safe partial PATCH test on a test account.
- [ ] Backfill/repair production account settings after the fix is live.
