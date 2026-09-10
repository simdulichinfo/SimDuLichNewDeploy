import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getOrderByCodeMock = vi.fn();

vi.mock('../orders', () => ({
  getOrderByCode: (...args) => getOrderByCodeMock(...args),
}));

import { buildSepayPayUrl, initiatePayment } from '../payments';

describe('buildSepayPayUrl', () => {
  const originalAcc = process.env.SEPAY_ACCOUNT_NUMBER;
  const originalBank = process.env.SEPAY_BANK_NAME;

  beforeEach(() => {
    process.env.SEPAY_ACCOUNT_NUMBER = '0123456789';
    process.env.SEPAY_BANK_NAME = 'MBBank';
  });

  afterEach(() => {
    process.env.SEPAY_ACCOUNT_NUMBER = originalAcc;
    process.env.SEPAY_BANK_NAME = originalBank;
  });

  it('dựng đúng URL VietQR', () => {
    const url = buildSepayPayUrl({ totalAmount: 178000, orderCode: 'SDL2345ABCD' });
    expect(url).toBe('https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=178000&des=SDL2345ABCD');
  });
});

describe('initiatePayment', () => {
  beforeEach(() => {
    getOrderByCodeMock.mockReset();
    process.env.SEPAY_ACCOUNT_NUMBER = '0123456789';
    process.env.SEPAY_BANK_NAME = 'MBBank';
    process.env.SEPAY_ACCOUNT_HOLDER = 'CONG TY SIMDULICH';
  });

  it('trả InitiatePaymentResponse khi order tồn tại và provider là sepay', async () => {
    getOrderByCodeMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD', totalAmount: 178000 });

    const result = await initiatePayment({}, { orderCode: 'SDL2345ABCD', provider: 'sepay' });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      orderId: 1, orderCode: 'SDL2345ABCD', provider: 'sepay', amount: 178000,
      payUrl: 'https://qr.sepay.vn/img?acc=0123456789&bank=MBBank&amount=178000&des=SDL2345ABCD',
      providerRef: 'SDL2345ABCD', bankName: 'MBBank', accountNumber: '0123456789', accountHolder: 'CONG TY SIMDULICH',
    });
  });

  it('trả error 404 khi không tìm thấy order', async () => {
    getOrderByCodeMock.mockResolvedValue(null);

    const result = await initiatePayment({}, { orderCode: 'KHONGTONTAI', provider: 'sepay' });

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ status: 404, message: 'Không tìm thấy đơn hàng.' });
  });

  it('trả error 400 khi provider không phải sepay', async () => {
    getOrderByCodeMock.mockResolvedValue({ id: 1, orderCode: 'SDL2345ABCD', totalAmount: 178000 });

    const result = await initiatePayment({}, { orderCode: 'SDL2345ABCD', provider: 'momo' });

    expect(result.data).toBeNull();
    expect(result.error).toEqual({ status: 400, message: 'Cổng thanh toán chưa được hỗ trợ.' });
  });
});
