import { mapOrderSummary } from './adminOrders';

function mapPayment(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    transactionRef: row.transaction_ref,
    amount: Number(row.amount),
    rawResponse: row.raw_response,
    createdAt: row.created_at,
  };
}

function mapApiLog(row) {
  return {
    id: row.id,
    orderId: row.order_id,
    apiType: row.api_type,
    endpoint: row.endpoint,
    requestBody: row.request_body,
    responseBody: row.response_body,
    httpStatus: row.http_status,
    createdAt: row.created_at,
  };
}

function paginationBounds(page, size) {
  const safePage = Number.isFinite(page) && page >= 0 ? Math.trunc(page) : 0;
  const safeSize = Number.isFinite(size) && size > 0 ? Math.trunc(size) : 20;
  const from = safePage * safeSize;
  const to = from + safeSize - 1;
  return { safePage, safeSize, from, to };
}

export async function listPaymentsAdmin(supabase, { page, size, orderId } = {}) {
  const { safePage, safeSize, from, to } = paginationBounds(page, size);
  let query = supabase.from('payment_transactions').select('*', { count: 'exact' });
  if (orderId != null) {
    query = query.eq('order_id', orderId);
  }
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) return { data: null, error };
  const totalElements = count || 0;
  return {
    data: { content: (data || []).map(mapPayment), number: safePage, size: safeSize, totalElements, totalPages: Math.ceil(totalElements / safeSize) },
    error: null,
  };
}

export async function listApiLogsAdmin(supabase, { page, size, orderId } = {}) {
  const { safePage, safeSize, from, to } = paginationBounds(page, size);
  let query = supabase.from('api_logs').select('*', { count: 'exact' });
  if (orderId != null) {
    query = query.eq('order_id', orderId);
  }
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = await query;
  if (error) return { data: null, error };
  const totalElements = count || 0;
  return {
    data: { content: (data || []).map(mapApiLog), number: safePage, size: safeSize, totalElements, totalPages: Math.ceil(totalElements / safeSize) },
    error: null,
  };
}

export async function confirmPaymentAdmin(supabase, orderCode) {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('order_code', orderCode)
    .maybeSingle();
  if (error) return { data: null, error };
  if (!order) return { data: null, error: null };

  if (order.payment_status !== 'paid') {
    const { error: updateError } = await supabase
      .from('orders')
      .update({ payment_status: 'paid' })
      .eq('id', order.id);
    if (updateError) return { data: null, error: updateError };

    const { error: insertError } = await supabase.from('payment_transactions').insert({
      order_id: order.id,
      transaction_ref: `MANUAL-${Date.now()}`,
      amount: order.total_amount,
      raw_response: 'Xác nhận thủ công bởi admin.',
    });
    if (insertError) return { data: null, error: insertError };
    order.payment_status = 'paid';
  }

  return { data: mapOrderSummary(order), error: null };
}
