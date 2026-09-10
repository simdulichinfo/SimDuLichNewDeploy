-- Orders/order_items are INSERT-only for anon/authenticated (migration 0007): there is no
-- SELECT policy for them by design, so an `insert ... returning` from the REST API cannot
-- return the inserted rows. This security definer RPC does the whole order + items write
-- atomically and returns the same camelCase JSON shape as get_order_by_code.
create or replace function public.create_order(
  p_order_code text,
  p_user_id uuid,
  p_cust_name text,
  p_cust_email text,
  p_cust_phone text,
  p_total_amount numeric,
  p_payment_method text,
  p_shipping_method text,
  p_shipping_address text,
  p_shipping_status text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_order_id bigint;
  v_item jsonb;
  result jsonb;
begin
  insert into public.orders (
    order_code, user_id, cust_name, cust_email, cust_phone, total_amount,
    payment_method, payment_status, shipping_method, shipping_address, shipping_status
  ) values (
    p_order_code, p_user_id, p_cust_name, p_cust_email, p_cust_phone, p_total_amount,
    p_payment_method, 'pending', p_shipping_method, p_shipping_address, p_shipping_status
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items (order_id, product_id, product_title, quantity, unit_price, sim_type)
    values (
      v_order_id,
      (v_item->>'productId')::bigint,
      v_item->>'productTitle',
      (v_item->>'quantity')::int,
      (v_item->>'unitPrice')::numeric,
      v_item->>'simType'
    );
  end loop;

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
  where o.id = v_order_id;

  return result;
end;
$$;

grant execute on function public.create_order(text, uuid, text, text, text, numeric, text, text, text, text, jsonb) to anon, authenticated;
