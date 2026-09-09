import { NextResponse } from 'next/server';
import { authenticate, authErrorResponse, requireRole } from '../../../../../../lib/apiAuth';
import { updateProductAdmin, deleteProductAdmin } from '../../../../../../lib/adminCatalog';

function validateProductBody(body) {
  const { categoryId, title, slug, simType, priceBuy, priceImport, dataInfo, durationDays, status } = body;
  if (!categoryId || !title || !slug || !priceBuy || !priceImport || !dataInfo || !durationDays || !status) {
    return 'Thiếu thông tin bắt buộc.';
  }
  if (simType !== 'esim' && simType !== 'physical') {
    return 'simType chỉ nhận "esim" hoặc "physical".';
  }
  return null;
}

export async function PUT(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const body = await request.json();
    const validationError = validateProductBody(body);
    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const { data, error } = await updateProductAdmin(supabase, id, body);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'categoryId không tồn tại.' }, { status: 400 });
      }
      if (error.code === '23505') {
        return NextResponse.json({ message: 'Slug đã tồn tại, vui lòng chọn slug khác.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không cập nhật được sản phẩm.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  try {
    const { user, supabase } = await authenticate(request);
    requireRole(user, ['admin', 'staff']);
    const { id } = await params;

    const { deleted, error } = await deleteProductAdmin(supabase, id);
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ message: 'Không thể xoá — sản phẩm còn ICCID trong kho.' }, { status: 400 });
      }
      return NextResponse.json({ message: 'Không xoá được sản phẩm.' }, { status: 500 });
    }
    if (!deleted) {
      return NextResponse.json({ message: 'Không tìm thấy sản phẩm.' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return authErrorResponse(error);
  }
}
