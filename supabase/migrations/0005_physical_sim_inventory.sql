create table public.physical_sim_inventory (
  id bigserial primary key,
  product_id bigint not null references public.products(id),
  iccid text not null unique,
  status text not null default 'in_stock',
  reserved_order_item_id bigint,
  imported_at timestamptz not null default now()
);

create index idx_physical_sim_inventory_product on public.physical_sim_inventory(product_id);
create index idx_physical_sim_inventory_status on public.physical_sim_inventory(status);

alter table public.physical_sim_inventory enable row level security;

create policy "Admins can manage inventory"
  on public.physical_sim_inventory for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());
