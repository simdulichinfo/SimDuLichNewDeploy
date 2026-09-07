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
-- Revoking column-level UPDATE privilege on role/status for the
-- `authenticated` role blocks that at the grant level regardless of RLS.
revoke update (role, status) on public.profiles from authenticated;
