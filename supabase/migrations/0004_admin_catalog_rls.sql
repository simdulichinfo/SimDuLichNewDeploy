create policy "Admins can manage categories"
  on public.categories for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage products"
  on public.products for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage category_countries"
  on public.category_countries for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());
