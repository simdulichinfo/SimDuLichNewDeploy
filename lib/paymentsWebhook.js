const ORDER_CODE_RE = /SDL[A-Z0-9]{8}/i;

async function logUnmatched(serviceClient, payload, orderId, message) {
  await serviceClient.from('api_logs').insert({
    order_id: orderId,
    api_type: 'SEPAY_WEBHOOK_UNMATCHED',
    endpoint: '/api/payments/payments/webhook/sepay/callback',
    request_body: JSON.stringify(payload),
    response_body: message,
    http_status: 200,
  });
}

export async function processSepayWebhook(serviceClient, payload) {
  const { transferType, content, transferAmount, id } = payload;

  if (transferType !== 'in') {
    return { matched: false, reason: 'not_incoming' };
  }

  const match = ORDER_CODE_RE.exec(content || '');
  if (!match) {
    await logUnmatched(serviceClient, payload, null, 'Không tìm thấy mã đơn trong nội dung chuyển khoản.');
    return { matched: false, reason: 'no_order_code' };
  }
  const orderCode = match[0].toUpperCase();

  const { data: order } = await serviceClient
    .from('orders')
    .select('id, total_amount, payment_status')
    .eq('order_code', orderCode)
    .maybeSingle();
  if (!order) {
    await logUnmatched(serviceClient, payload, null, `Không tìm thấy đơn hàng với mã ${orderCode}.`);
    return { matched: false, reason: 'order_not_found' };
  }

  if (Number(order.total_amount) !== Number(transferAmount)) {
    await logUnmatched(serviceClient, payload, order.id, `Số tiền không khớp: đơn ${order.total_amount}, chuyển khoản ${transferAmount}.`);
    return { matched: false, reason: 'amount_mismatch' };
  }

  const transactionRef = `SEPAY-${id}`;
  const { error: insertError } = await serviceClient
    .from('payment_transactions')
    .insert({ order_id: order.id, transaction_ref: transactionRef, amount: transferAmount, raw_response: JSON.stringify(payload) });

  if (insertError && insertError.code === '23505') {
    return { matched: true, duplicate: true };
  }
  if (insertError) {
    console.error('[sepayWebhook] failed to record transaction', insertError);
    return { matched: false, reason: 'transaction_insert_failed' };
  }

  if (order.payment_status !== 'paid') {
    const { error: updateError } = await serviceClient
      .from('orders')
      .update({ payment_status: 'paid' })
      .eq('id', order.id)
      .eq('payment_status', 'pending');
    if (updateError) {
      console.error('[sepayWebhook] failed to update order status', updateError);
    }
  }

  return { matched: true };
}

export async function simulatePaymentWebhook(serviceClient, { orderId, amount, transactionRef }) {
  const { data: order } = await serviceClient
    .from('orders')
    .select('id, payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) {
    return { matched: false, reason: 'order_not_found' };
  }

  const { error: insertError } = await serviceClient
    .from('payment_transactions')
    .insert({ order_id: order.id, transaction_ref: transactionRef, amount, raw_response: JSON.stringify({ simulated: true }) });

  if (insertError && insertError.code === '23505') {
    return { matched: true, duplicate: true };
  }
  if (insertError) {
    return { matched: false, reason: 'transaction_insert_failed' };
  }

  if (order.payment_status !== 'paid') {
    await serviceClient.from('orders').update({ payment_status: 'paid' }).eq('id', order.id).eq('payment_status', 'pending');
  }

  return { matched: true };
}
