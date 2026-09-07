alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'phone',
    new.email
  );
  return new;
end;
$$;

-- security definer helper so the "Admins can view all profiles" policy does
-- not query public.profiles from within its own USING clause. A subquery
-- against profiles inside a profiles policy would have Postgres re-apply
-- profiles' own row-level security policies to that subquery, which in turn
-- evaluates the same policy again — infinite recursion (error 42P17) on
-- every read of public.profiles. Marking this function `security definer`
-- makes it run with the privileges of its owner (bypassing RLS) instead of
-- the calling user, breaking the recursion.
create or replace function public.is_admin_or_staff()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'staff'));
$$;

drop policy if exists "Admins can view all profiles" on public.profiles;

create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin_or_staff());

-- Without this, "Users can update own profile" (migration 0001) has no
-- `with check`, so a user can update any column on their own row via
-- PostgREST/Supabase, including role/status — self-granting admin and
-- defeating every requireRole(user, ['admin','staff']) check in the API.
--
-- IMPORTANT: `revoke update (role, status) on public.profiles from
-- authenticated;` (the column-level form) is a NO-OP here and must never be
-- used in isolation. Per Postgres's own REVOKE documentation: "if a role
-- has been granted privileges on a table, then revoking the same
-- privileges from individual columns will have no effect." Supabase's
-- bootstrap grants `authenticated` table-level UPDATE on all tables in
-- `public` (via `alter default privileges ... grant all on tables ... to
-- authenticated` plus the initial `grant all`), so a column-level revoke
-- cannot subtract from that table-level grant — the user could still PATCH
-- `role`/`status` on their own row. The correct fix is to revoke the
-- table-level UPDATE grant entirely and re-grant only the safe columns.
--
-- As a durable backstop against some future migration re-broadening the
-- table-level grant (or a client bypassing PostgREST's column grants via a
-- different path), a BEFORE UPDATE trigger also freezes `role`/`status`
-- back to their previous values for any request that isn't from an
-- admin/staff user. This is belt-and-suspenders: the grant/revoke pair is
-- the primary defense, the trigger is what still holds if that primary
-- defense is ever accidentally undone.
revoke update on public.profiles from authenticated, anon;
grant update (name, phone, email) on public.profiles to authenticated;

create or replace function public.profiles_freeze_privileged_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_admin_or_staff() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_freeze_privileged_columns on public.profiles;
create trigger profiles_freeze_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_freeze_privileged_columns();
