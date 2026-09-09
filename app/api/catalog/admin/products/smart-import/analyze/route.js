import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../../lib/apiAuth';
import { runSmartImport } from '../../../../../../../lib/smartImportRunner';

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
      esimMarkupPercent: esimMarkupPercent != null ? Number(esimMarkupPercent) : null,
      physicalFixedFee: physicalFixedFee != null ? Number(physicalFixedFee) : null,
      physicalNoDurationMultiplier: physicalNoDurationMultiplier != null ? Number(physicalNoDurationMultiplier) : null,
    }, { commit: false });

    return NextResponse.json(preview);
  } catch (error) {
    return authErrorResponse(error);
  }
}
