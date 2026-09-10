export class OrderError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateOrderCode() {
  let code = 'SDL';
  for (let i = 0; i < 8; i++) {
    code += ORDER_CODE_ALPHABET[Math.floor(Math.random() * ORDER_CODE_ALPHABET.length)];
  }
  return code;
}

export async function createOrder(supabase, {
  userId, custName, custEmail, custPhone, paymentMethod, shippingMethod, shippingAddress, items,
}) {
  if (!items || items.length === 0) {
    throw new OrderError('Đơn hàng phải có ít nhất 1 sản phẩm.', 400);
  }

  const productIds = items.map((it) => it.productId);
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, title, price_buy, sim_type, status')
    .in('id', productIds);
  if (productsError) {
    console.error('[orders] products lookup failed', productsError);
    throw new OrderError('Không tải được thông tin sản phẩm.', 500);
  }
  const productById = new Map((products || []).map((p) => [p.id, p]));

  const rpcItems = [];
  let totalAmount = 0;
  let hasPhysical = false;
  for (const item of items) {
    if (!Number.isInteger(item.productId) || item.productId <= 0) {
      throw new OrderError('Sản phẩm không hợp lệ.', 400);
    }
    const product = productById.get(item.productId);
    if (!product || product.status !== 'active') {
      throw new OrderError(`Sản phẩm với id ${item.productId} không tồn tại hoặc đã ngừng bán.`, 400);
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new OrderError('Số lượng sản phẩm phải là số nguyên lớn hơn 0.', 400);
    }
    if (product.sim_type === 'physical') {
      hasPhysical = true;
    }
    const unitPrice = Number(product.price_buy);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      console.error('[orders] invalid product price', { productId: item.productId, price_buy: product.price_buy });
      throw new OrderError(`Sản phẩm với id ${item.productId} có giá không hợp lệ.`, 500);
    }
    totalAmount += unitPrice * item.quantity;
    rpcItems.push({
      productId: product.id,
      productTitle: product.title,
      quantity: item.quantity,
      unitPrice,
      simType: product.sim_type,
    });
  }

  if (hasPhysical) {
    if (shippingMethod !== 'delivery' || !shippingAddress) {
      throw new OrderError('Đơn hàng có SIM vật lý phải chọn giao hàng và nhập địa chỉ.', 400);
    }
  } else if (shippingMethod !== 'email') {
    throw new OrderError('Đơn hàng eSIM phải chọn nhận qua email.', 400);
  }

  let order = null;
  let lastError = null;
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const orderCode = generateOrderCode();
    const { data, error } = await supabase.rpc('create_order', {
      p_order_code: orderCode,
      p_user_id: userId ?? null,
      p_cust_name: custName,
      p_cust_email: custEmail,
      p_cust_phone: custPhone,
      p_total_amount: totalAmount,
      p_payment_method: paymentMethod,
      p_shipping_method: shippingMethod,
      p_shipping_address: shippingAddress ?? null,
      p_shipping_status: shippingMethod === 'delivery' ? 'pending' : 'none',
      p_items: rpcItems,
    });
    if (!error) {
      order = data;
      break;
    }
    lastError = error;
    if (error.code !== '23505') {
      console.error('[orders] create_order RPC failed', error);
      throw new OrderError('Không tạo được đơn hàng.', 500);
    }
  }
  if (!order) {
    console.error('[orders] exhausted order-code retries', lastError);
    throw new OrderError('Không tạo được mã đơn hàng duy nhất, vui lòng thử lại.', 500);
  }

  return order;
}

export async function getOrderByCode(supabase, orderCode) {
  const { data, error } = await supabase.rpc('get_order_by_code', { p_order_code: orderCode });
  if (error) {
    console.error('[orders] get_order_by_code RPC failed', error);
    throw new OrderError('Không tra được đơn hàng.', 500);
  }
  return data ?? null;
}
