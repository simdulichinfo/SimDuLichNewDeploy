-- Staff (role='staff') vẫn giữ full quyền trên orders/order_items/blog_*, nhưng bị giới hạn ở các
-- bảng nhạy cảm hơn: xem toàn bộ / khoá tài khoản người dùng khác, xem giao dịch thanh toán +
-- api_logs — chỉ còn admin làm được. Trên catalog/kho, staff vẫn SELECT được để tra cứu khi hỗ
-- trợ khách, nhưng insert/update/delete chỉ còn admin.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ── Chặn hoàn toàn: Người dùng, Thanh toán, API logs ────────────────────────

drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin());

drop policy if exists "Admins can update any profile status" on public.profiles;
create policy "Admins can update any profile status"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage payment transactions" on public.payment_transactions;
create policy "Admins can manage payment transactions"
  on public.payment_transactions for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage api logs" on public.api_logs;
create policy "Admins can manage api logs"
  on public.api_logs for all
  using (public.is_admin())
  with check (public.is_admin());

-- profiles_freeze_privileged_columns (migration 0003) exempt bất kỳ ai is_admin_or_staff() khỏi
-- việc bị đóng băng cột role/status khi tự sửa hồ sơ của chính mình. Một khi staff mất quyền admin
-- ở policy "Admins can update any profile status" (trên), nếu không sửa luôn hàm trigger này thì
-- staff vẫn có thể tự PATCH hồ sơ của chính mình (được phép qua policy "Users can update own
-- profile" có sẵn, không đổi) và lén đổi role/status — vì trigger không còn đóng băng 2 cột đó cho
-- họ nữa. Bắt buộc đổi is_admin_or_staff() -> is_admin() ở đây để không mở ra lỗ hổng tự nâng
-- quyền mới khi triển khai tính năng này.
create or replace function public.profiles_freeze_privileged_columns()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Exemption for direct/service-role/dashboard connections (auth.uid() is
  -- null there): needed to bootstrap the very first admin, since no
  -- PostgREST-originated update (anon/authenticated key) can ever reach this
  -- trigger with a null auth.uid() — the 0001 UPDATE policy's
  -- `using (auth.uid() = id)` can never match when auth.uid() is null. Do
  -- not remove this or the first admin can never be promoted.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

-- ── Cho xem, chặn sửa: Gói cước, Danh mục quốc gia, Kho SIM vật lý ──────────

drop policy if exists "Admins can manage categories" on public.categories;
drop policy if exists "Staff can view categories" on public.categories;
create policy "Staff can view categories" on public.categories
  for select using (public.is_admin_or_staff());
drop policy if exists "Admins can modify categories" on public.categories;
create policy "Admins can modify categories" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage products" on public.products;
drop policy if exists "Staff can view products" on public.products;
create policy "Staff can view products" on public.products
  for select using (public.is_admin_or_staff());
drop policy if exists "Admins can modify products" on public.products;
create policy "Admins can modify products" on public.products
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage category_countries" on public.category_countries;
drop policy if exists "Staff can view category_countries" on public.category_countries;
create policy "Staff can view category_countries" on public.category_countries
  for select using (public.is_admin_or_staff());
drop policy if exists "Admins can modify category_countries" on public.category_countries;
create policy "Admins can modify category_countries" on public.category_countries
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can manage inventory" on public.physical_sim_inventory;
drop policy if exists "Staff can view inventory" on public.physical_sim_inventory;
create policy "Staff can view inventory" on public.physical_sim_inventory
  for select using (public.is_admin_or_staff());
drop policy if exists "Admins can modify inventory" on public.physical_sim_inventory;
create policy "Admins can modify inventory" on public.physical_sim_inventory
  for all using (public.is_admin()) with check (public.is_admin());
