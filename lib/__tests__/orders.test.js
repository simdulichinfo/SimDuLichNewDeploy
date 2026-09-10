import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();
const supabaseMock = { from: fromMock, rpc: rpcMock };

import { createOrder, getOrderByCode, OrderError } from '../orders';

describe('lib/orders — createOrder', () => {
  beforeEach(() => {
    fromMock.mockReset();
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
