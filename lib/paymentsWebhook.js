const ORDER_CODE_RE = /SDL[A-Z0-9]{8}/i;

async function logUnmatched(serviceClient, payload, orderId, message, apiType = 'SEPAY_WEBHOOK_UNMATCHED') {
  await serviceClient.from('api_logs').insert({
    order_id: orderId,
    api_type: apiType,
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

  const { data: order, error: orderLookupError } = await serviceClient
    .from('orders')
    .select('id, total_amount, payment_status')
    .eq('order_code', orderCode)
    .maybeSingle();
  if (orderLookupError) {
    console.error('[sepayWebhook] order lookup failed', orderLookupError);
    await logUnmatched(
      serviceClient, payload, null,
      `Lỗi truy vấn đơn hàng với mã ${orderCode}: ${orderLookupError.message}`,
      'SEPAY_WEBHOOK_ORDER_LOOKUP_ERROR',
    );
    return { matched: false, reason: 'order_lookup_failed' };
  }
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

  // A duplicate transaction row means this webhook was resent. Do not return early:
  // the state transition it was trying to make may never have landed (e.g. a prior
  // delivery inserted the row but its own update failed), so fall through to the
  // update below, which no-ops when the order is already paid.
  let duplicate = false;
  if (insertError && insertError.code === '23505') {
    duplicate = true;
  } else if (insertError) {
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

  return duplicate ? { matched: true, duplicate: true } : { matched: true };
}

export async function simulatePaymentWebhook(serviceClient, { orderId, amount, transactionRef }) {
  const { data: order, error: orderLookupError } = await serviceClient
    .from('orders')
    .select('id, payment_status')
    .eq('id', orderId)
    .maybeSingle();
  if (orderLookupError) {
    console.error('[sepayWebhook] simulate: order lookup failed', orderLookupError);
    return { matched: false, reason: 'order_lookup_failed' };
  }
  if (!order) {
    return { matched: false, reason: 'order_not_found' };
  }

  const { error: insertError } = await serviceClient
    .from('payment_transactions')
    .insert({ order_id: order.id, transaction_ref: transactionRef, amount, raw_response: JSON.stringify({ simulated: true }) });

  // Same reasoning as processSepayWebhook: a duplicate transaction_ref must still be
  // allowed to complete the payment_status transition it was trying to make.
  let duplicate = false;
  if (insertError && insertError.code === '23505') {
    duplicate = true;
  } else if (insertError) {
    return { matched: false, reason: 'transaction_insert_failed' };
  }

  if (order.payment_status !== 'paid') {
    await serviceClient.from('orders').update({ payment_status: 'paid' }).eq('id', order.id).eq('payment_status', 'pending');
  }

  return duplicate ? { matched: true, duplicate: true } : { matched: true };
}
