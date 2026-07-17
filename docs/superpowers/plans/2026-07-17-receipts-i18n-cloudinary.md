# Receipts i18n, Cloudinary Uploads & Receipt Design Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A donor gets a receipt in their own language, with their mandal's real logo on it, uploaded to Cloudinary.

**Architecture:** Only the donor-facing strings (the ten `strings.receipt` keys plus the SMS body) become multilingual, in one new `src/lib/i18n/receipt.ts` keyed by a `Lang` union; the admin/volunteer UI stays English. Language rides on the receipt link as `?lang=mr` — no per-donation column — chosen by a segmented picker preset to `mandals.default_lang`. Cloudinary uploads are authorised by a Supabase Edge Function that derives the target folder from the caller's JWT, never the request body.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind, Supabase (Postgres + Edge Functions/Deno), Vitest + React Testing Library, Playwright, bash + psql (`supabase/verify-local.sh`).

**Spec:** `docs/superpowers/specs/2026-07-17-receipts-i18n-cloudinary-design.md`

**Depends on:** Project A (`docs/superpowers/plans/2026-07-17-multi-tenancy.md`), complete. `mandals` exists; `get_public_receipt(token)` already returns the receipt's own mandal branding.

## Global Constraints

- TypeScript strict. Run `npm run typecheck` and `npm run test -- --run` after every task, before committing.
- **No new npm dependencies.** No i18n library. This project has NO `@testing-library/user-event` — use `fireEvent` (see `tests/CollectionForm.test.tsx`).
- Admin/volunteer UI copy stays in `src/lib/strings.ts` and stays English. `src/lib/i18n/receipt.ts` is for donor-facing copy only. No inline text in JSX.
- **Never commit, echo, or persist Cloudinary credentials** — not to the repo, not to a memory file, not into a commit message. They live only in Edge Function secrets.
- **The Edge Function derives `mandal_id` from the caller's JWT, never from the request body.** Same rule the insert trigger enforces in Project A.
- Do NOT touch `src/lib/money.ts` or `src/lib/reconcile.ts` — 100% coverage is enforced by `vite.config.ts` thresholds.
- Money stays in Latin digits via the existing `formatINR` (`en-IN`). Not in scope to change.
- `bash supabase/verify-local.sh` must exit 0 after any task touching SQL. No Docker on this machine: `supabase start` and `supabase functions serve` are unavailable. `supabase functions deploy --use-api` works (bundles server-side).
- Migrations are applied with `supabase db push --yes`, then `npm run db:types` — in that order. If `db:types` output disagrees with your migration, the push did not happen; stop and report.
- **Do not weaken an assertion to make a test pass.** A skipped test naming its blocker beats a passing test that asserts nothing.

## File Structure

**Created:**
- `src/lib/i18n/receipt.ts` — `Lang`, `LANGS`, `toLang()`, `receiptStrings`. The single home for donor-facing copy in all four languages. Separate from `strings.ts` because it has a different shape (keyed by language) and a different audience (donors, not operators).
- `tests/i18n-receipt.test.ts` — `toLang` fallbacks + the shape test.
- `supabase/functions/sign-upload/signature.ts` — pure, no I/O. Imported by both the Deno handler and Vitest; this is the only part of the Edge Function that can be unit-tested without Docker.
- `supabase/functions/sign-upload/index.ts` — the handler (auth + HTTP only, deliberately thin).
- `tests/cloudinary-signature.test.ts` — the signature vector.
- `supabase/migrations/20260717170000_default_lang.sql`

**Modified:**
- `src/lib/strings.ts` — `receipt` and `collection.smsMessage` move out; a `defaultLangLabel` + picker labels move in.
- `src/features/receipt/ReceiptPage.tsx` — reads `?lang=`, sets `lang` attr, design pass.
- `src/features/collection/send.ts` — all three functions take `lang`.
- `src/features/collection/CollectionForm.tsx`, `PendingSend.tsx` — the picker.
- `src/features/settings/MandalConfig.tsx` — the mandal's default language.
- `src/lib/db/config.ts` — `uploadMandalAsset` body swaps to Cloudinary; `getMandalDefaultLang()` added.
- `supabase/verify-local.sh` — assertions for the new RPC.
- Tests for each of the above.

**Task order rationale:** Task 1 is a pure refactor that must stay green (it proves the move didn't change behaviour before any translation lands). Task 2's translations are reviewed by a human before anything depends on them. Tasks 5–6 (Cloudinary) are independent of 1–4 (language) and could run in either order; they're last because they need credentials.

---

### Task 1: Move the donor-facing strings into an i18n module (English only)

A pure refactor. No behaviour changes, no new copy. If any rendered text changes, something is wrong.

**Files:**
- Create: `src/lib/i18n/receipt.ts`, `tests/i18n-receipt.test.ts`
- Modify: `src/lib/strings.ts` (delete the `receipt` block ~line 193-204 and `collection.smsMessage` ~line 96-97), `src/features/receipt/ReceiptPage.tsx` (import), `src/features/collection/send.ts` (import)

**Interfaces:**
- Consumes: nothing new.
- Produces: `LANGS: readonly ['en','mr','hi','gu']`; `type Lang = 'en'|'mr'|'hi'|'gu'`; `type ReceiptStrings`; `receiptStrings: Record<Lang, ReceiptStrings>` (only `en` populated by this task); `toLang(value: string | null | undefined): Lang`.

- [ ] **Step 1: Write the failing test**

Create `tests/i18n-receipt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toLang, receiptStrings, LANGS } from '../src/lib/i18n/receipt'

describe('toLang', () => {
  it('accepts every supported language code', () => {
    for (const lang of LANGS) expect(toLang(lang)).toBe(lang)
  })

  // This reads a URL a donor could have mangled, so every bad input is a
  // fallback, never a throw.
  it.each([
    ['unknown code', 'xx'],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['a path traversal attempt', '../../etc/passwd'],
    ['wrong case', 'MR'],
  ])('falls back to English for %s', (_label, value) => {
    expect(toLang(value as string | null | undefined)).toBe('en')
  })
})

describe('receiptStrings', () => {
  it('English copy is unchanged from the pre-i18n strings', () => {
    expect(receiptStrings.en.notFound).toBe('Receipt not found.')
    expect(receiptStrings.en.stampCash).toBe('RECEIVED: CASH')
    expect(receiptStrings.en.signatureLabel).toBe('President')
    expect(receiptStrings.en.smsMessage(500, 'https://x.test/r/abc')).toBe(
      'Thank you for your ₹500 contribution. View your official receipt here: https://x.test/r/abc',
    )
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/i18n-receipt.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/i18n/receipt"`.

- [ ] **Step 3: Create the module with the English strings copied verbatim**

Create `src/lib/i18n/receipt.ts`. The `en` values are copied **exactly** from `src/lib/strings.ts` — changing English copy here would make a review of the translations (Task 2) inseparable from a review of a rewrite.

```ts
// Donor-facing copy, in every language a receipt can be sent in. This is
// deliberately separate from strings.ts: that file is operator-facing UI copy
// and stays English (SPEC.md assumption 5), while these ten strings plus the
// message body are the only text a donor ever reads.
export const LANGS = ['en', 'mr', 'hi', 'gu'] as const
export type Lang = (typeof LANGS)[number]

export type ReceiptStrings = {
  notFound: string
  donorLabel: string
  amountLabel: string
  receiptNoLabel: string
  dateLabel: string
  stampCash: string
  stampOnline: string
  voidedBanner: string
  voidedReasonPrefix: string
  signatureLabel: string
  // Kept short (SMS length matters). {amountRupees} is a plain number
  // (no thousands separator, no repeated ₹) so the message stays short.
  smsMessage: (amountRupees: number, receiptLink: string) => string
}

export const receiptStrings: Record<Lang, ReceiptStrings> = {
  en: {
    notFound: 'Receipt not found.',
    donorLabel: 'Donor',
    amountLabel: 'Amount',
    receiptNoLabel: 'Receipt No.',
    dateLabel: 'Date',
    stampCash: 'RECEIVED: CASH',
    stampOnline: 'RECEIVED: ONLINE',
    voidedBanner: 'This entry has been voided',
    voidedReasonPrefix: 'Reason: ',
    signatureLabel: 'President',
    smsMessage: (amountRupees, receiptLink) =>
      `Thank you for your ₹${amountRupees} contribution. View your official receipt here: ${receiptLink}`,
  },
  // mr/hi/gu land in Task 2.
} as Record<Lang, ReceiptStrings>

// Resolves a ?lang= query param. Unknown, absent, or hostile values fall back
// to English rather than throwing — this reads a URL a donor could have
// mangled, and a broken receipt is worse than an English one.
export function toLang(value: string | null | undefined): Lang {
  return LANGS.includes(value as Lang) ? (value as Lang) : 'en'
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -- --run tests/i18n-receipt.test.ts`
Expected: PASS.

- [ ] **Step 5: Point the two consumers at the new module**

In `src/features/receipt/ReceiptPage.tsx`, replace `const t = strings.receipt` with:

```tsx
import { receiptStrings } from '../../lib/i18n/receipt'

const t = receiptStrings.en
```

Keep the `strings` import — `strings.auth.loading` is still used.

In `src/features/collection/send.ts`, both `sendReceiptSms` and `sendReceiptWhatsApp` build their message from `strings.collection.smsMessage`. Replace with:

```ts
import { receiptStrings } from '../../lib/i18n/receipt'
```

and in both functions:

```ts
  const message = receiptStrings.en.smsMessage(toRupees(donation.amount_paise), receiptUrl(donation.public_token))
```

Then delete the `receipt: { … }` block and the `smsMessage` key (with its two comment lines) from `src/lib/strings.ts`.

- [ ] **Step 6: Fix the tests that referenced the moved strings**

Run: `npm run typecheck`
Expected: errors in any test asserting `strings.receipt.*` or `strings.collection.smsMessage`. Update those to import from `../src/lib/i18n/receipt` instead. Do not change any asserted *value* — the copy has not changed.

- [ ] **Step 7: Verify the refactor changed nothing**

Run: `npm run typecheck && npm run test -- --run && npm run lint`
Expected: all pass, and **no test's expected string needed editing**. If one did, the copy moved wrong — fix it, don't update the expectation.

- [ ] **Step 8: Commit**

```bash
git add src/lib/i18n/receipt.ts tests/i18n-receipt.test.ts src/lib/strings.ts src/features/receipt/ReceiptPage.tsx src/features/collection/send.ts tests/
git commit -m "refactor(i18n): move donor-facing copy into src/lib/i18n/receipt.ts

Pure move, English only — the ten strings.receipt keys plus the SMS body,
copied verbatim. Adds the Lang union and toLang()'s fallback so a mangled
?lang= can never break a donor's receipt.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The translations (Marathi, Hindi, Gujarati)

**Files:**
- Modify: `src/lib/i18n/receipt.ts`, `tests/i18n-receipt.test.ts`

**Interfaces:**
- Consumes: `ReceiptStrings`, `receiptStrings`, `LANGS` from Task 1.
- Produces: `receiptStrings` fully populated for all four languages.

- [ ] **Step 1: Write the failing shape test**

A missing key is otherwise invisible until a donor sees an `undefined` on their receipt. Append to `tests/i18n-receipt.test.ts`:

```ts
describe('every language is complete', () => {
  it.each(LANGS)('%s has every receipt string, non-empty', (lang) => {
    const s = receiptStrings[lang]
    expect(s).toBeDefined()
    const keys: (keyof typeof s)[] = [
      'notFound', 'donorLabel', 'amountLabel', 'receiptNoLabel', 'dateLabel',
      'stampCash', 'stampOnline', 'voidedBanner', 'voidedReasonPrefix', 'signatureLabel',
    ]
    for (const key of keys) {
      expect(typeof s[key], `${lang}.${String(key)}`).toBe('string')
      expect((s[key] as string).length, `${lang}.${String(key)}`).toBeGreaterThan(0)
    }
    const msg = s.smsMessage(500, 'https://x.test/r/abc')
    expect(msg).toContain('500')
    expect(msg).toContain('https://x.test/r/abc')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/i18n-receipt.test.ts`
Expected: FAIL for `mr`, `hi`, `gu` — `expected undefined to be defined`. (Task 1's `as Record<Lang, ReceiptStrings>` cast is what let those be missing at compile time; this test is what catches it at runtime.)

- [ ] **Step 3: Add the three languages**

Replace the `mr/hi/gu land in Task 2` comment in `src/lib/i18n/receipt.ts` with:

```ts
  mr: {
    notFound: 'पावती सापडली नाही.',
    donorLabel: 'देणगीदार',
    amountLabel: 'रक्कम',
    receiptNoLabel: 'पावती क्र.',
    dateLabel: 'दिनांक',
    stampCash: 'मिळाले: रोख',
    stampOnline: 'मिळाले: ऑनलाइन',
    voidedBanner: 'ही नोंद रद्द करण्यात आली आहे',
    voidedReasonPrefix: 'कारण: ',
    signatureLabel: 'अध्यक्ष',
    smsMessage: (amountRupees, receiptLink) =>
      `तुमच्या ₹${amountRupees} वर्गणीबद्दल धन्यवाद. तुमची अधिकृत पावती येथे पहा: ${receiptLink}`,
  },
  hi: {
    notFound: 'रसीद नहीं मिली.',
    donorLabel: 'दानदाता',
    amountLabel: 'राशि',
    receiptNoLabel: 'रसीद सं.',
    dateLabel: 'दिनांक',
    stampCash: 'प्राप्त: नकद',
    stampOnline: 'प्राप्त: ऑनलाइन',
    voidedBanner: 'यह प्रविष्टि रद्द कर दी गई है',
    voidedReasonPrefix: 'कारण: ',
    signatureLabel: 'अध्यक्ष',
    smsMessage: (amountRupees, receiptLink) =>
      `आपके ₹${amountRupees} के योगदान के लिए धन्यवाद. अपनी आधिकारिक रसीद यहाँ देखें: ${receiptLink}`,
  },
  gu: {
    notFound: 'રસીદ મળી નથી.',
    donorLabel: 'દાતા',
    amountLabel: 'રકમ',
    receiptNoLabel: 'રસીદ નં.',
    dateLabel: 'તારીખ',
    stampCash: 'મળ્યું: રોકડ',
    stampOnline: 'મળ્યું: ઓનલાઈન',
    voidedBanner: 'આ નોંધ રદ કરવામાં આવી છે',
    voidedReasonPrefix: 'કારણ: ',
    signatureLabel: 'પ્રમુખ',
    smsMessage: (amountRupees, receiptLink) =>
      `તમારા ₹${amountRupees} ના યોગદાન બદલ આભાર. તમારી અધિકૃત રસીદ અહીં જુઓ: ${receiptLink}`,
  },
```

Then drop the now-unnecessary `as Record<Lang, ReceiptStrings>` cast from the end of the object, so a future missing language is a **compile** error rather than a runtime one.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -- --run tests/i18n-receipt.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: STOP — human review gate**

These strings were written by a model that cannot verify them, and they go to every donor of every mandal. A receipt exists to look official; stilted Marathi actively undermines the trust this product sells.

Print all three languages' strings for the user and **ask for review before continuing**. Do not bury them in a diff. Say plainly: *"I can't verify these read naturally. Please have a native speaker check them — particularly `वर्गणी` (vargani), which is the domain term this whole product is named after."*

Apply any corrections verbatim. Do not argue with a native speaker about their own language.

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n/receipt.ts tests/i18n-receipt.test.ts
git commit -m "feat(i18n): add Marathi, Hindi and Gujarati receipt copy

Reviewed by a native speaker before merge. The shape test makes a missing
key a test failure rather than an 'undefined' on a donor's receipt, and
dropping the Record cast makes a missing language a compile error.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `mandals.default_lang` + the RPC volunteers read it through

**Files:**
- Create: `supabase/migrations/20260717170000_default_lang.sql`
- Modify: `supabase/verify-local.sh`, `src/lib/db/config.ts`, `src/features/settings/MandalConfig.tsx`, `src/lib/strings.ts`, `tests/config.test.ts`

**Interfaces:**
- Consumes: `app_mandal_id()` and `mandals` from Project A; `Lang`/`toLang` from Task 1.
- Produces: `mandals.default_lang`; `get_mandal_default_lang() returns text`; `getMandalDefaultLang(): Promise<Lang>` in `src/lib/db/config.ts`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260717170000_default_lang.sql`:

```sql
-- The language a mandal's receipts default to. Without it a Marathi mandal's
-- volunteers would pick Marathi on every single donation — and SPEC.md's
-- criterion 1 (≤3 taps to the SMS composer) means the picker must cost zero
-- taps when the default is already right.
alter table mandals add column default_lang text not null default 'en'
  check (default_lang in ('en','mr','hi','gu'));

-- Volunteers have no read access to mandals (mandals_admin_select is
-- admin-only), but the collection form needs this to preset its picker.
-- Same narrowly-scoped SECURITY DEFINER shape as get_expense_categories():
-- exposes exactly one column of exactly the caller's own mandal.
create or replace function get_mandal_default_lang() returns text
language sql stable security definer set search_path = public as $$
  select default_lang from mandals where id = app_mandal_id()
$$;

-- Postgres grants EXECUTE to PUBLIC on creation; revoke before granting.
revoke execute on function get_mandal_default_lang() from public;
grant execute on function get_mandal_default_lang() to authenticated;
```

- [ ] **Step 2: Add the failing assertions**

Append to `supabase/verify-local.sh`, immediately before `echo "== all assertions passed =="`:

```bash
echo "== assertion: get_mandal_default_lang() is per-mandal and volunteer-readable =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set role postgres;
update mandals set default_lang = 'mr' where id = '11111111-1111-1111-1111-000000000001';
update mandals set default_lang = 'gu' where id = '22222222-2222-2222-2222-000000000002';
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002'; -- Volunteer One, mandal one
DO $$
BEGIN
  -- A volunteer cannot read mandals directly, which is exactly why this RPC
  -- exists — same gap get_expense_categories() closes.
  ASSERT NOT EXISTS (SELECT 1 FROM mandals),
    'FAIL: expected mandals direct select to be empty for a volunteer';
  ASSERT get_mandal_default_lang() = 'mr',
    format('FAIL: volunteer should read their own mandal''s default_lang, got %s', get_mandal_default_lang());
END $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-0000000000b1'; -- mandal two admin
DO $$
BEGIN
  ASSERT get_mandal_default_lang() = 'gu',
    'LEAK: get_mandal_default_lang() returned another mandal''s value';
  RAISE NOTICE 'PASS: get_mandal_default_lang() is scoped to the caller''s own mandal';
END $$;
reset role;
SQL

echo "== assertion: get_mandal_default_lang() is not exposed to anon =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
set request.jwt.claim.sub = '';
set role anon;
DO $$
BEGIN
  BEGIN
    PERFORM get_mandal_default_lang();
    RAISE EXCEPTION 'SECURITY HOLE: anon called get_mandal_default_lang()';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS: anon is rejected from get_mandal_default_lang() (%)', SQLERRM;
  END;
END $$;
reset role;
SQL

echo "== assertion: default_lang rejects an unsupported code =="
"${PSQL[@]}" -d "$DB_NAME" <<'SQL'
DO $$
BEGIN
  BEGIN
    UPDATE mandals SET default_lang = 'fr' WHERE id = '11111111-1111-1111-1111-000000000001';
    RAISE EXCEPTION 'FAIL: default_lang accepted an unsupported language code';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS: default_lang check constraint rejects an unsupported code';
  END;
END $$;
SQL
```

- [ ] **Step 3: Run the script**

Run: `bash supabase/verify-local.sh`
Expected: `PASS: all migration/trigger/RLS assertions held.`, exit 0, with the three new PASS notices. If the anon assertion fails, the `revoke ... from public` is missing.

- [ ] **Step 4: Push and regenerate types**

```bash
supabase db push --yes
npm run db:types
```
Expected: `Applying migration 20260717170000_default_lang.sql...`, then `default_lang: string` appears under `mandals` in `src/lib/db/database.types.ts`, and `get_mandal_default_lang` under `Functions`.

If `db:types` doesn't show them, the push didn't happen — **stop and report**. Do not hand-edit the generated file.

- [ ] **Step 5: Write the failing client test**

Append to `tests/config.test.ts`:

```ts
describe('getMandalDefaultLang', () => {
  it('calls the get_mandal_default_lang RPC', async () => {
    rpc.mockResolvedValue({ data: 'mr', error: null })
    const result = await getMandalDefaultLang()
    expect(rpc).toHaveBeenCalledWith('get_mandal_default_lang')
    expect(result).toBe('mr')
  })

  // A mandal row could hold a code this build doesn't know (rolled back
  // deploy, hand-edited row). The picker must not render a broken option.
  it('falls back to English for an unrecognised value', async () => {
    rpc.mockResolvedValue({ data: 'fr', error: null })
    expect(await getMandalDefaultLang()).toBe('en')
  })

  // Never block the collection form on this — it's a preference, not data.
  it('falls back to English when the RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('boom') })
    expect(await getMandalDefaultLang()).toBe('en')
  })
})
```

Add `getMandalDefaultLang` to that file's import from `../src/lib/db/config`.

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test -- --run tests/config.test.ts`
Expected: FAIL — `getMandalDefaultLang is not a function`.

- [ ] **Step 7: Implement it**

Add to `src/lib/db/config.ts` (and add `import { toLang, type Lang } from '../i18n/receipt'` at the top):

```ts
// mandals is admin-only at the RLS level, so a volunteer session reads this
// one column through the RPC instead — same pattern as getExpenseCategories.
// Never throws: the picker's preset is a convenience, and failing it would
// block the collection form over a preference.
export async function getMandalDefaultLang(): Promise<Lang> {
  const { data, error } = await supabase.rpc('get_mandal_default_lang')
  if (error) return 'en'
  return toLang(data)
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `npm run test -- --run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 9: Let an admin set it**

In `src/lib/strings.ts`, add to the `mandalConfig` block:

```ts
    defaultLangLabel: 'Default receipt language',
    defaultLangHelp: 'Preselected when a volunteer sends a receipt. They can still change it per donation.',
```

And add a top-level block for the language names (used by every picker in Tasks 3 and 4 — one home, not three copies):

```ts
  languages: {
    en: 'English',
    mr: 'मराठी',
    hi: 'हिंदी',
    gu: 'ગુજરાતી',
  },
```

In `src/features/settings/MandalConfig.tsx`: add `const [defaultLang, setDefaultLang] = useState<Lang>('en')`, set it in `applyConfig` via `setDefaultLang(toLang(config.default_lang))`, include `default_lang: defaultLang` in the `updateMandal` patch, and render a select above the save button:

```tsx
        <label htmlFor="default-lang" className="text-sm text-stone-600">
          {t.defaultLangLabel}
        </label>
        <select
          id="default-lang"
          value={defaultLang}
          onChange={(event) => setDefaultLang(toLang(event.target.value))}
          className="rounded border border-stone-300 px-3 py-2"
        >
          {LANGS.map((lang) => (
            <option key={lang} value={lang}>
              {strings.languages[lang]}
            </option>
          ))}
        </select>
        <p className="text-xs text-stone-500">{t.defaultLangHelp}</p>
```

Import `LANGS`, `toLang`, and `type Lang` from `../../lib/i18n/receipt`.

- [ ] **Step 10: Verify and commit**

Run: `bash supabase/verify-local.sh && npm run typecheck && npm run test -- --run && npm run lint`
Expected: all pass.

```bash
git add supabase/migrations/20260717170000_default_lang.sql supabase/verify-local.sh src/lib/db/ src/lib/db/database.types.ts src/features/settings/MandalConfig.tsx src/lib/strings.ts tests/config.test.ts
git commit -m "feat(i18n): per-mandal default receipt language

Adds mandals.default_lang plus the narrowly-scoped RPC volunteers read it
through (mandals itself is admin-only), and a selector on mandal settings.
Asserted per-mandal, volunteer-readable, anon-rejected, and that the check
constraint refuses an unsupported code.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Language reaches the donor — `?lang=`, and the pickers

**Files:**
- Modify: `src/features/collection/send.ts`, `src/features/receipt/ReceiptPage.tsx`, `src/features/collection/CollectionForm.tsx`, `src/features/collection/PendingSend.tsx`, `src/lib/strings.ts`
- Test: `tests/send.test.ts` (exists), `tests/ReceiptPage.test.tsx`, `tests/CollectionForm.test.tsx`, `tests/PendingSend.test.tsx`

**Interfaces:**
- Consumes: `Lang`, `toLang`, `receiptStrings` (Task 1/2); `getMandalDefaultLang()` (Task 3).
- Produces: `receiptUrl(publicToken: string, lang: Lang): string`; `sendReceiptSms(donation: Donation, lang: Lang): void`; `sendReceiptWhatsApp(donation: Donation, lang: Lang): void`.

- [ ] **Step 1: Write the failing send tests**

`lang` is a required parameter, not optional-with-default — a default is how a caller silently sends English forever. Add to `tests/send.test.ts`:

```ts
import { receiptUrl } from '../src/features/collection/send'
import { LANGS } from '../src/lib/i18n/receipt'

describe('receiptUrl', () => {
  it.each(LANGS)('carries lang=%s on the link', (lang) => {
    expect(receiptUrl('tok123', lang)).toBe(`${window.location.origin}/r/tok123?lang=${lang}`)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/send.test.ts`
Expected: FAIL — the link has no `?lang=` (and typecheck complains about the extra argument).

- [ ] **Step 3: Thread `lang` through send.ts**

In `src/features/collection/send.ts`:

```ts
import { receiptStrings, type Lang } from '../../lib/i18n/receipt'

// The donor's language rides on the link rather than on the donation row:
// no column, no migration, and the receipt page reads it straight back out.
export function receiptUrl(publicToken: string, lang: Lang): string {
  return `${window.location.origin}/r/${publicToken}?lang=${lang}`
}

export function sendReceiptSms(donation: Donation, lang: Lang): void {
  const message = receiptStrings[lang].smsMessage(toRupees(donation.amount_paise), receiptUrl(donation.public_token, lang))
  window.location.href = buildSmsLink(donation.donor_phone ?? '', message)
  markSmsSent(donation.id).catch(() => {})
}

export function sendReceiptWhatsApp(donation: Donation, lang: Lang): void {
  const message = receiptStrings[lang].smsMessage(toRupees(donation.amount_paise), receiptUrl(donation.public_token, lang))
  window.open(buildWhatsAppLink(donation.donor_phone ?? '', message), '_blank', 'noopener')
  markSmsSent(donation.id).catch(() => {})
}
```

Keep every existing comment in this file — the iOS `&body=` quirk and the `wa.me` country-code note are still true and hard-won.

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -- --run tests/send.test.ts`
Expected: PASS. `npm run typecheck` now fails in `CollectionForm.tsx`/`PendingSend.tsx` — expected; Steps 7-8 fix those.

- [ ] **Step 5: Write the failing receipt-page test**

Add to `tests/ReceiptPage.test.tsx` (its render helper already uses `MemoryRouter` + `Routes`; extend the initial entry with a query string):

```tsx
  it('renders Marathi copy for ?lang=mr', async () => {
    getPublicReceipt.mockResolvedValue(receiptRow)
    render(
      <MemoryRouter initialEntries={['/r/token-1?lang=mr']}>
        <Routes><Route path="/r/:public_token" element={<ReceiptPage />} /></Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('देणगीदार')).toBeInTheDocument()
  })

  it('falls back to English for an unknown ?lang=', async () => {
    getPublicReceipt.mockResolvedValue(receiptRow)
    render(
      <MemoryRouter initialEntries={['/r/token-1?lang=xx']}>
        <Routes><Route path="/r/:public_token" element={<ReceiptPage />} /></Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Donor')).toBeInTheDocument()
  })
```

`receiptRow` is the existing fixture in that file (the one carrying `mandal_name`/`logo_url`/`receipt_prefix`). Reuse it; do not duplicate it.

- [ ] **Step 6: Read the lang on the receipt page**

In `src/features/receipt/ReceiptPage.tsx`, replace the module-level `const t = receiptStrings.en` with a per-render lookup, and set the `lang` attribute:

```tsx
import { useParams, useSearchParams } from 'react-router-dom'
import { receiptStrings, toLang } from '../../lib/i18n/receipt'
```

Inside the component, above the effect:

```tsx
  const [searchParams] = useSearchParams()
  // The donor's language. toLang() falls back to English for anything
  // unrecognised — this is a URL a donor could have mangled.
  const lang = toLang(searchParams.get('lang'))
  const t = receiptStrings[lang]
```

`t` is referenced in the `not-found` branch too, so it must be declared before the early returns. Then on the receipt's outer `<div>`, add `lang={lang}` — this is what makes the browser pick a Devanagari/Gujarati-capable system font, and is why no webfont is needed.

- [ ] **Step 7: Run it to verify it passes**

Run: `npm run test -- --run tests/ReceiptPage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Write the failing collection-form picker test**

Add to `tests/CollectionForm.test.tsx`. It already mocks `../src/lib/queue/sync`; add a mock for `../src/lib/db/config`'s `getMandalDefaultLang` returning `'mr'`, and for `./send`'s `sendReceiptSms`:

```tsx
  it('presets the language picker from the mandal default and sends in it', async () => {
    getMandalDefaultLang.mockResolvedValue('mr')
    syncOutboxItem.mockResolvedValue(donationRow)
    render(<MemoryRouter><CollectionForm /></MemoryRouter>)

    await waitFor(() => expect(screen.getByRole('radio', { name: 'मराठी' })).toBeChecked())

    fireEvent.change(screen.getByLabelText('Donor Name'), { target: { value: 'Test Donor' } })
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9876543210' } })
    fireEvent.change(screen.getByLabelText('Amount (₹)'), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'cash' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record Donation' }))

    await waitFor(() => expect(sendReceiptSms).toHaveBeenCalledWith(donationRow, 'mr'))
  })
```

Match the existing fixture and label names in that file rather than the ones guessed here — read it first.

- [ ] **Step 9: Add the picker**

In `src/lib/strings.ts`, add to the `collection` block:

```ts
    languageLabel: 'Receipt language',
```

In `src/features/collection/CollectionForm.tsx`:

```tsx
import { getMandalDefaultLang } from '../../lib/db/config'
import { LANGS, type Lang } from '../../lib/i18n/receipt'
```

Add state and the preset effect:

```tsx
  // Preset, not a prompt: SPEC.md criterion 1 gives the volunteer ≤3 taps to
  // the SMS composer, so the common case (the mandal's own language) must
  // cost zero of them. getMandalDefaultLang never throws — worst case this
  // stays 'en'.
  const [lang, setLang] = useState<Lang>('en')
  useEffect(() => {
    let active = true
    getMandalDefaultLang().then((l) => {
      if (active) setLang(l)
    })
    return () => {
      active = false
    }
  }, [])
```

Render a segmented radio group inside the form (radios, not a `<select>` — one tap to change on a phone, and it announces properly to a screen reader):

```tsx
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm text-stone-600">{t.languageLabel}</legend>
          <div className="flex gap-1">
            {LANGS.map((code) => (
              <label
                key={code}
                className={`flex-1 cursor-pointer rounded border px-2 py-2 text-center text-sm ${
                  lang === code ? 'border-orange-700 bg-orange-50 text-orange-900' : 'border-stone-300 text-stone-600'
                }`}
              >
                <input
                  type="radio"
                  name="receipt-lang"
                  value={code}
                  checked={lang === code}
                  onChange={() => setLang(code)}
                  className="sr-only"
                />
                {strings.languages[code]}
              </label>
            ))}
          </div>
        </fieldset>
```

Pass `lang` at all three call sites in this file: `sendReceiptSms(synced, lang)` in `handleSubmit`, and `sendReceiptSms(lastDonation, lang)` / `sendReceiptWhatsApp(lastDonation, lang)` on the fallback buttons.

- [ ] **Step 10: Add the same picker to Pending Send**

`PendingSend` re-sends donations that synced later — including every offline one, which by design arrives with **no** collection-time language (the spec's "Send flow" section explains why threading it through the Dexie outbox is the rejected design arriving by the back door). So this tray needs its own picker, preset the same way.

In `src/features/collection/PendingSend.tsx`, add the identical `lang` state + `getMandalDefaultLang()` effect, render the same fieldset above the list, and pass `lang` in `handleSendSms`/`handleSendWhatsApp`:

```tsx
  function handleSendSms(donation: Donation) {
    sendReceiptSms(donation, lang)
    setSentIds((prev) => new Set(prev).add(donation.id))
  }
```

Keep the rest of each handler exactly as it is.

- [ ] **Step 11: Verify and commit**

Run: `npm run typecheck && npm run test -- --run && npm run lint && npm run test:e2e`
Expected: all pass. If an e2e spec breaks on the new fieldset, fix the spec's selector — do not remove the picker.

```bash
git add src/features/collection/ src/features/receipt/ReceiptPage.tsx src/lib/strings.ts tests/
git commit -m "feat(i18n): send receipts in the donor's language

Language rides on the receipt link as ?lang=, chosen by a segmented picker
preset from the mandal's default — zero taps to accept, one to change, so
SPEC criterion 1's 3-tap budget is untouched. The receipt page sets the lang
attribute, which is what picks a Devanagari/Gujarati system font and is why
there's no webfont.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The Cloudinary signature (pure, testable)

**Files:**
- Create: `supabase/functions/sign-upload/signature.ts`, `tests/cloudinary-signature.test.ts`
- Modify: `tsconfig.json` (exclude), `eslint.config.js` (ignores) — see Step 5; the repo's
  current config would typecheck Task 6's Deno file under DOM libs and fail.

**Interfaces:**
- Consumes: nothing.
- Produces: `buildStringToSign(params: Record<string, string>): string`; `signParams(params: Record<string, string>, apiSecret: string): Promise<string>`.

**Why this file exists separately:** `supabase functions serve` needs Docker, which this machine lacks — the handler itself can't be unit-tested here. So the part that's easy to get wrong (the serialization) is extracted into a pure module Vitest can reach, and the handler is kept thin. Web Crypto (`crypto.subtle`) exists in both Deno and Node 18+, so one implementation serves both.

- [ ] **Step 1: Write the failing test**

The test vector is anchored to Cloudinary's published example at
https://cloudinary.com/documentation/signatures — the string-to-sign is quoted
**verbatim from those docs**; the hash is plain SHA-1 over it, which is deterministic and
independently reproducible (`node -e "console.log(require('crypto').createHash('sha1').update(S).digest('hex'))"`).

Create `tests/cloudinary-signature.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildStringToSign, signParams } from '../supabase/functions/sign-upload/signature'

// Cloudinary's documented worked example:
//   params  : public_id=sample_image, timestamp=1315060510,
//             eager=w_400,h_300,c_pad|w_260,h_200,c_crop
//   secret  : abcd
// https://cloudinary.com/documentation/signatures
const DOC_PARAMS = {
  public_id: 'sample_image',
  timestamp: '1315060510',
  eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
}
const DOC_STRING_TO_SIGN =
  'eager=w_400,h_300,c_pad|w_260,h_200,c_crop&public_id=sample_image&timestamp=1315060510'
const DOC_SIGNATURE = 'bfd09f95f331f558cbd1320e67aa8d488770583e'

describe('buildStringToSign', () => {
  // The fallible part: alphabetical sort, = between name and value, & between
  // pairs. Cloudinary publishes this exact string, so it's checkable.
  it('matches Cloudinary’s documented serialization', () => {
    expect(buildStringToSign(DOC_PARAMS)).toBe(DOC_STRING_TO_SIGN)
  })

  it('sorts alphabetically by parameter name regardless of insertion order', () => {
    expect(buildStringToSign({ timestamp: '2', folder: 'a', context: 'z' })).toBe(
      'context=z&folder=a&timestamp=2',
    )
  })

  // file, cloud_name, resource_type and api_key are sent in the upload but are
  // NEVER signed. Including one produces an invalid signature server-side —
  // a failure that surfaces only on a real upload, so pin it here.
  it('excludes the four never-signed params', () => {
    expect(
      buildStringToSign({
        timestamp: '1',
        folder: 'mandals/x',
        file: 'blob',
        cloud_name: 'demo',
        resource_type: 'image',
        api_key: '123',
      }),
    ).toBe('folder=mandals/x&timestamp=1')
  })
})

describe('signParams', () => {
  it('reproduces Cloudinary’s documented signature', async () => {
    expect(await signParams(DOC_PARAMS, 'abcd')).toBe(DOC_SIGNATURE)
  })

  it('changes when the secret changes', async () => {
    expect(await signParams(DOC_PARAMS, 'wrong-secret')).not.toBe(DOC_SIGNATURE)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/cloudinary-signature.test.ts`
Expected: FAIL — `Failed to resolve import ".../signature"`.

- [ ] **Step 3: Implement it**

Create `supabase/functions/sign-upload/signature.ts`:

```ts
// Cloudinary's upload-signature algorithm, per
// https://cloudinary.com/documentation/signatures. Pure and I/O-free so
// Vitest can reach it: `supabase functions serve` needs Docker, which this
// machine doesn't have, so index.ts is untestable locally and everything
// worth testing lives here instead.
//
// Uses Web Crypto, which exists in both Deno (the Edge runtime) and Node 18+
// (Vitest) — one implementation, two runtimes, no duplication.

// Sent in the upload POST but never signed; signing one yields an "Invalid
// Signature" from Cloudinary that only shows up on a real upload.
const NEVER_SIGNED = new Set(['file', 'cloud_name', 'resource_type', 'api_key'])

export function buildStringToSign(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => !NEVER_SIGNED.has(key))
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')
}

// SHA-1 is Cloudinary's default signature algorithm.
export async function signParams(params: Record<string, string>, apiSecret: string): Promise<string> {
  const toSign = buildStringToSign(params) + apiSecret
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(toSign))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -- --run tests/cloudinary-signature.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Keep the Deno code out of the app's typecheck and lint**

This is not optional and not a "check whether" — it is already broken by default, verified:
`tsconfig.json` has **no `include`**, so it compiles everything except `node_modules`/`dist`,
with `lib: ["ES2023","DOM","DOM.Iterable"]` and no Deno types. `eslint.config.js` lints
`files: ['**/*.{ts,tsx}']` with only `dist`/`dev-dist`/`coverage` ignored. Task 6's `index.ts`
uses `Deno.serve`, `Deno.env`, and a `jsr:` import — all three fail under that config.

Fix it now, in this task, so Task 6 doesn't land on a red build.

In `tsconfig.json`:

```json
  "exclude": ["node_modules", "dist", "supabase/functions"]
```

In `eslint.config.js`, extend the ignores:

```js
  { ignores: ['dist', 'dev-dist', 'coverage', 'supabase/functions'] },
```

**`signature.ts` is still typechecked**, which is the point: `exclude` only removes files from
the program's *root set*, and `tests/cloudinary-signature.test.ts` imports it directly — so it
gets pulled into the program through that import and is checked as strictly as any app file.
`index.ts` is imported by nothing, so it drops out entirely. That is the correct split: the
file with logic stays covered, the Deno-only shell doesn't fight the browser tsconfig.

Run: `npm run typecheck && npm run lint && npm run test -- --run tests/cloudinary-signature.test.ts`
Expected: all pass. If `signature.ts` stops being typechecked (e.g. someone "helpfully" excludes
it from the test too), that's a regression — the whole reason it's a separate file is that it
*can* be checked.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/sign-upload/signature.ts tests/cloudinary-signature.test.ts tsconfig.json eslint.config.js
git commit -m "feat(uploads): Cloudinary signature builder, doc-anchored

Pure and I/O-free because supabase functions serve needs Docker, which this
machine lacks — so the fallible part (the serialization: alphabetical sort,
the four never-signed params) is extracted where Vitest can pin it against
Cloudinary's published worked example, and the handler stays thin.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The Edge Function, and uploads that use it

**Files:**
- Create: `supabase/functions/sign-upload/index.ts`
- Modify: `src/lib/db/config.ts` (`uploadMandalAsset` body), `tests/config.test.ts`, `.env.example`

**Interfaces:**
- Consumes: `signParams` from Task 5.
- Produces: the deployed `sign-upload` function; `uploadMandalAsset(mandalId, kind, file)` keeps its exact existing signature and contract (upload a file, return a URL for a `*_url` column) — only its body changes.

- [ ] **Step 1: Write the handler**

Create `supabase/functions/sign-upload/index.ts`:

```ts
// Authorises a Cloudinary upload for the calling admin's own mandal.
//
// The API secret lives here and never reaches the browser — that's the whole
// reason this function exists rather than an unsigned upload preset (which
// would be an open upload endpoint anyone could spam).
//
// Deliberately thin: `supabase functions serve` needs Docker, which the dev
// machine doesn't have, so nothing here is unit-tested. Everything with real
// logic is in ./signature.ts, which is. What's left is auth + plumbing, and
// it's verified by a real upload.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { signParams } from './signature.ts'

Deno.serve(async (req) => {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('missing authorization', { status: 401 })

  // Resolve the caller with THEIR jwt, so RLS applies exactly as it would in
  // the browser — users_self_select is what lets them read their own row.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  const { data: authUser } = await supabase.auth.getUser()
  if (!authUser?.user) return new Response('not authenticated', { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('mandal_id, role, active')
    .eq('auth_user_id', authUser.user.id)
    .maybeSingle()

  // Only an active admin of some mandal may upload branding for it.
  if (!appUser || !appUser.active || appUser.role !== 'admin') {
    return new Response('admin only', { status: 403 })
  }

  // The folder comes from the caller's OWN row — never from the request body.
  // Same rule enforce_insert_defaults() applies to mandal_id: a client that
  // asks to write into another mandal's folder is simply ignored, not obeyed.
  const folder = `mandals/${appUser.mandal_id}`
  const timestamp = Math.round(Date.now() / 1000).toString()

  const signature = await signParams({ folder, timestamp }, Deno.env.get('CLOUDINARY_API_SECRET')!)

  return new Response(
    JSON.stringify({
      signature,
      timestamp,
      folder,
      api_key: Deno.env.get('CLOUDINARY_API_KEY')!,
      cloud_name: Deno.env.get('CLOUDINARY_CLOUD_NAME')!,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
```

The secret is read but never returned. `api_key` and `cloud_name` are public by Cloudinary's own design (they appear in every upload URL); the secret is what must not leak.

- [ ] **Step 2: Set the secrets — the repo owner does this, not you**

These are the user's credentials. **Never** ask for them in chat, never echo them, never write them to a file, never put them in a commit message or a memory file.

Tell the user to run, with their own values:

```bash
supabase secrets set CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=...
```

Verify without revealing values:

```bash
supabase secrets list
```
Expected: all three names present (the CLI shows a digest, not the value). If any is missing, stop — the function will 500 at runtime with no useful message.

- [ ] **Step 3: Deploy**

```bash
supabase functions deploy sign-upload --use-api
```

`--use-api` bundles server-side; this machine has no Docker, which the default path needs.
Expected: `Deployed Functions on project ...`.

- [ ] **Step 4: Write the failing client test**

Replace the `uploadMandalAsset` describe block in `tests/config.test.ts`. It currently asserts the Storage path; it must now assert the Cloudinary flow. Add `functions: { invoke }` to the mocked supabase client in that file's `vi.mock`, and stub `global.fetch`:

```ts
describe('uploadMandalAsset', () => {
  const file = new File(['x'], 'logo.png', { type: 'image/png' })

  it('signs via the edge function, posts to Cloudinary, and returns secure_url', async () => {
    invoke.mockResolvedValue({
      data: {
        signature: 'sig123',
        timestamp: '1700000000',
        folder: 'mandals/m1',
        api_key: 'key123',
        cloud_name: 'democloud',
      },
      error: null,
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ secure_url: 'https://res.cloudinary.com/democloud/logo.png' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const url = await uploadMandalAsset('m1', 'logo', file)

    expect(invoke).toHaveBeenCalledWith('sign-upload')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.cloudinary.com/v1_1/democloud/image/upload',
      expect.objectContaining({ method: 'POST' }),
    )
    // The signed folder is the function's, never the caller's argument.
    const body = fetchMock.mock.calls[0][1].body as FormData
    expect(body.get('folder')).toBe('mandals/m1')
    expect(body.get('signature')).toBe('sig123')
    expect(body.get('api_key')).toBe('key123')
    expect(url).toBe('https://res.cloudinary.com/democloud/logo.png')
  })

  it('throws when the edge function refuses (e.g. a volunteer session)', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('admin only') })
    await expect(uploadMandalAsset('m1', 'logo', file)).rejects.toThrow('admin only')
  })

  it('throws when Cloudinary rejects the upload', async () => {
    invoke.mockResolvedValue({
      data: { signature: 's', timestamp: '1', folder: 'mandals/m1', api_key: 'k', cloud_name: 'c' },
      error: null,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }))
    await expect(uploadMandalAsset('m1', 'logo', file)).rejects.toThrow()
  })
})
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run test -- --run tests/config.test.ts`
Expected: FAIL — the current implementation calls `supabase.storage`, not `functions.invoke`.

- [ ] **Step 6: Swap the implementation**

Replace `uploadMandalAsset` in `src/lib/db/config.ts`:

```ts
// Uploads straight to Cloudinary, authorised by the sign-upload edge
// function. Two reasons it goes through the function rather than an unsigned
// preset: the API secret never reaches the browser, and the upload folder is
// derived from the caller's JWT server-side — an unsigned preset would be an
// open upload endpoint anyone reading this bundle could spam.
//
// `mandalId` stays for call-site clarity but is NOT trusted: the function
// signs its own folder from the session. If they disagree, the server wins.
// Old Supabase Storage URLs in *_url columns keep rendering — they're just
// strings, and nothing here touches them.
export async function uploadMandalAsset(mandalId: string, kind: MandalAssetKind, file: File): Promise<string> {
  const { data: sig, error } = await supabase.functions.invoke('sign-upload')
  if (error) throw error

  const form = new FormData()
  form.append('file', file)
  form.append('api_key', sig.api_key)
  form.append('timestamp', sig.timestamp)
  form.append('folder', sig.folder)
  form.append('signature', sig.signature)
  form.append('public_id', `${kind}-${Date.now()}`)

  const response = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloud_name}/image/upload`, {
    method: 'POST',
    body: form,
  })
  if (!response.ok) throw new Error(`Cloudinary upload failed (${response.status})`)

  const { secure_url } = await response.json()
  return secure_url
}
```

**Careful — `public_id` is signed by Cloudinary's rules but the function doesn't know it.** Adding an unsigned `public_id` to the POST makes Cloudinary reject the signature. Either drop the `public_id` line (Cloudinary auto-generates one; the folder still scopes it) or extend the function to accept `kind`, include `public_id` in what it signs, and return it. **Drop it** — the filename carries no meaning here, and the smaller signed surface is the safer default.

So: delete the `form.append('public_id', ...)` line.

- [ ] **Step 7: Run it to verify it passes**

Run: `npm run test -- --run tests/config.test.ts && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Document the setup**

Append to `.env.example`:

```
# Cloudinary is configured as Supabase Edge Function secrets, NOT as Vite env
# vars — the API secret must never reach the browser bundle:
#   supabase secrets set CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=...
#   supabase functions deploy sign-upload --use-api
```

- [ ] **Step 9: Verify for real — this is the only end-to-end check that exists**

The handler has no unit test (no Docker). It is verified by using it:

1. `npm run dev`, log in as an admin, go to `/admin/settings`.
2. Upload a logo. It must appear on the settings page.
3. Confirm in the Cloudinary console that the asset landed under `mandals/<your-mandal-id>/`.
4. Open a receipt for that mandal — the logo must render.

If the upload fails, check `supabase functions logs sign-upload`. Report the actual result. **Do not mark this task complete on a green unit suite alone** — the unit tests mock both the function and Cloudinary, so they'd pass even if nothing were deployed.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/sign-upload/index.ts src/lib/db/config.ts tests/config.test.ts .env.example
git commit -m "feat(uploads): move mandal branding uploads to Cloudinary

Uploads are authorised by a sign-upload edge function that derives the target
folder from the caller's JWT — never the request body — so an admin cannot
sign an upload into another mandal's folder, and the API secret never reaches
the browser.

Existing Supabase Storage URLs keep rendering; they're just strings in *_url
columns, so there's no data migration.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The receipt design pass

**Files:**
- Modify: `src/features/receipt/ReceiptPage.tsx`
- Test: `tests/ReceiptPage.test.tsx`

**Interfaces:**
- Consumes: `receipt.logo_url`, `receipt.mandal_name`, `receipt.signature_url`, `receipt.receipt_prefix` (already returned by `get_public_receipt` since Project A); `lang` from Task 4.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

The logo currently exists **only** as a 10%-opacity watermark. Add to `tests/ReceiptPage.test.tsx`:

```tsx
  it('shows the logo as a legible header mark, not only a watermark', async () => {
    getPublicReceipt.mockResolvedValue({ ...receiptRow, logo_url: 'https://x.test/logo.png' })
    render(
      <MemoryRouter initialEntries={['/r/token-1']}>
        <Routes><Route path="/r/:public_token" element={<ReceiptPage />} /></Routes>
      </MemoryRouter>,
    )
    // The watermark is aria-hidden; the header mark is the one a donor reads
    // as "this is my mandal's receipt", so it carries the mandal's name.
    const mark = await screen.findByAltText(receiptRow.mandal_name)
    expect(mark).toHaveAttribute('src', 'https://x.test/logo.png')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test -- --run tests/ReceiptPage.test.tsx`
Expected: FAIL — `Unable to find an element with the alt text: …`. The only `<img>` for the logo today is `alt=""` + `aria-hidden`.

- [ ] **Step 3: Do the design pass**

In `src/features/receipt/ReceiptPage.tsx`, inside the `relative flex flex-col items-center gap-4 text-center` block, replace the bare `<h1>` with a lockup:

```tsx
          <div className="flex flex-col items-center gap-2">
            {receipt.logo_url && (
              <img
                src={receipt.logo_url}
                alt={mandalName}
                className="h-16 w-16 rounded-full border border-amber-800/30 bg-white/60 object-contain p-1"
              />
            )}
            {/* No uppercase, no wide tracking: text-transform does nothing to
                Devanagari or Gujarati (they're unicase) while letter-spacing
                actively breaks their conjuncts and matras. This has to read
                correctly in all four scripts, not just Latin. */}
            <h1 className="text-xl leading-snug font-semibold text-amber-900">{mandalName}</h1>
          </div>
```

Keep the existing watermark block above it untouched — including `PlaceholderWatermark` for mandals with no logo.

Then tighten the hierarchy: the amount is the thing a donor checks first, the receipt number is what makes it official.

```tsx
          <p className="text-5xl font-bold tracking-tight text-amber-950">{formatINR(receipt.amount_paise)}</p>
```

and give the receipt number its own emphasis in the `<dl>`:

```tsx
            <dd className="font-semibold tabular-nums">{receiptNumber}</dd>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run test -- --run tests/ReceiptPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Look at it**

Run: `npm run dev` and open a real receipt at `/r/<token>` — and the same one at `?lang=mr`.
Check: the mandal name is legible in Devanagari (not clipped, not letter-spaced apart); the logo reads as a mark rather than a smudge; the amount dominates; nothing overflows at a 360px viewport (SPEC criterion 8).

A screenshot test is **not** being added — the parchment/stamp design is meant to be iterated on by eye, and a pixel baseline would just break on every intentional change.

- [ ] **Step 6: Verify and commit**

Run: `npm run typecheck && npm run test -- --run && npm run lint`

```bash
git add src/features/receipt/ReceiptPage.tsx tests/ReceiptPage.test.tsx
git commit -m "feat(receipt): logo lockup, and a name that works in four scripts

The logo existed only as a 10%-opacity watermark; it's now a legible header
mark above the mandal name. The name loses its uppercase + wide tracking:
text-transform does nothing to Devanagari or Gujarati while letter-spacing
breaks their conjuncts — it has to read in all four scripts now, not just
Latin.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Update SPEC.md

**Files:**
- Modify: `SPEC.md` (assumption 5, the Auth/Data Model sections, Boundaries, Open Questions 4)

**Interfaces:** none.

- [ ] **Step 1: Correct the language assumption**

`SPEC.md` assumption 5 currently reads:

```
5. **Language:** UI copy in English for v1, but all user-facing strings go through a single strings file so Marathi/Hindi can be added later without refactor.
```

Replace with:

```
5. **Language:** Operator UI (volunteer/admin) is English, in `src/lib/strings.ts`. Donor-facing copy — the receipt page and the SMS/WhatsApp body — is available in English, Marathi, Hindi and Gujarati from `src/lib/i18n/receipt.ts`, selected per-send by the volunteer and carried on the receipt link as `?lang=`. The mandal's `default_lang` preselects it. Unknown/absent `?lang=` falls back to English.
```

- [ ] **Step 2: Update the data model and boundaries**

Add `default_lang text not null default 'en' check (default_lang in ('en','mr','hi','gu'))` to the `mandals` table in the Data Model section.

Add to **Never** in Boundaries:

```
commit or persist Cloudinary credentials; return the API secret from an edge function; translate a mandal name or a donor name; ship unreviewed translations
```

Add to **Always**:

```
derive the upload folder from the caller's JWT in sign-upload, never from the request body
```

- [ ] **Step 3: Close Open Question 4**

It currently reads:

```
4. Confirm English-only for v1 with i18n-ready strings (Marathi later).
```

Replace with:

```
4. ~~English-only for v1~~ — **resolved.** Operator UI is English; donor-facing receipt + message copy ships in English, Marathi, Hindi and Gujarati (Project B). Translating the operator UI is deferred until a mandal asks.
```

- [ ] **Step 4: Note the storage situation**

In the Tech Stack section, `Supabase: … Storage (logo/signature/QR assets)` is now only half true. Replace that clause with:

```
Storage (legacy branding assets; new uploads go to Cloudinary via the sign-upload edge function)
```

- [ ] **Step 5: Commit**

```bash
git add SPEC.md
git commit -m "docs: SPEC.md covers multilingual receipts and Cloudinary uploads

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verification Checklist

```bash
bash supabase/verify-local.sh     # default_lang RPC scoping + every Project A assertion
npm run typecheck
npm run lint
npm run test -- --run             # incl. money.ts/reconcile.ts at 100%
npm run test:e2e
```

Plus the two things no command can prove, which must be done by a human and reported honestly:

- **A real logo upload** through the deployed `sign-upload` function, landing in `mandals/<mandal_id>/` (Task 6 Step 9). The unit tests mock both the function and Cloudinary; they pass whether or not anything is deployed.
- **A native speaker reading the translations** (Task 2 Step 5).

Against the spec's Success Criteria:

| # | Criterion | Proven by |
|---|---|---|
| 1 | Marathi send costs no extra tap | Task 4 Step 8 (picker preset from default) |
| 2 | `?lang=mr` renders Marathi; `?lang=xx` and none render English | Task 1 Step 1 + Task 4 Step 5 |
| 3 | Message language matches the link's | Task 4 Step 1/3 (one `lang` for both) |
| 4 | Admin sets the mandal default | Task 3 Steps 9-10 |
| 5 | Logo uploads; secret absent from the bundle | Task 6 Steps 6, 9 |
| 6 | A volunteer calling `sign-upload` is rejected | Task 6 Step 1 (`role !== 'admin'` → 403); Step 4's refusal test |
| 7 | A forged body mandal id gets the caller's own folder | Task 6 Step 1 (folder from JWT); Step 4 asserts the client sends the function's folder |
| 8 | Every language has every string | Task 2 Step 1 |
| 9 | Logo as header mark; name correct in four scripts | Task 7 Steps 1, 3, 5 |
| 10 | Existing Storage URLs still render | Task 6 Step 6 (`*_url` untouched) |

**Criterion 6 and 7 have a real gap worth naming:** both are enforced entirely inside the Edge Function, which has no automated test. The client-side tests prove the *client* honours the function's answer; they cannot prove the function answers correctly. Verify 6 by attempting an upload from a volunteer session (expect a 403), and 7 by reading `supabase functions logs sign-upload` after an upload and confirming the folder matches the caller's mandal.
