-- Backfill mandals.president_name for mandals that predate v4.
--
-- v4 added the column and made create_mandal seed it from the founder's name,
-- but only for NEWLY created mandals — every existing mandal still has NULL.
-- That single gap is why an existing mandal's receipt shows:
--   * the signature block with only the italic "President" label and no name
--     (ReceiptPage renders the name conditionally, above the label), and
--   * the inquiry block falling back to the generic "For inquiries" heading
--     instead of naming the person whose number is printed.
-- Both surfaces are correct code reading empty data.
--
-- Seed it from the mandal's earliest ACTIVE admin — a real person, which is the
-- whole reason v4 refused to fall back to the mandal name here. It stays an
-- ordinary editable Settings field afterwards, so an admin whose president is
-- someone else just types over it (and the live receipt preview shows the
-- result immediately).
update mandals m
   set president_name = a.name
  from (
    select distinct on (u.mandal_id) u.mandal_id, u.name
      from users u
     where u.role = 'admin'
       and u.active
       and nullif(btrim(u.name), '') is not null
     order by u.mandal_id, u.created_at
  ) a
 where a.mandal_id = m.id
   and nullif(btrim(m.president_name), '') is null;
