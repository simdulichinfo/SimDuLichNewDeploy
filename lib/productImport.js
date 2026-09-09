import * as XLSX from 'xlsx';
import { classify } from './smartImport';

export function parseImportRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: null });
}

export function computePriceBuyFromRow(row, pricingMode, { markupPercent, fixedFee } = {}) {
  if (row.priceBuy != null && row.priceBuy !== '') {
    return Number(row.priceBuy);
  }
  const priceImport = Number(row.priceImport);
  if (pricingMode === 'markupPercent') {
    const effectiveMarkup = markupPercent != null ? Number(markupPercent) : 30;
    return Math.round(priceImport * (1 + effectiveMarkup / 100));
  }
  if (pricingMode === 'daysPlusFee') {
    const effectiveFixedFee = fixedFee != null ? Number(fixedFee) : 14000;
    return Math.round(priceImport * Number(row.durationDays) + effectiveFixedFee);
  }
  return null;
}

export async function runProductImport(supabase, buffer, { pricingMode = 'manual', markupPercent, fixedFee } = {}) {
  const rows = parseImportRows(buffer);
  const results = [];
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    try {
      const { data: category, error: categoryError } = await supabase.from('categories').select('id').eq('slug', row.categorySlug).maybeSingle();
      if (categoryError) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: `Lỗi khi tra danh mục: ${categoryError.message}` });
        failed += 1;
        continue;
      }
      if (!category) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: `Không tìm thấy danh mục với slug "${row.categorySlug}".` });
        failed += 1;
        continue;
      }

      const priceBuy = computePriceBuyFromRow(row, pricingMode, { markupPercent, fixedFee });
      if (priceBuy == null || !Number.isFinite(priceBuy) || priceBuy <= 0) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: 'Thiếu giá bán (priceBuy) — chế độ manual yêu cầu cột này trong file.' });
        failed += 1;
        continue;
      }

      const durationDays = Number(row.durationDays);
      if (row.durationDays == null || row.durationDays === '' || !Number.isFinite(durationDays) || durationDays <= 0) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: 'Thiếu số ngày sử dụng (durationDays).' });
        failed += 1;
        continue;
      }

      const priceImport = Number(row.priceImport);
      if (row.priceImport == null || row.priceImport === '' || !Number.isFinite(priceImport) || priceImport <= 0) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: 'Thiếu giá nhập (priceImport).' });
        failed += 1;
        continue;
      }

      const { packageType, capacityBucket } = classify(row.title, row.dataInfo);
      const productRow = {
        category_id: category.id,
        title: row.title,
        sim_type: row.simType,
        price_buy: priceBuy,
        price_import: priceImport,
        data_info: row.dataInfo,
        duration_days: durationDays,
        package_type: packageType,
        capacity_bucket: capacityBucket,
        status: row.status,
      };

      const { data: existing, error: existingError } = await supabase.from('products').select('id').eq('slug', row.slug).maybeSingle();
      if (existingError) {
        results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: `Lỗi khi tra sản phẩm: ${existingError.message}` });
        failed += 1;
        continue;
      }

      if (existing) {
        const { error } = await supabase.from('products').update(productRow).eq('id', existing.id);
        if (error) {
          results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: error.message });
          failed += 1;
        } else {
          results.push({ row: rowNumber, slug: row.slug, status: 'updated', message: null });
          updated += 1;
        }
      } else {
        const { error } = await supabase.from('products').insert({ ...productRow, slug: row.slug });
        if (error) {
          results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: error.message });
          failed += 1;
        } else {
          results.push({ row: rowNumber, slug: row.slug, status: 'created', message: null });
          created += 1;
        }
      }
    } catch (err) {
      results.push({ row: rowNumber, slug: row.slug, status: 'failed', message: err instanceof Error ? err.message : String(err) });
      failed += 1;
    }
  }

  return { totalRows: rows.length, created, updated, failed, rows: results };
}
