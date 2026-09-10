create table public.orders (
  id bigserial primary key,
  order_code text not null unique,
  user_id uuid references auth.users(id),
  cust_name text not null,
  cust_email text not null,
  cust_phone text not null,
  total_amount numeric(15,2) not null,
  payment_method text not null check (payment_method in ('momo','vnpay','payos','sepay','cod')),
  payment_status text not null default 'pending',
  shipping_method text not null check (shipping_method in ('email','delivery')),
  shipping_address text,
  shipping_status text not null default 'none',
  carrier_name text,
  tracking_code text,
  created_at timestamptz not null default now()
);

create index idx_orders_created_at on public.orders(created_at desc);

create table public.order_items (
  id bigserial primary key,
  order_id bigint not null references public.orders(id) on delete cascade,
  product_id bigint not null references public.products(id),
  product_title text not null,
  quantity int not null check (quantity > 0),
  unit_price numeric(15,2) not null,
  sim_type text not null check (sim_type in ('esim','physical'))
);

create index idx_order_items_order on public.order_items(order_id);

create table public.payment_transactions (
  id bigserial primary key,
  order_id bigint not null references public.orders(id),
  transaction_ref text not null unique,
  amount numeric(15,2) not null,
  raw_response text,
  created_at timestamptz not null default now()
);

create index idx_payment_transactions_order on public.payment_transactions(order_id);

create table public.api_logs (
  id bigserial primary key,
  order_id bigint references public.orders(id),
  api_type text not null,
  endpoint text,
  request_body text,
  response_body text,
  http_status int,
  created_at timestamptz not null default now()
);

create index idx_api_logs_order on public.api_logs(order_id);

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.api_logs enable row level security;

create policy "Anyone can create orders"
  on public.orders for insert
  to anon, authenticated
  with check (true);

create policy "Admins can manage orders"
  on public.orders for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Anyone can create order items"
  on public.order_items for insert
  to anon, authenticated
  with check (true);

create policy "Admins can manage order items"
  on public.order_items for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage payment transactions"
  on public.payment_transactions for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Admins can manage api logs"
  on public.api_logs for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create or replace function public.get_order_by_code(p_order_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', o.id, 'orderCode', o.order_code, 'userId', o.user_id,
    'custName', o.cust_name, 'custEmail', o.cust_email, 'custPhone', o.cust_phone,
    'totalAmount', o.total_amount, 'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'shippingMethod', o.shipping_method, 'shippingAddress', o.shipping_address, 'shippingStatus', o.shipping_status,
    'carrierName', o.carrier_name, 'trackingCode', o.tracking_code, 'createdAt', o.created_at,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', oi.id, 'productId', oi.product_id, 'productName', oi.product_title,
        'quantity', oi.quantity, 'unitPrice', oi.unit_price, 'simType', oi.sim_type
      )) from public.order_items oi where oi.order_id = o.id), '[]'::jsonb)
  ) into result
  from public.orders o
  where o.order_code = p_order_code;
  return result;
end;
$$;

grant execute on function public.get_order_by_code(text) to anon, authenticated;
