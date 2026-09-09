import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { runProductImport } from '../../../../../../lib/productImport';

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file) {
      return NextResponse.json({ message: 'Vui lòng chọn file để nhập.' }, { status: 400 });
    }

    const pricingMode = formData.get('pricingMode') || 'manual';
    const markupPercent = formData.get('markupPercent');
    const fixedFee = formData.get('fixedFee');

    const buffer = Buffer.from(await file.arrayBuffer());
    const summary = await runProductImport(supabase, buffer, {
      pricingMode,
      markupPercent: markupPercent != null ? Number(markupPercent) : null,
      fixedFee: fixedFee != null ? Number(fixedFee) : null,
    });

    return NextResponse.json(summary);
  } catch (error) {
    return authErrorResponse(error);
  }
}
