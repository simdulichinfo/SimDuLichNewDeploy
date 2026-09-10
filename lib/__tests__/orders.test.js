import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

// Same shape as createQueryBuilderMock, but resolves a different result on each
// successive await against the chain (used for the order-code collision-retry loop).
function createSequentialQueryBuilderMock(results) {
  let callIndex = 0;
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => {
      const result = results[Math.min(callIndex, results.length - 1)];
      callIndex += 1;
      return resolve(result);
    },
  };
  return builder;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();
const supabaseMock = { from: fromMock, rpc: rpcMock };

import { createOrder, getOrderByCode, OrderError } from '../orders';

describe('lib/orders — createOrder', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    fromMock.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('tạo đơn thành công cho sản phẩm eSIM, tự tính lại tổng tiền từ DB', async () => {
    const productsQuery = createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    });
    const orderInsertQuery = createQueryBuilderMock({
      data: { id: 100, order_code: 'SDL2345ABCD', user_id: null, cust_name: 'A', cust_email: 'a@x.vn', cust_phone: '0900000000', total_amount: 178000, payment_method: 'sepay', payment_status: 'pending', shipping_method: 'email', shipping_address: null, shipping_status: 'none', carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z' },
      error: null,
    });
    const itemsInsertQuery = createQueryBuilderMock({
      data: [{ id: 1, product_id: 1, product_title: 'eSIM Nhật Bản', quantity: 2, unit_price: 89000, sim_type: 'esim' }],
      error: null,
    });
    let orderCallCount = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'products') return productsQuery;
      if (table === 'orders') { orderCallCount += 1; return orderInsertQuery; }
      if (table === 'order_items') return itemsInsertQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 2 }],
    });

    expect(orderInsertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ total_amount: 178000 }));
    expect(result).toEqual({
      id: 100, orderCode: 'SDL2345ABCD', userId: null,
      custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      totalAmount: 178000, paymentMethod: 'sepay', paymentStatus: 'pending',
      shippingMethod: 'email', shippingAddress: null, shippingStatus: 'none',
      carrierName: null, trackingCode: null, createdAt: '2026-09-10T00:00:00Z',
      items: [{ id: 1, productId: 1, productName: 'eSIM Nhật Bản', quantity: 2, unitPrice: 89000, simType: 'esim' }],
    });
  });

  it('ném OrderError 400 khi sản phẩm vật lý mà shippingMethod không phải delivery', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 2, title: 'SIM vật lý Việt Nam', price_buy: 150000, sim_type: 'physical', status: 'active' }],
      error: null,
    }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 2, quantity: 1 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('ném OrderError 400 khi sản phẩm không tồn tại hoặc không active', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 999, quantity: 1 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('ném OrderError 400 khi items rỗng', async () => {
    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('ném OrderError 500 khi price_buy của sản phẩm không hợp lệ (0 hoặc âm)', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 3, title: 'SIM lỗi giá', price_buy: 0, sim_type: 'esim', status: 'active' }],
      error: null,
    }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 3, quantity: 1 }],
    })).rejects.toMatchObject({ status: 500 });

    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 4, title: 'SIM giá âm', price_buy: -100, sim_type: 'esim', status: 'active' }],
      error: null,
    }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 4, quantity: 1 }],
    })).rejects.toMatchObject({ status: 500 });
  });

  it('ném OrderError 500 khi lấy danh sách sản phẩm lỗi (productsError)', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { message: 'db down' } }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    })).rejects.toMatchObject({ status: 500 });
  });

  it('ném OrderError 400 khi sản phẩm vật lý, shippingMethod là delivery nhưng thiếu shippingAddress', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 2, title: 'SIM vật lý Việt Nam', price_buy: 150000, sim_type: 'physical', status: 'active' }],
      error: null,
    }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'delivery', shippingAddress: '',
      items: [{ productId: 2, quantity: 1 }],
    })).rejects.toMatchObject({ status: 400 });
  });

  it('thử lại tạo order_code khi bị trùng (23505) ở lần đầu, thành công ở lần 2', async () => {
    const productsQuery = createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    });
    const successOrderRow = {
      id: 200, order_code: 'SDL2345WXYZ', user_id: null, cust_name: 'A', cust_email: 'a@x.vn',
      cust_phone: '0900000000', total_amount: 89000, payment_method: 'sepay', payment_status: 'pending',
      shipping_method: 'email', shipping_address: null, shipping_status: 'none',
      carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z',
    };
    const orderInsertQuery = createSequentialQueryBuilderMock([
      { data: null, error: { code: '23505' } },
      { data: successOrderRow, error: null },
    ]);
    const itemsInsertQuery = createQueryBuilderMock({
      data: [{ id: 1, product_id: 1, product_title: 'eSIM Nhật Bản', quantity: 1, unit_price: 89000, sim_type: 'esim' }],
      error: null,
    });
    fromMock.mockImplementation((table) => {
      if (table === 'products') return productsQuery;
      if (table === 'orders') return orderInsertQuery;
      if (table === 'order_items') return itemsInsertQuery;
      throw new Error(`unexpected table ${table}`);
    });

    const result = await createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    });

    expect(orderInsertQuery.insert).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(200);
    expect(result.orderCode).toBe('SDL2345WXYZ');
  });

  it('ném OrderError 500 ngay khi lỗi insert order không phải 23505 (không thử lại)', async () => {
    const productsQuery = createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    });
    const orderInsertQuery = createQueryBuilderMock({ data: null, error: { code: '99999', message: 'db down' } });
    fromMock.mockImplementation((table) => {
      if (table === 'products') return productsQuery;
      if (table === 'orders') return orderInsertQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    })).rejects.toMatchObject({ status: 500 });

    expect(orderInsertQuery.insert).toHaveBeenCalledTimes(1);
  });

  it('ném OrderError 500 khi cả 5 lần thử tạo order_code đều bị trùng (23505)', async () => {
    const productsQuery = createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    });
    const orderInsertQuery = createQueryBuilderMock({ data: null, error: { code: '23505' } });
    fromMock.mockImplementation((table) => {
      if (table === 'products') return productsQuery;
      if (table === 'orders') return orderInsertQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    })).rejects.toMatchObject({
      status: 500,
      message: 'Không tạo được mã đơn hàng duy nhất, vui lòng thử lại.',
    });

    expect(orderInsertQuery.insert).toHaveBeenCalledTimes(5);
  });

  it('xóa order vừa tạo khi insert order_items lỗi (tránh order rác không có sản phẩm)', async () => {
    const productsQuery = createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    });
    const orderRow = {
      id: 300, order_code: 'SDL2345LMNO', user_id: null, cust_name: 'A', cust_email: 'a@x.vn',
      cust_phone: '0900000000', total_amount: 89000, payment_method: 'sepay', payment_status: 'pending',
      shipping_method: 'email', shipping_address: null, shipping_status: 'none',
      carrier_name: null, tracking_code: null, created_at: '2026-09-10T00:00:00Z',
    };
    const orderQuery = createQueryBuilderMock({ data: orderRow, error: null });
    const itemsInsertQuery = createQueryBuilderMock({ data: null, error: { message: 'insert failed' } });
    fromMock.mockImplementation((table) => {
      if (table === 'products') return productsQuery;
      if (table === 'orders') return orderQuery;
      if (table === 'order_items') return itemsInsertQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    })).rejects.toMatchObject({ status: 500 });

    expect(orderQuery.delete).toHaveBeenCalled();
    expect(orderQuery.eq).toHaveBeenCalledWith('id', 300);
  });
});

describe('lib/orders — getOrderByCode', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('trả order khi RPC tìm thấy', async () => {
    rpcMock.mockResolvedValue({ data: { id: 1, orderCode: 'SDL2345ABCD', items: [] }, error: null });

    const result = await getOrderByCode(supabaseMock, 'SDL2345ABCD');

    expect(rpcMock).toHaveBeenCalledWith('get_order_by_code', { p_order_code: 'SDL2345ABCD' });
    expect(result).toEqual({ id: 1, orderCode: 'SDL2345ABCD', items: [] });
  });

  it('trả null khi RPC không tìm thấy', async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await getOrderByCode(supabaseMock, 'KHONGTONTAI');

    expect(result).toBeNull();
  });

  it('ném OrderError 500 khi RPC lỗi', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(getOrderByCode(supabaseMock, 'SDL2345ABCD')).rejects.toBeInstanceOf(OrderError);
  });
});
