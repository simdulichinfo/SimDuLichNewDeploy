import { NextResponse } from 'next/server';
import { optionalAuthenticate, authErrorResponse } from '../../../../lib/apiAuth';
import { createOrder, OrderError } from '../../../../lib/orders';

export async function POST(request) {
  try {
    const { user, supabase } = await optionalAuthenticate(request);
    if (!supabase) {
      return NextResponse.json({ message: 'Máy chủ chưa cấu hình Supabase.' }, { status: 500 });
    }

    const body = await request.json();
    const { custName, custEmail, custPhone, paymentMethod, shippingMethod, shippingAddress, items } = body;
    if (!custName || !custEmail || !custPhone || !paymentMethod || !shippingMethod || !items?.length) {
      return NextResponse.json({ message: 'Thiếu thông tin bắt buộc.' }, { status: 400 });
    }

    const order = await createOrder(supabase, {
      userId: user?.id ?? null, custName, custEmail, custPhone, paymentMethod, shippingMethod, shippingAddress, items,
    });
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json({ message: error.message }, { status: error.status });
    }
    return authErrorResponse(error);
  }
}
