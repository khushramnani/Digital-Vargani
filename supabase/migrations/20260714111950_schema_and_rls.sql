create extension if not exists pgcrypto;

-- ── Tables ──────────────────────────────────────────────────────────────

create table mandal_config (
  id                  boolean primary key default true check (id),
  name                text not null,
  logo_url            text,
  signature_url       text,
  upi_vpa             text,
  upi_qr_url          text,
  receipt_prefix      text not null default 'VM',
  expense_categories  text[] not null default '{Mandap,Murti,Prasad,Decoration,Events,Sound,Misc}',
  bank_opening_paise  bigint not null default 0
);

create table users (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  role          text not null check (role in ('admin','volunteer')),
  invite_token  text unique,
  auth_user_id  uuid unique references auth.users(id),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create sequence receipt_no_seq start 1;

create table donations (
  id            uuid primary key default gen_random_uuid(),
  receipt_no    bigint not null unique default nextval('receipt_no_seq'),
  public_token  text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  donor_name    text not null,
  donor_phone   text,
  amount_paise  bigint not null check (amount_paise > 0),
  mode          text not null check (mode in ('cash','upi','bank')),
  collected_by  uuid not null references users(id),
  created_at    timestamptz not null default now(),
  voided        boolean not null default false,
  void_reason   text,
  voided_by     uuid references users(id),
  voided_at     timestamptz
);

create table expenses (
  id            uuid primary key default gen_random_uuid(),
  category      text not null,
  amount_paise  bigint not null check (amount_paise > 0),
  description   text,
  paid_by       uuid not null references users(id),
  paid_from     text not null check (paid_from in ('cash','bank')),
  created_at    timestamptz not null default now(),
  voided        boolean not null default false,
  void_reason   text,
  voided_by     uuid references users(id),
  voided_at     timestamptz
);

create table handovers (
  id            uuid primary key default gen_random_uuid(),
  volunteer_id  uuid not null references users(id),
  amount_paise  bigint not null check (amount_paise > 0),
  received_by   uuid not null references users(id),
  note          text,
  created_at    timestamptz not null default now(),
  voided        boolean not null default false,
  void_reason   text,
  voided_by     uuid references users(id),
  voided_at     timestamptz
);

create index donations_collected_by_idx on donations(collected_by);
create index expenses_paid_by_idx on expenses(paid_by);
create index handovers_volunteer_id_idx on handovers(volunteer_id);

-- ── Append-only enforcement (financial fields never edited, only voided) ──

create or replace function forbid_financial_edit() returns trigger
language plpgsql as $$
begin
  if TG_TABLE_NAME = 'donations' then
    if new.donor_name <> old.donor_name
       or new.donor_phone is distinct from old.donor_phone
       or new.amount_paise <> old.amount_paise
       or new.mode <> old.mode
       or new.collected_by <> old.collected_by
       or new.receipt_no <> old.receipt_no
       or new.public_token <> old.public_token
       or new.created_at <> old.created_at then
      raise exception 'donations rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'expenses' then
    if new.category <> old.category
       or new.amount_paise <> old.amount_paise
       or new.description is distinct from old.description
       or new.paid_by <> old.paid_by
       or new.paid_from <> old.paid_from
       or new.created_at <> old.created_at then
      raise exception 'expenses rows are append-only; void and re-enter instead of editing';
    end if;
  elsif TG_TABLE_NAME = 'handovers' then
    if new.volunteer_id <> old.volunteer_id
       or new.amount_paise <> old.amount_paise
       or new.received_by <> old.received_by
       or new.note is distinct from old.note
       or new.created_at <> old.created_at then
      raise exception 'handovers rows are append-only; void and re-enter instead of editing';
    end if;
  end if;
  return new;
end;
$$;

create trigger donations_forbid_edit before update on donations
  for each row execute function forbid_financial_edit();
create trigger expenses_forbid_edit before update on expenses
  for each row execute function forbid_financial_edit();
create trigger handovers_forbid_edit before update on handovers
  for each row execute function forbid_financial_edit();

create or replace function enforce_insert_defaults() returns trigger
language plpgsql as $$
begin
  if TG_TABLE_NAME = 'donations' then
    new.receipt_no := nextval('receipt_no_seq');
    new.public_token := encode(extensions.gen_random_bytes(16), 'hex');
  end if;
  new.voided := false;
  new.void_reason := null;
  new.voided_by := null;
  new.voided_at := null;
  return new;
end;
$$;

create trigger donations_enforce_insert before insert on donations
  for each row execute function enforce_insert_defaults();
create trigger expenses_enforce_insert before insert on expenses
  for each row execute function enforce_insert_defaults();
create trigger handovers_enforce_insert before insert on handovers
  for each row execute function enforce_insert_defaults();

-- ── RLS helper functions ───────────────────────────────────────────────

create or replace function app_user_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from users where auth_user_id = auth.uid()
$$;

create or replace function app_user_role() returns text
language sql stable security definer set search_path = public as $$
  select role from users where auth_user_id = auth.uid()
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(app_user_role() = 'admin', false)
$$;

-- ── RLS policies ────────────────────────────────────────────────────────
-- Pattern: admin can select/insert/update every row; a volunteer can
-- select/insert/update only rows tied to their own users.id. No DELETE
-- policy exists anywhere — hard delete of a financial row is impossible
-- through the anon/authenticated Postgres roles this app uses.

alter table mandal_config enable row level security;
alter table users enable row level security;
alter table donations enable row level security;
alter table expenses enable row level security;
alter table handovers enable row level security;

create policy mandal_config_admin_select on mandal_config for select using (is_admin());
create policy mandal_config_admin_insert on mandal_config for insert with check (is_admin());
create policy mandal_config_admin_update on mandal_config for update using (is_admin()) with check (is_admin());

create policy users_admin_select on users for select using (is_admin());
create policy users_admin_insert on users for insert with check (is_admin());
create policy users_admin_update on users for update using (is_admin()) with check (is_admin());
create policy users_self_select on users for select using (auth_user_id = auth.uid());

create policy donations_admin_select on donations for select using (is_admin());
create policy donations_admin_insert on donations for insert with check (is_admin());
create policy donations_admin_update on donations for update using (is_admin()) with check (is_admin());
create policy donations_volunteer_select on donations for select using (collected_by = app_user_id());
create policy donations_volunteer_insert on donations for insert with check (collected_by = app_user_id());
create policy donations_volunteer_update on donations for update using (collected_by = app_user_id()) with check (collected_by = app_user_id());

create policy expenses_admin_select on expenses for select using (is_admin());
create policy expenses_admin_insert on expenses for insert with check (is_admin());
create policy expenses_admin_update on expenses for update using (is_admin()) with check (is_admin());
create policy expenses_volunteer_select on expenses for select using (paid_by = app_user_id());
create policy expenses_volunteer_insert on expenses for insert with check (paid_by = app_user_id());
create policy expenses_volunteer_update on expenses for update using (paid_by = app_user_id()) with check (paid_by = app_user_id());

create policy handovers_admin_select on handovers for select using (is_admin());
create policy handovers_admin_insert on handovers for insert with check (is_admin());
create policy handovers_admin_update on handovers for update using (is_admin()) with check (is_admin());
create policy handovers_volunteer_select on handovers for select using (volunteer_id = app_user_id());
create policy handovers_volunteer_insert on handovers for insert with check (volunteer_id = app_user_id());
create policy handovers_volunteer_update on handovers for update using (volunteer_id = app_user_id()) with check (volunteer_id = app_user_id());

-- ── Public, narrowly-scoped read surfaces ──────────────────────────────
-- mandal_config has exactly one row (enforced by the boolean PK), so a
-- view over safe columns cannot leak across rows/tenants.
create view public_mandal_branding as
  select name, logo_url, signature_url, receipt_prefix from mandal_config;
grant select on public_mandal_branding to anon, authenticated;

-- donations must NEVER be bulk-exposed publicly (that would leak every
-- donor name/amount). A SECURITY DEFINER function that takes the exact
-- unguessable public_token and returns one row is the safe shape — there
-- is no way to enumerate all donations through it.
create or replace function get_public_receipt(token text)
returns table (
  receipt_no    bigint,
  donor_name    text,
  amount_paise  bigint,
  mode          text,
  created_at    timestamptz,
  voided        boolean,
  void_reason   text
)
language sql stable security definer set search_path = public as $$
  select receipt_no, donor_name, amount_paise, mode, created_at, voided, void_reason
  from donations
  where public_token = token
  limit 1
$$;

grant execute on function get_public_receipt(text) to anon, authenticated;
