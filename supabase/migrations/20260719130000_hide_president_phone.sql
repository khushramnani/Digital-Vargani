-- Audit v3 — Step 1: move the "hide president phone" rule server-side + cap
-- inquiry_contacts in the DB.
--
-- The v2 receipt RPC returned m.creator_phone unconditionally and the client
-- (ReceiptView) decided whether to show it — so the "hidden" number was still
-- in the network response for anyone to read. This nulls it in the RPC itself,
-- and moves the "president shows only when he's the sole contact" rule into SQL
-- where it belongs: creator_phone is withheld exactly when the admin hid it AND
-- there is at least one other inquiry contact to fall back on.

-- ── inquiry_contacts must be a JSON array of at most 2 entries ────────────
-- The settings UI already caps at 2, but the receipt footer trusts the shape;
-- enforce it in the DB so a bad write can't ship a malformed contact list to
-- donors. The CASE guards jsonb_array_length so a non-array value fails the
-- check (returns false) instead of raising a type error mid-constraint.
alter table mandals
  add constraint mandals_inquiry_contacts_shape
  check (
    case
      when jsonb_typeof(inquiry_contacts) = 'array' then jsonb_array_length(inquiry_contacts) <= 2
      else false
    end
  );

-- ── get_public_receipt: withhold the president phone server-side ─────────
-- Same signature as the v2 version — only the creator_phone expression
-- changes. inquiry_contacts is now guaranteed to be an array (constraint
-- above + not-null default '[]'), so jsonb_array_length is always safe here.
create or replace function get_public_receipt(token text)
returns table (
  receipt_no             bigint,
  donor_name             text,
  amount_paise           bigint,
  mode                   text,
  created_at             timestamptz,
  voided                 boolean,
  void_reason            text,
  mandal_name            text,
  logo_url               text,
  signature_url          text,
  receipt_prefix         text,
  city                   text,
  president_name         text,
  creator_phone          text,
  inquiry_contacts       jsonb,
  hide_president_contact boolean
)
language sql stable security definer set search_path = public as $$
  select d.receipt_no, d.donor_name, d.amount_paise, d.mode, d.created_at,
         d.voided, d.void_reason,
         m.name, m.logo_url, m.signature_url, m.receipt_prefix,
         m.city, m.president_name,
         -- The president's number is public UNLESS the admin hid it AND there
         -- is another inquiry contact to reach — then it never leaves the DB.
         case
           when m.hide_president_contact and jsonb_array_length(m.inquiry_contacts) > 0 then null
           else m.creator_phone
         end,
         m.inquiry_contacts, m.hide_president_contact
  from donations d
  join mandals m on m.id = d.mandal_id
  where d.public_token = token
  limit 1
$$;

revoke execute on function get_public_receipt(text) from public;
grant execute on function get_public_receipt(text) to anon, authenticated;
