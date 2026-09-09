import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { runSmartImport, SmartImportLookupError } from '../../../../../../../lib/smartImportRunner';

// Treats both an absent field (formData.get returns null) and a submitted-but-blank
// field (formData.get returns '' for an empty <input type="number">) as "not provided",
// so downstream defaulting (e.g. esimMarkupPercent ?? 30) applies in both cases.
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
      return NextResponse.json({ message: 'Vui lòng chọn file bảng giá (.xlsx) trước.' }, { status: 400 });
    }

    const esimMarkupPercent = formData.get('esimMarkupPercent');
    const physicalFixedFee = formData.get('physicalFixedFee');
    const physicalNoDurationMultiplier = formData.get('physicalNoDurationMultiplier');

    const buffer = Buffer.from(await file.arrayBuffer());
    const preview = await runSmartImport(supabase, buffer, {
      esimMarkupPercent: parseOptionalNumber(esimMarkupPercent),
      physicalFixedFee: parseOptionalNumber(physicalFixedFee),
      physicalNoDurationMultiplier: parseOptionalNumber(physicalNoDurationMultiplier),
    }, { commit: false });

    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof SmartImportLookupError) {
      return NextResponse.json({ message: 'Không đọc được dữ liệu hiện có, vui lòng thử lại.' }, { status: 500 });
    }
    return authErrorResponse(error);
  }
}
