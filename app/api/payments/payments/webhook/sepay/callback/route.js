import { NextResponse } from 'next/server';
import { createServiceClient } from '../../../../../../../lib/supabase/serviceClient';
import { processSepayWebhook } from '../../../../../../../lib/paymentsWebhook';

export async function POST(request) {
  const authHeader = request.headers.get('authorization') || '';
  const expectedKey = process.env.SEPAY_API_KEY;
  if (!expectedKey || authHeader !== `Apikey ${expectedKey}`) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const serviceClient = createServiceClient();
  if (!serviceClient) {
    return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
  }

  const payload = await request.json();
  await processSepayWebhook(serviceClient, payload);
  return NextResponse.json({ received: true });
}
