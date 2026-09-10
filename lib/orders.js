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
    id: row.id,
    orderCode: row.order_code,
    userId: row.user_id,
    custName: row.cust_name,
    custEmail: row.cust_email,
    custPhone: row.cust_phone,
    totalAmount: Number(row.total_amount),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    shippingMethod: row.shipping_method,
    shippingAddress: row.shipping_address,
    shippingStatus: row.shipping_status,
    carrierName: row.carrier_name,
    trackingCode: row.tracking_code,
    createdAt: row.created_at,
    items: (items || []).map(mapOrderItem),
  };
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

  const orderItemsToInsert = [];
  let totalAmount = 0;
  let hasPhysical = false;
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product || product.status !== 'active') {
      throw new OrderError(`Sản phẩm với id ${item.productId} không tồn tại hoặc đã ngừng bán.`, 400);
    }
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new OrderError('Số lượng sản phẩm phải lớn hơn 0.', 400);
    }
    if (product.sim_type === 'physical') {
      hasPhysical = true;
    }
    const unitPrice = Number(product.price_buy);
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new OrderError(`Sản phẩm với id ${item.productId} có giá không hợp lệ.`, 500);
    }
    totalAmount += unitPrice * item.quantity;
    orderItemsToInsert.push({
      product_id: product.id,
      product_title: product.title,
      quantity: item.quantity,
      unit_price: unitPrice,
      sim_type: product.sim_type,
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
  for (let attempt = 0; attempt < 5 && !order; attempt++) {
    const orderCode = generateOrderCode();
    const { data, error } = await supabase
      .from('orders')
      .insert({
        order_code: orderCode,
        user_id: userId ?? null,
        cust_name: custName,
        cust_email: custEmail,
        cust_phone: custPhone,
        total_amount: totalAmount,
        payment_method: paymentMethod,
        payment_status: 'pending',
        shipping_method: shippingMethod,
        shipping_address: shippingAddress ?? null,
        shipping_status: shippingMethod === 'delivery' ? 'pending' : 'none',
      })
      .select('*')
      .maybeSingle();
    if (!error) {
      order = data;
      break;
    }
    if (error.code !== '23505') {
      console.error('[orders] order insert failed', error);
      throw new OrderError('Không tạo được đơn hàng.', 500);
    }
  }
  if (!order) {
    throw new OrderError('Không tạo được mã đơn hàng duy nhất, vui lòng thử lại.', 500);
  }

  const { data: insertedItems, error: itemsError } = await supabase
    .from('order_items')
    .insert(orderItemsToInsert.map((it) => ({ ...it, order_id: order.id })))
    .select('*');
  if (itemsError) {
    console.error('[orders] order_items insert failed', itemsError);
    await supabase.from('orders').delete().eq('id', order.id);
    throw new OrderError('Không tạo được chi tiết đơn hàng.', 500);
  }

  return mapOrderDetail(order, insertedItems);
}

export async function getOrderByCode(supabase, orderCode) {
  const { data, error } = await supabase.rpc('get_order_by_code', { p_order_code: orderCode });
  if (error) {
    console.error('[orders] get_order_by_code RPC failed', error);
    throw new OrderError('Không tra được đơn hàng.', 500);
  }
  return data ?? null;
}
