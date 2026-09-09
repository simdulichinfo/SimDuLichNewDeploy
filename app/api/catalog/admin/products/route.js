import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../lib/apiAuth';
import { listProductsAdmin, createProductAdmin } from '../../../../../lib/adminCatalog';

function validateProductBody(body) {
  const { categoryId, title, slug, simType, priceBuy, priceImport, dataInfo, durationDays, status } = body;
  if (!categoryId || !title || !slug || !priceBuy || !priceImport || !dataInfo || !status) {
    return 'Thiếu thông tin bắt buộc.';
  }
  // durationDays may be explicitly null (Smart Import's "no duration specified" for physical
  // SIMs, per migration 0006). Only undefined/missing, 0, and negative values are invalid.
  if (durationDays === undefined || (durationDays !== null && durationDays <= 0)) {
    return 'Thiếu thông tin bắt buộc.';
  }
  if (simType !== 'esim' && simType !== 'physical') {
    return 'simType chỉ nhận "esim" hoặc "physical".';
  }
  return null;
}

export async function GET(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const { data, error } = await listProductsAdmin(supabase);
    if (error) {
      return NextResponse.json({ message: 'Không tải được danh sách sản phẩm.' }, { status: 500 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);

    const body = await request.json();
    const validationError = validateProductBody(body);
    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const { data, error } = await createProductAdmin(supabase, body);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'categoryId không tồn tại.' }, { status: 400 });
      }
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không tạo được sản phẩm.' }, { status: 500 });
    }
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
