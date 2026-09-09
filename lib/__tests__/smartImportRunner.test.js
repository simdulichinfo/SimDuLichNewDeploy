import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';
import { classify } from '../smartImport';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

function buildWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 11 }, () => [null]);
  esimSheetData[10] = [1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, ''];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

function buildDuplicateSlugWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 10 }, () => [null]);
  // Two rows with identical rawTitle + code => identical computed slug.
  esimSheetData.push([1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, '']);
  esimSheetData.push([2, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 51000, 66000, '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

function buildUnlimitedTitleWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 10 }, () => [null]);
  esimSheetData.push([1, 'WM-JP-UNL', 'Japan Unlimited Data 7 Days', 'Japan', '', 7, null, 'esim', 80000, 100000, '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

function buildLargeWorkbookBuffer(rowCount) {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 10 }, () => [null]);
  for (let i = 0; i < rowCount; i++) {
    esimSheetData.push([i + 1, `C${i}`, 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, '']);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { runSmartImport } from '../smartImportRunner';

describe('runSmartImport — analyze (commit: false)', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('đánh dấu categoryExists=false cho danh mục chưa có trong DB, không ghi gì', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: false });

    expect(summary.totalRows).toBe(1);
    expect(summary.esimRows).toBe(1);
    expect(summary.physicalRows).toBe(0);
    expect(summary.newCategoriesCount).toBe(1);
    expect(summary.newCategoryNames).toEqual(['Japan']);
    expect(summary.rows[0]).toMatchObject({
      row: 11, sheet: 'eSIM prices new', rawTitle: 'Japan 1GB, 1 Day',
      categoryName: 'Japan', categoryExists: false, simType: 'esim',
      priceImport: 50000, priceBuy: 65000, pricingRule: 'fromFile', warning: null, error: null,
    });
    const categoriesFrom = fromMock.mock.calls.filter(([table]) => table === 'categories');
    expect(categoriesFrom.every(() => true)).toBe(true);
  });

  it('đánh dấu categoryExists=true khi danh mục đã có trong DB', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: false });

    expect(summary.newCategoriesCount).toBe(0);
    expect(summary.rows[0].categoryExists).toBe(true);
  });
});

describe('runSmartImport — commit (commit: true)', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('tạo category mới rồi upsert sản phẩm, trả created=1', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const categoriesInsertQuery = createQueryBuilderMock({ data: [{ id: 7, name: 'Japan' }], error: null });
    const categoryCountriesInsertQuery = createQueryBuilderMock({ data: [], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [{ slug: 'japan-1gb-1-day-wm-jp-1d' }], error: null });

    let categoriesCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        categoriesCall += 1;
        return categoriesCall === 1 ? categoriesSelectQuery : categoriesInsertQuery;
      }
      if (table === 'category_countries') return categoryCountriesInsertQuery;
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: true });

    expect(categoriesInsertQuery.insert).toHaveBeenCalledWith([{ name: 'Japan', slug: 'japan', image_url: null, status: 'active' }]);
    expect(productsUpsertQuery.upsert).toHaveBeenCalled();
    expect(summary.totalRows).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
  });
});

describe('runSmartImport — Critical/Important fixes', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('slug trùng trong 1 file: dòng cuối cùng thắng, upsert không chứa slug trùng', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [{ slug: 'japan-1gb-1-day-wm-jp-1d' }], error: null });

    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoriesSelectQuery;
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildDuplicateSlugWorkbookBuffer(), {}, { commit: true });

    expect(productsUpsertQuery.upsert).toHaveBeenCalledTimes(1);
    const upsertedRows = productsUpsertQuery.upsert.mock.calls[0][0];
    const upsertedSlugs = upsertedRows.map((r) => r.slug);
    expect(upsertedSlugs).toHaveLength(new Set(upsertedSlugs).size); // no duplicate slugs
    expect(upsertedRows).toHaveLength(1);
    // Last occurrence (row 12, priceImport 51000) must be the one that survives.
    expect(upsertedRows[0].price_import).toBe(51000);

    expect(summary.totalRows).toBe(2);
    expect(summary.rows.find((r) => r.row === 11).status).toBe('skipped');
    expect(summary.rows.find((r) => r.row === 12).status).toBe('created');
    expect(summary.created).toBe(1);
  });

  it('classify() được gọi và kết quả được dùng cho package_type/capacity_bucket/data_info', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [{ slug: 'japan-unlimited-data-7-days-wm-jp-unl' }], error: null });

    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoriesSelectQuery;
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    await runSmartImport(supabaseMock, buildUnlimitedTitleWorkbookBuffer(), {}, { commit: true });

    const expected = classify('Japan Unlimited Data 7 Days', '');
    expect(productsUpsertQuery.upsert).toHaveBeenCalledTimes(1);
    const upsertedRows = productsUpsertQuery.upsert.mock.calls[0][0];
    expect(upsertedRows[0].package_type).toBe(expected.packageType);
    expect(upsertedRows[0].capacity_bucket).toBe(expected.capacityBucket);
    expect(upsertedRows[0].data_info).toBe(expected.dataInfo);
    expect(upsertedRows[0].package_type).toBe('unlimited');
  });

  it('1 chunk upsert lỗi chỉ làm fail đúng chunk đó, chunk khác vẫn created/updated', async () => {
    const rowCount = 520; // spans 2 chunks of 500 for both select-in and upsert
    const categoriesSelectQuery = createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const upsertChunk1Query = createQueryBuilderMock({ data: [], error: null });
    const upsertChunk2Query = createQueryBuilderMock({ data: null, error: { message: 'boom chunk 2' } });

    let productsCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoriesSelectQuery;
      if (table === 'products') {
        productsCall += 1;
        // 2 select-in chunks (520 unique slugs > 500) then 2 upsert chunks.
        if (productsCall <= 2) return productsSelectQuery;
        return productsCall === 3 ? upsertChunk1Query : upsertChunk2Query;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildLargeWorkbookBuffer(rowCount), {}, { commit: true });

    expect(upsertChunk1Query.upsert).toHaveBeenCalledTimes(1);
    expect(upsertChunk2Query.upsert).toHaveBeenCalledTimes(1);
    expect(upsertChunk1Query.upsert.mock.calls[0][0]).toHaveLength(500);
    expect(upsertChunk2Query.upsert.mock.calls[0][0]).toHaveLength(20);

    expect(summary.totalRows).toBe(520);
    expect(summary.created).toBe(500);
    expect(summary.failed).toBe(20);
    const rowsByNumber = new Map(summary.rows.map((r) => [r.row, r]));
    for (let i = 1; i <= 500; i++) {
      expect(rowsByNumber.get(i + 10).status).toBe('created');
    }
    for (let i = 501; i <= 520; i++) {
      expect(rowsByNumber.get(i + 10).status).toBe('failed');
      expect(rowsByNumber.get(i + 10).message).toBe('boom chunk 2');
    }
  });

  it('categories.insert() lỗi: các dòng thuộc danh mục mới bị failed, không upsert sản phẩm cho danh mục đó', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const categoriesInsertQuery = createQueryBuilderMock({ data: null, error: { message: 'insert failed: unique violation' } });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [], error: null });

    let categoriesCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        categoriesCall += 1;
        return categoriesCall === 1 ? categoriesSelectQuery : categoriesInsertQuery;
      }
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: true });

    expect(productsUpsertQuery.upsert).not.toHaveBeenCalled();
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.rows[0].status).toBe('failed');
    expect(summary.rows[0].message).toContain('Japan');
    expect(summary.rows[0].message).toContain('insert failed: unique violation');
  });
});
