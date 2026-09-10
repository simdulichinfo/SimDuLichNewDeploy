import { getOrderByCode } from './orders';

export function buildSepayPayUrl({ totalAmount, orderCode }) {
  const acc = process.env.SEPAY_ACCOUNT_NUMBER;
  const bank = process.env.SEPAY_BANK_NAME;
  return `https://qr.sepay.vn/img?acc=${encodeURIComponent(acc)}&bank=${encodeURIComponent(bank)}&amount=${totalAmount}&des=${encodeURIComponent(orderCode)}`;
}

export async function initiatePayment(supabase, { orderCode, provider }) {
  const order = await getOrderByCode(supabase, orderCode);
  if (!order) {
    return { data: null, error: { status: 404, message: 'Không tìm thấy đơn hàng.' } };
  }
  if (provider !== 'sepay') {
    return { data: null, error: { status: 400, message: 'Cổng thanh toán chưa được hỗ trợ.' } };
  }

  return {
    data: {
      orderId: order.id,
      orderCode: order.orderCode,
      provider,
      amount: order.totalAmount,
      payUrl: buildSepayPayUrl({ totalAmount: order.totalAmount, orderCode: order.orderCode }),
      providerRef: order.orderCode,
      bankName: process.env.SEPAY_BANK_NAME,
      accountNumber: process.env.SEPAY_ACCOUNT_NUMBER,
      accountHolder: process.env.SEPAY_ACCOUNT_HOLDER,
    },
    error: null,
  };
}
