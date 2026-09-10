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

const fromMock = vi.fn();
const rpcMock = vi.fn();
const supabaseMock = { from: fromMock, rpc: rpcMock };

import { createOrder, getOrderByCode, OrderError } from '../orders';

// Shape returned by the create_order RPC (already camelCase, same as get_order_by_code).
function makeRpcOrder(overrides = {}) {
  return {
    id: 100,
    orderCode: 'SDL2345ABCD',
    userId: null,
    custName: 'A',
    custEmail: 'a@x.vn',
    custPhone: '0900000000',
    totalAmount: 178000,
    paymentMethod: 'sepay',
    paymentStatus: 'pending',
    shippingMethod: 'email',
    shippingAddress: null,
    shippingStatus: 'none',
    carrierName: null,
    trackingCode: null,
    createdAt: '2026-09-10T00:00:00Z',
    items: [
      { id: 1, productId: 1, productName: 'eSIM Nhật Bản', quantity: 2, unitPrice: 89000, simType: 'esim' },
    ],
    ...overrides,
  };
}

describe('lib/orders — createOrder', () => {
  let consoleErrorSpy;

  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
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
    fromMock.mockImplementation((table) => {
      if (table === 'products') return productsQuery;
      throw new Error(`unexpected table ${table}`);
    });
    const rpcOrder = makeRpcOrder();
    rpcMock.mockResolvedValue({ data: rpcOrder, error: null });

    const result = await createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 2 }],
    });

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith('create_order', expect.objectContaining({
      p_total_amount: 178000,
      p_payment_method: 'sepay',
      p_shipping_method: 'email',
      p_shipping_address: null,
      p_shipping_status: 'none',
      p_items: [
        { productId: 1, productTitle: 'eSIM Nhật Bản', quantity: 2, unitPrice: 89000, simType: 'esim' },
      ],
    }));
    expect(result).toEqual(rpcOrder);
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

    expect(rpcMock).not.toHaveBeenCalled();
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

  it('ném OrderError 400 khi quantity không phải số nguyên (ví dụ 1.5)', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    }));

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1.5 }],
    })).rejects.toMatchObject({
      status: 400,
      message: 'Số lượng sản phẩm phải là số nguyên lớn hơn 0.',
    });

    expect(rpcMock).not.toHaveBeenCalled();
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

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('ném OrderError 400 khi productId không phải số nguyên (ví dụ "abc"), không gọi truy vấn products', async () => {
    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 'abc', quantity: 1 }],
    })).rejects.toMatchObject({ status: 400 });

    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('ném OrderError 400 khi productId không phải số nguyên (ví dụ 1.5), không gọi truy vấn products', async () => {
    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1.5, quantity: 1 }],
    })).rejects.toMatchObject({ status: 400 });

    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
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

  it('thử lại tạo order_code khi RPC báo trùng (23505) ở lần đầu, thành công ở lần 2', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    }));
    const successOrder = makeRpcOrder({
      id: 200,
      orderCode: 'SDL2345WXYZ',
      totalAmount: 89000,
      items: [{ id: 1, productId: 1, productName: 'eSIM Nhật Bản', quantity: 1, unitPrice: 89000, simType: 'esim' }],
    });
    rpcMock
      .mockResolvedValueOnce({ data: null, error: { code: '23505' } })
      .mockResolvedValueOnce({ data: successOrder, error: null });

    const result = await createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    });

    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual(successOrder);
  });

  it('ném OrderError 500 ngay khi lỗi RPC không phải 23505 (không thử lại)', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    }));
    rpcMock.mockResolvedValue({ data: null, error: { code: '99999', message: 'db down' } });

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    })).rejects.toMatchObject({ status: 500 });

    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('ném OrderError 500 khi cả 5 lần thử tạo order_code đều bị trùng (23505)', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({
      data: [{ id: 1, title: 'eSIM Nhật Bản', price_buy: 89000, sim_type: 'esim', status: 'active' }],
      error: null,
    }));
    rpcMock.mockResolvedValue({ data: null, error: { code: '23505' } });

    await expect(createOrder(supabaseMock, {
      userId: null, custName: 'A', custEmail: 'a@x.vn', custPhone: '0900000000',
      paymentMethod: 'sepay', shippingMethod: 'email', shippingAddress: null,
      items: [{ productId: 1, quantity: 1 }],
    })).rejects.toMatchObject({
      status: 500,
      message: 'Không tạo được mã đơn hàng duy nhất, vui lòng thử lại.',
    });

    expect(rpcMock).toHaveBeenCalledTimes(5);
    expect(consoleErrorSpy).toHaveBeenCalled();
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
