export function mapOrderSummary(row) {
  return {
    id: row.id,
    orderCode: row.order_code,
    userId: row.user_id,
    custName: row.cust_name,
    custEmail: row.cust_email,
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    shippingMethod: row.shipping_method,
    shippingStatus: row.shipping_status,
    carrierName: row.carrier_name,
    trackingCode: row.tracking_code,
    createdAt: row.created_at,
  };
}

function mapOrderItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_title,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    simType: row.sim_type,
  };
}

function mapOrderDetail(row, items) {
  return {
    ...mapOrderSummary(row),
    custPhone: row.cust_phone,
    shippingAddress: row.shipping_address,
    items: (items || []).map(mapOrderItem),
  };
}

export async function listOrdersAdmin(supabase, { page, size } = {}) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
  const safeSize = Number.isFinite(size) && size > 0 ? Math.trunc(size) : 20;
  const from = safePage * safeSize;
  const to = from + safeSize - 1;

  const { data, count, error } = await supabase
    .from('orders')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) return { data: null, error };

  const totalElements = count || 0;
  return {
    data: {
      content: (data || []).map(mapOrderSummary),
      number: safePage,
      size: safeSize,
      totalElements,
      totalPages: Math.ceil(totalElements / safeSize),
    },
    error: null,
  };
}

export async function getOrderAdminById(supabase, id) {
  const { data: order, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  if (error) return { data: null, error };
  if (!order) return { data: null, error: null };

  const { data: items, error: itemsError } = await supabase.from('order_items').select('*').eq('order_id', id);
  if (itemsError) return { data: null, error: itemsError };

  return { data: mapOrderDetail(order, items), error: null };
}
