# Spec: Multi-Language Receipts, Cloudinary Uploads & Receipt Design (Project B)

> The donor-facing half of the work: a receipt a donor can read in their own language, a
> logo that looks like it belongs to the mandal, and uploads that go to Cloudinary.
>
> Depends on Project A (`2026-07-17-multi-tenancy-design.md`), which is complete: `mandals`
> exists with per-mandal branding, and `get_public_receipt(token)` already returns the
> receipt's own mandal name/logo/signature/prefix.

## Objective

Make the receipt feel like it came from *this* mandal, in the donor's own language.

**Success looks like:** a volunteer in Pune logs a donation, the donor gets an SMS in Marathi,
opens it, and sees their mandal's actual logo above a receipt they can read — and the
volunteer spent zero extra taps to make that happen.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Translation scope | Donor-facing strings only (receipt page + message body) | The admin/volunteer UI stays English per SPEC assumption 5. Translating it is ~10× the surface, nobody asked, and every string needs native review. |
| Languages | English, Marathi, Hindi, Gujarati | |
| Language transport | `?lang=mr` on the receipt link | No column, no migration. |
| Language default | `mandals.default_lang` | So a Marathi mandal doesn't pick Marathi 200 times. |
| Picker placement | Segmented control on the collection form **and** Pending Send | Zero taps to accept the default, one to change — protects SPEC criterion 1 (≤3 taps to the composer). |
| Per-donation language | **Not** stored | A migration plus an append-only decision, and it only buys "a re-send remembers the choice". A re-send in a different language harms nothing. |
| Fonts | System fonts, via `lang` attribute | Android/iOS ship Devanagari and Gujarati faces. A webfont is weight and a dependency for nothing. |
| Uploads | Cloudinary, signed by an Edge Function | User's call. The API secret never reaches the browser. |
| Existing Storage assets | Left alone | The `*_url` columns are just strings; old URLs keep rendering. No data migration. |
| Receipt template editor | Out of scope | User called it future work. |

## Language

### `src/lib/i18n/receipt.ts` (new)

Holds the donor-facing strings for all four languages, and nothing else.

```ts
export const LANGS = ['en', 'mr', 'hi', 'gu'] as const
export type Lang = (typeof LANGS)[number]

// Exactly the ten keys currently under strings.receipt (verified against
// src/lib/strings.ts), plus the message body currently at
// strings.collection.smsMessage.
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
  smsMessage: (amountRupees: number, receiptLink: string) => string
}

export const receiptStrings: Record<Lang, ReceiptStrings> = { en: {…}, mr: {…}, hi: {…}, gu: {…} }

// Unknown/absent/hostile values fall back to English rather than throwing:
// this reads a URL a donor could have mangled.
export function toLang(value: string | null | undefined): Lang
```

`strings.receipt` and `strings.collection.smsMessage` **move here** and are deleted from
`strings.ts`. They are the only donor-facing copy in the app; everything else in `strings.ts`
stays put. `strings.ts` keeps its role as the single home for UI copy — this is a
donor-facing sibling, not a competing convention.

**The `en` entries must be the existing strings, copied verbatim.** Changing English copy
while adding translations makes a review of the translations impossible to separate from a
review of the rewrite.

### Translation review is a required step, not a nicety

The Marathi/Hindi/Gujarati strings are written by an AI that cannot verify them. They ship
only after a native speaker reads them. A receipt exists to look official; stilted Marathi on
a donation receipt actively undermines the trust the whole product is selling. The
implementation plan must surface the translated strings for review as an explicit step, not
bury them in a diff.

Amounts stay in Latin digits via the existing `formatINR` (`en-IN`). Marathi and Gujarati
readers read Latin digits for money routinely; Devanagari digits on a receipt would be a
change nobody asked for, and `formatINR` is money code — out of bounds for this project.

### Receipt page

`ReceiptPage` reads `?lang=` via `useSearchParams`, resolves it through `toLang()`, and sets
`lang={lang}` on the receipt container so the browser selects an appropriate face. The mandal
name and donor name are user data and are never translated.

### Send flow

`src/features/collection/send.ts`:

```ts
export function receiptUrl(publicToken: string, lang: Lang): string      // ?lang= appended
export function sendReceiptSms(donation: Donation, lang: Lang): void
export function sendReceiptWhatsApp(donation: Donation, lang: Lang): void
```

`lang` is required, not optional-with-default: a defaulted parameter is how a caller silently
sends English forever.

**Both call sites hold their own `lang` state, initialised from `get_mandal_default_lang()`
on mount.** `CollectionForm` auto-sends on submit (it calls `sendReceiptSms(synced)` directly
once the queued item syncs), so it reads its picker's current value at that moment.

**The offline path deliberately loses the choice, and that is fine.** An offline donation goes
into the Dexie outbox and is sent later from the Pending Send tray, which has its own picker
(also defaulted from the mandal). Since the language isn't stored on the donation, a
collection-time choice cannot survive that round-trip. The consequence is that an offline
donation is sent in the mandal's default language unless the volunteer re-picks in the tray —
which is the correct trade for not adding a column and an outbox field. Do **not** "fix" this
by threading `lang` through the Dexie outbox record; that is the stored-per-donation design
we rejected, arriving through the back door.

### `mandals.default_lang`

```sql
alter table mandals add column default_lang text not null default 'en'
  check (default_lang in ('en','mr','hi','gu'));
```

Volunteers have no read access to `mandals` (admin-only RLS), so reading it needs one small
SECURITY DEFINER RPC — the same shape as the existing `get_expense_categories()`:

```sql
create or replace function get_mandal_default_lang() returns text
language sql stable security definer set search_path = public as $$
  select default_lang from mandals where id = app_mandal_id()
$$;
revoke execute on function get_mandal_default_lang() from public;
grant execute on function get_mandal_default_lang() to authenticated;
```

The mandal settings screen gets a language selector writing `default_lang`.

## Cloudinary

### `supabase/functions/sign-upload/`

Two files, split on testability:

**`signature.ts`** — pure, no I/O, imported by both the handler and Vitest:

```ts
export async function signParams(params: Record<string, string>, apiSecret: string): Promise<string>
```

Cloudinary's algorithm: sort the params by key, join as `k=v` with `&`, append the API
secret, SHA-1, hex-encode. Uses Web Crypto (`crypto.subtle.digest('SHA-1', …)`), which exists
in both Deno and Node 18+ — one implementation, testable by the existing Vitest setup with no
Deno toolchain.

**`index.ts`** — the handler:

1. Read the caller's JWT from the `Authorization` header.
2. Resolve it to a `users` row. Reject if absent, inactive, or `role <> 'admin'`.
3. Take `mandal_id` **from that row**. Never from the request body — a body-supplied mandal id
   is the same forgery hole the insert trigger closes server-side in Project A.
4. Sign `{ folder: 'mandals/<mandal_id>', timestamp }`.
5. Return `{ signature, timestamp, api_key, cloud_name, folder }`. The **secret is never
   returned** and never reaches the browser.

Secrets (`supabase secrets set`, never committed, never in a memory file):
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

Deploy: `supabase functions deploy sign-upload --use-api` — verified available on the pinned
CLI (2.109.1) and explicitly documented as "Bundle functions server-side without using
Docker", which matters because this machine has none.

### Client

`uploadMandalAsset(mandalId, kind, file)` in `src/lib/db/config.ts` keeps its signature and
its contract (upload a file, return a URL to store in a `*_url` column). Only its body
changes: `supabase.functions.invoke('sign-upload')` → POST FormData to
`https://api.cloudinary.com/v1_1/<cloud_name>/image/upload` → return `secure_url`.

The `mandalId` parameter stays for call-site clarity but is **not** trusted — the function
derives the folder from the JWT. If they disagree, the function's value wins.

The Supabase Storage bucket and its policies stay. Old logo URLs keep rendering, and removing
the bucket is a separate decision with no upside today.

## Receipt design

`ReceiptPage.tsx` only, Tailwind only, no new dependencies:

- Logo becomes a **header lockup** — a real, legible mark above the mandal name — instead of
  existing solely as a 10%-opacity watermark. The watermark stays behind, and
  `PlaceholderWatermark` still covers mandals with no logo uploaded.
- Mandal name set properly: it currently renders as small uppercase tracking-wide, which is
  hostile to Devanagari (`उपरी` in uppercase is meaningless — `text-transform: uppercase`
  does nothing to Devanagari but the tracking still mangles it). Name styling must work in
  all four scripts.
- Tighter hierarchy on amount / receipt no. / date; a proper signature block.
- Keep the parchment/stamp world. This is a polish pass, not a redesign.

## Testing

**Unit:**
- `toLang()` — each valid code; unknown, empty, `null`, and a hostile value all fall back to `en`.
- `receiptUrl()` — appends `?lang=`, for every language.
- `signParams()` — against a test vector taken from **Cloudinary's current documentation**.
  Do not trust a hash quoted from memory (including any in this spec); open the docs and copy
  the vector. A signature test that asserts the wrong expected value is worse than none: it
  passes, and every upload fails in production.
- `receiptStrings` — every language has every key (a shape test catches a missed translation).

**Component:**
- `ReceiptPage` renders Marathi strings for `?lang=mr` and English for `?lang=xx`.
- Collection form: the picker defaults to the mandal's `default_lang`; changing it changes the
  language of the link that gets sent.

**Not automatically testable, and must be stated as such rather than faked:**
- The Edge Function handler. `supabase functions serve` needs Docker; this machine has none.
  Its auth logic is deliberately thin so that what can't be tested is small, and the part that
  can (`signParams`) is extracted. Verified by a real logo upload against the deployed
  function.
- Whether the translations read naturally. Only a native speaker settles that.

## Boundaries

- **Always:** derive `mandal_id` from the JWT in the Edge Function, never from the body; keep
  the API secret server-side; fall back to `en` rather than throwing on a bad `lang`.
- **Ask first:** changing English copy; touching `formatINR`/money code; adding a webfont.
- **Never:** commit or persist Cloudinary credentials (including into memory files); return
  the API secret from the function; translate the mandal name or donor name; ship
  unreviewed translations.

## Out of scope

- **Whole-UI translation** — add when a mandal asks for a Marathi admin screen.
- **Receipt template editor** — future work per the user.
- **Per-donation stored language** — add if re-send-remembers-the-choice ever matters.
- **Migrating existing Storage assets to Cloudinary** — old URLs work; re-upload if wanted.
- **Removing the Supabase Storage bucket** — separate decision, no upside today.
- **Devanagari numerals for amounts** — money code is out of bounds.

## Success Criteria

1. A volunteer sends a receipt in Marathi without adding a tap to the ≤3-tap flow (the picker
   is preset to the mandal's default).
2. `/r/<token>?lang=mr` renders the receipt in Marathi; `?lang=xx` and no param both render
   English; nothing throws.
3. The SMS/WhatsApp body matches the language of the link it contains.
4. An admin sets the mandal's default language and new sends preselect it.
5. A logo uploads to Cloudinary and renders on the public receipt; the API secret appears
   nowhere in the client bundle or the repo.
6. A non-admin (volunteer) session calling `sign-upload` is rejected.
7. A caller passing another mandal's id in the request body gets a signature scoped to **their
   own** mandal's folder.
8. Every language has every receipt string (shape test).
9. The receipt shows the mandal's logo as a legible header mark, and the mandal name renders
   correctly in all four scripts.
10. Existing Supabase Storage logo URLs still render.
