import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { runProductImport } from '../../../../../../lib/productImport';

// Treats both an absent field (formData.get returns null) and a submitted-but-blank
// field (formData.get returns '' for an empty <input type="number">) as "not provided",
// so downstream defaulting (e.g. markupPercent ?? 30) applies in both cases.
function parseOptionalNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

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
      markupPercent: parseOptionalNumber(markupPercent),
      fixedFee: parseOptionalNumber(fixedFee),
    });

    return NextResponse.json(summary);
  } catch (error) {
    return authErrorResponse(error);
  }
}
