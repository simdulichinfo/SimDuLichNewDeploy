import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../../../lib/supabase/serviceClient';
import { simulatePaymentWebhook } from '../../../../../../lib/paymentsWebhook';

export async function POST(request) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ message: 'Không tìm thấy.' }, { status: 404 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const { orderId, amount, transactionRef } = await request.json();
  const result = await simulatePaymentWebhook(serviceClient, { orderId, amount, transactionRef });
  return NextResponse.json({ processed: result.matched, duplicate: !!result.duplicate });
}
