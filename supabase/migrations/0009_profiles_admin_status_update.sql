-- migration 0003 revoked table-level UPDATE on profiles and re-granted only
-- (name, phone, email) to `authenticated` — status has no UPDATE grant at
-- all yet. Add it. The profiles_freeze_privileged_columns trigger (0003)
-- already freezes this column back to its old value for any non-admin
-- caller, so granting the column is safe: a non-admin attempting to set
-- their own status still gets silently reverted by that trigger.
grant update (status) on public.profiles to authenticated;

-- migration 0001/0003 only ever gave a row-level UPDATE policy for a user's
-- OWN row (`auth.uid() = id`). There is no policy letting an admin update
-- someone else's row. Add one, mirroring every other "Admins can manage X"
-- policy already in this project (e.g. 0007's "Admins can manage orders").
create policy "Admins can update any profile status"
  on public.profiles for update
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

-- Lock the column to the two values this feature ever writes. Safe today:
-- every row currently has status = 'active'.
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'banned'));
