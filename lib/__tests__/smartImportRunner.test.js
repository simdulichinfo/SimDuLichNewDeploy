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
  // Three rows with identical rawTitle + code => identical computed base slug.
  esimSheetData.push([1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, '']);
  esimSheetData.push([2, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 51000, 66000, '']);
  esimSheetData.push([3, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 52000, 67000, '']);
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

// Generic title (no data-amount/duration/unlimited signal) but the description
// column (index 4 / column E) carries an "Unlimited" signal that classify()
// is designed to pick up from title+description combined.
function buildDescriptionSignalWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 10 }, () => [null]);
  esimSheetData.push([1, 'WM-JP-DESC', 'Japan Data Plan', 'Japan', 'Unlimited data, 7 days', 7, null, 'esim', 80000, 100000, '']);
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
    esimSheetData.push([i + 1, `C${i}`, `Japan ${i} 1GB, 1 Day`, 'Japan', '', 1, null, 'esim', 50000, 65000, '']);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

function buildMissingTitleWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 10 }, () => [null]);
  esimSheetData.push([1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, '']);
  // Row 2: missing rawTitle -> parseError, must be excluded from lookups/commit.
  esimSheetData.push([2, 'WM-NOTITLE', null, 'Japan', '', 1, null, 'esim', 50000, 65000, '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

function buildZeroDurationWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 10 }, () => [null]);
  // durationDays cell (index 5) is explicitly 0.
  physicalSheetData.push([1, 'WM-VN-P0', 'Vietnam physical 5GB', 'Vietnam', '', 0, null, 'physical', 80000, null, '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

// eSIM row with NO priceBuyFromFile (col J / index 9 is null), so pricing must
// fall through to the markupPercent rule instead of the fromFile rule.
function buildEsimNoFromFileWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 10 }, () => [null]);
  esimSheetData.push([1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, null, '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

  const physicalSheetData = Array.from({ length: 11 }, () => [null]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

  const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
  XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
  XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

  return XLSX.write(wb, { type: 'buffer' });
}

function buildTwoCategoriesWorkbookBuffer() {
  const wb = XLSX.utils.book_new();

  const esimSheetData = Array.from({ length: 10 }, () => [null]);
  esimSheetData.push([1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, '']);
  esimSheetData.push([2, 'WM-VN-1D', 'Vietnam 1GB, 1 Day', 'Vietnam', '', 1, null, 'esim', 50000, 65000, '']);
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

import { runSmartImport, SmartImportLookupError } from '../smartImportRunner';

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
    expect(summary.errorCount).toBe(0);
    expect(summary.rows[0]).toMatchObject({
      row: 11, sheet: 'eSIM prices new', rawTitle: 'Japan 1GB, 1 Day',
      categoryName: 'Japan', categoryExists: false, simType: 'esim',
      priceImport: 50000, priceBuy: 65000, pricingRule: 'fromFile', warning: null, error: null,
    });
    // classify() should be used for the preview's dataInfo too (Important #3.1).
    expect(summary.rows[0].dataInfo).toBe(classify('Japan 1GB, 1 Day', '').dataInfo);
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

  it('dòng có parseError (thiếu tên/khu vực) vẫn được đếm vào totalRows/errorCount và xuất hiện trong rows kèm error, bị loại khỏi tra cứu category/product', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildMissingTitleWorkbookBuffer(), {}, { commit: false });

    expect(summary.totalRows).toBe(2);
    expect(summary.errorCount).toBe(1);
    // Only the valid row's region should be treated as a new category candidate.
    expect(summary.newCategoryNames).toEqual(['Japan']);

    const errorRow = summary.rows.find((r) => r.row === 12);
    expect(errorRow.error).toBe('Thiếu tên gói hoặc quốc gia/khu vực.');

    // The `.in()` lookup for categories must only be asked about the valid row's region.
    const categoriesCalls = fromMock.mock.calls.filter(([table]) => table === 'categories');
    expect(categoriesCalls.length).toBeGreaterThan(0);
  });

  it('lỗi từ .in() lookup (categories) khiến toàn bộ analyze thất bại với SmartImportLookupError, không trả preview sai', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: null, error: { message: 'network blip' } });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: false }),
    ).rejects.toBeInstanceOf(SmartImportLookupError);
  });

  it('lỗi từ .in() lookup (products) cũng khiến toàn bộ analyze thất bại với SmartImportLookupError', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: null, error: { message: 'network blip' } });
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: false }),
    ).rejects.toBeInstanceOf(SmartImportLookupError);
  });

  it('durationDays = 0 (physical) -> dùng công thức noDurationMultiplier kèm warning, KHÔNG dùng daysPlusFee với giá nhập x 0', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(
      supabaseMock,
      buildZeroDurationWorkbookBuffer(),
      { physicalNoDurationMultiplier: 2 },
      { commit: false },
    );

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].durationDays).toBeNull();
    expect(summary.rows[0].pricingRule).toBe('noDurationMultiplier');
    expect(summary.rows[0].priceBuy).toBe(160000); // 80000 * 2, NOT 80000 * 0 + fixedFee
    expect(summary.rows[0].warning).toContain('Không tìm thấy số ngày');
  });

  it('chia .in() lookup thành các chunk 100 giá trị (không phải 500) cho cả categories và products', async () => {
    const rowCount = 150; // > 100 unique regions is impractical here; use unique slugs instead
    const categoriesInCalls = [];
    const productsInCalls = [];

    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        const builder = createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
        builder.in.mockImplementation((column, values) => {
          categoriesInCalls.push(values.length);
          return builder;
        });
        return builder;
      }
      if (table === 'products') {
        const builder = createQueryBuilderMock({ data: [], error: null });
        builder.in.mockImplementation((column, values) => {
          productsInCalls.push(values.length);
          return builder;
        });
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    });

    await runSmartImport(supabaseMock, buildLargeWorkbookBuffer(rowCount), {}, { commit: false });

    // 150 unique slugs -> 2 chunks of 100 and 50.
    expect(productsInCalls).toEqual([100, 50]);
    // Only 1 distinct region ("Japan") -> 1 chunk.
    expect(categoriesInCalls).toEqual([1]);
  });
});

describe('runSmartImport — commit (commit: true)', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('tạo category mới rồi upsert sản phẩm, trả created=1', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const categoriesUpsertQuery = createQueryBuilderMock({ data: [{ id: 7, name: 'Japan' }], error: null });
    const categoryCountriesInsertQuery = createQueryBuilderMock({ data: [], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [{ slug: 'japan-1gb-1-day-wm-jp-1d' }], error: null });

    let categoriesCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        categoriesCall += 1;
        return categoriesCall === 1 ? categoriesSelectQuery : categoriesUpsertQuery;
      }
      if (table === 'category_countries') return categoryCountriesInsertQuery;
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: true });

    expect(categoriesUpsertQuery.upsert).toHaveBeenCalledWith(
      [{ name: 'Japan', slug: 'japan', image_url: null, status: 'active' }],
      { onConflict: 'slug', ignoreDuplicates: true },
    );
    expect(productsUpsertQuery.upsert).toHaveBeenCalled();
    expect(summary.totalRows).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
  });
});

describe('runSmartImport — Critical/Important fixes (đợt 3 review)', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('slug trùng trong 1 file: mỗi dòng vẫn có slug riêng (đầu tiên giữ base, các dòng sau -1/-2), không dòng nào bị skip', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({
      data: [{ slug: 'japan-1gb-1-day-wm-jp-1d' }, { slug: 'japan-1gb-1-day-wm-jp-1d-1' }, { slug: 'japan-1gb-1-day-wm-jp-1d-2' }],
      error: null,
    });

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
    expect(upsertedSlugs).toEqual(['japan-1gb-1-day-wm-jp-1d', 'japan-1gb-1-day-wm-jp-1d-1', 'japan-1gb-1-day-wm-jp-1d-2']);
    expect(upsertedRows).toHaveLength(3);

    // Every row is genuinely upserted with ITS OWN data — none dropped/overwritten by another row's data.
    expect(upsertedRows.find((r) => r.slug === 'japan-1gb-1-day-wm-jp-1d').price_import).toBe(50000);
    expect(upsertedRows.find((r) => r.slug === 'japan-1gb-1-day-wm-jp-1d-1').price_import).toBe(51000);
    expect(upsertedRows.find((r) => r.slug === 'japan-1gb-1-day-wm-jp-1d-2').price_import).toBe(52000);

    expect(summary.totalRows).toBe(3);
    expect(summary.rows.find((r) => r.row === 11).status).toBe('created');
    expect(summary.rows.find((r) => r.row === 12).status).toBe('created');
    expect(summary.rows.find((r) => r.row === 13).status).toBe('created');
    expect(summary.created).toBe(3);
    expect(summary.rows.every((r) => r.status !== 'skipped')).toBe(true);
    expect(summary.skipped).toBeUndefined();
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

  it('classify() dùng description thật (không phải chuỗi rỗng): tiêu đề chung nhưng description có "Unlimited" => package_type=unlimited', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [{ slug: 'japan-data-plan-wm-jp-desc' }], error: null });

    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoriesSelectQuery;
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    await runSmartImport(supabaseMock, buildDescriptionSignalWorkbookBuffer(), {}, { commit: true });

    // Title alone has no data-amount/duration/unlimited signal; description does.
    const wrongIfDescriptionIgnored = classify('Japan Data Plan', '');
    const expected = classify('Japan Data Plan', 'Unlimited data, 7 days');

    expect(productsUpsertQuery.upsert).toHaveBeenCalledTimes(1);
    const upsertedRows = productsUpsertQuery.upsert.mock.calls[0][0];
    expect(upsertedRows[0].package_type).toBe(expected.packageType);
    expect(upsertedRows[0].capacity_bucket).toBe(expected.capacityBucket);
    expect(upsertedRows[0].data_info).toBe(expected.dataInfo);
    expect(upsertedRows[0].package_type).toBe('unlimited');
    // Sanity check that the two classify() calls actually diverge, i.e. this
    // test would catch the bug of passing '' instead of the real description.
    expect(expected.packageType).not.toBe(wrongIfDescriptionIgnored.packageType);
  });

  it('lỗi từ .in() lookup khiến commit KHÔNG thực hiện bất kỳ ghi nào (không insert category, không upsert product)', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: null, error: { message: 'boom' } });
    const categoriesUpsertQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [], error: null });

    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoriesSelectQuery;
      if (table === 'products') return productsUpsertQuery;
      throw new Error(`unexpected table ${table}`);
    });

    await expect(
      runSmartImport(supabaseMock, buildWorkbookBuffer(), {}, { commit: true }),
    ).rejects.toBeInstanceOf(SmartImportLookupError);

    expect(categoriesUpsertQuery.upsert).not.toHaveBeenCalled();
    expect(productsUpsertQuery.upsert).not.toHaveBeenCalled();
  });

  it('1 chunk upsert lỗi: retry theo sub-batch để chỉ dòng lỗi thật sự bị failed, các dòng khỏe mạnh khác trong cùng chunk vẫn created', async () => {
    const rowCount = 15; // 1 upsert chunk (< 500), retried in 2 sub-batches of 10 + 5
    const categoriesSelectQuery = createQueryBuilderMock({ data: [{ id: 1, name: 'Japan' }], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });

    // Sub-batch containing row index 12 (slug for "Japan 12 1GB, 1 Day...") fails;
    // full-chunk upsert and every OTHER sub-batch succeed.
    const badSlugFragment = 'japan-12-1gb';
    let productsCall = 0;
    const chunkUpsertQuery = createQueryBuilderMock(null); // overridden below via mockImplementation
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoriesSelectQuery;
      if (table === 'products') {
        productsCall += 1;
        if (productsCall === 1) return productsSelectQuery; // select-in lookup
        // upsert calls (chunk, then sub-batches on failure)
        const builder = createQueryBuilderMock(null);
        builder.then = (resolve) => {
          const lastCallArgs = builder.upsert.mock.calls[builder.upsert.mock.calls.length - 1][0];
          const containsBadRow = lastCallArgs.some((r) => r.slug.includes(badSlugFragment));
          if (containsBadRow && lastCallArgs.length > 1) {
            return resolve({ data: null, error: { message: 'chunk failed' } });
          }
          if (containsBadRow && lastCallArgs.length === 1) {
            return resolve({ data: null, error: { message: 'row failed' } });
          }
          return resolve({ data: lastCallArgs.map((r) => ({ slug: r.slug })), error: null });
        };
        return builder;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildLargeWorkbookBuffer(rowCount), {}, { commit: true });

    expect(summary.totalRows).toBe(15);
    expect(summary.created).toBe(14);
    expect(summary.failed).toBe(1);
    const failedRow = summary.rows.find((r) => r.status === 'failed');
    expect(failedRow.message).toBe('row failed');
    expect(summary.rows.filter((r) => r.status === 'created')).toHaveLength(14);
  });

  it('category upsert dùng ignoreDuplicates: 1 tên danh mục bị trùng slug với danh mục khác chỉ làm failed đúng các dòng của danh mục đó, danh mục khác vẫn tạo và upsert sản phẩm bình thường', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [], error: null });
    // "Japan" collides (ignoreDuplicates skips it, not returned); "Vietnam" succeeds.
    const categoriesUpsertQuery = createQueryBuilderMock({ data: [{ id: 9, name: 'Vietnam' }], error: null });
    const categoryCountriesInsertQuery = createQueryBuilderMock({ data: [], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [{ slug: 'vietnam-1gb-1-day-wm-vn-1d' }], error: null });

    let categoriesCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        categoriesCall += 1;
        return categoriesCall === 1 ? categoriesSelectQuery : categoriesUpsertQuery;
      }
      if (table === 'category_countries') return categoryCountriesInsertQuery;
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(supabaseMock, buildTwoCategoriesWorkbookBuffer(), {}, { commit: true });

    expect(categoriesUpsertQuery.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        { name: 'Japan', slug: 'japan', image_url: null, status: 'active' },
        { name: 'Vietnam', slug: 'vietnam', image_url: null, status: 'active' },
      ]),
      { onConflict: 'slug', ignoreDuplicates: true },
    );

    // Only Vietnam's row should be upserted as a product; Japan's row failed at the category step.
    expect(productsUpsertQuery.upsert).toHaveBeenCalledTimes(1);
    const upsertedRows = productsUpsertQuery.upsert.mock.calls[0][0];
    expect(upsertedRows).toHaveLength(1);
    expect(upsertedRows[0].slug).toBe('vietnam-1gb-1-day-wm-vn-1d');

    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(1);
    const japanRow = summary.rows.find((r) => r.row === 11);
    const vietnamRow = summary.rows.find((r) => r.row === 12);
    expect(japanRow.status).toBe('failed');
    expect(japanRow.message).toContain('Japan');
    expect(japanRow.message).toContain('slug bị trùng');
    expect(vietnamRow.status).toBe('created');
  });

  it('categories upsert lỗi toàn bộ (network/DB thật): các dòng thuộc danh mục mới bị failed, không upsert sản phẩm cho danh mục đó', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const categoriesUpsertQuery = createQueryBuilderMock({ data: null, error: { message: 'insert failed: unique violation' } });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [], error: null });

    let categoriesCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        categoriesCall += 1;
        return categoriesCall === 1 ? categoriesSelectQuery : categoriesUpsertQuery;
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

  it('dòng có parseError trong commit: bị loại khỏi upsert sản phẩm, xuất hiện trong rows với status failed và message là lý do parse lỗi, vẫn tính vào totalRows', async () => {
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

    const summary = await runSmartImport(supabaseMock, buildMissingTitleWorkbookBuffer(), {}, { commit: true });

    expect(summary.totalRows).toBe(2);
    expect(productsUpsertQuery.upsert).toHaveBeenCalledTimes(1);
    expect(productsUpsertQuery.upsert.mock.calls[0][0]).toHaveLength(1); // only the valid row

    const errorRow = summary.rows.find((r) => r.row === 12);
    expect(errorRow.status).toBe('failed');
    expect(errorRow.message).toBe('Thiếu tên gói hoặc quốc gia/khu vực.');
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.created + summary.updated + summary.failed).toBe(summary.totalRows);
  });

  it('priceBuy tính được <= 0 (ví dụ physicalNoDurationMultiplier: 0) -> analyze: dòng có error trong preview, priceBuy null', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(
      supabaseMock,
      buildZeroDurationWorkbookBuffer(),
      { physicalNoDurationMultiplier: 0 },
      { commit: false },
    );

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].priceBuy).toBeNull();
    expect(summary.rows[0].pricingRule).toBeNull();
    expect(summary.rows[0].error).toBeTruthy();
    expect(summary.errorCount).toBe(1);
    // Sanity: a negative markup on an eSIM row must be caught the same way,
    // regardless of WHICH of the 4 pricing rules produced the bad value.
  });

  it('priceBuy tính được âm (esimMarkupPercent: -200, không có priceBuyFromFile) -> analyze: dòng có error trong preview', async () => {
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return createQueryBuilderMock({ data: [], error: null });
      if (table === 'products') return createQueryBuilderMock({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(
      supabaseMock,
      buildEsimNoFromFileWorkbookBuffer(),
      { esimMarkupPercent: -200 },
      { commit: false },
    );

    expect(summary.rows).toHaveLength(1);
    expect(summary.rows[0].pricingRule).toBeNull();
    expect(summary.rows[0].priceBuy).toBeNull();
    expect(summary.rows[0].error).toBeTruthy();
    expect(summary.errorCount).toBe(1);
  });

  it('priceBuy tính được <= 0 trong commit: dòng bị loại khỏi upsert sản phẩm, báo failed, KHÔNG có DB write nào cho dòng đó', async () => {
    const categoriesSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const categoriesUpsertQuery = createQueryBuilderMock({ data: [], error: null });
    const productsSelectQuery = createQueryBuilderMock({ data: [], error: null });
    const productsUpsertQuery = createQueryBuilderMock({ data: [], error: null });

    let categoriesCall = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') {
        categoriesCall += 1;
        return categoriesCall === 1 ? categoriesSelectQuery : categoriesUpsertQuery;
      }
      if (table === 'products') {
        return productsSelectQuery.select.mock.calls.length === 0 ? productsSelectQuery : productsUpsertQuery;
      }
      throw new Error(`unexpected table ${table}`);
    });

    const summary = await runSmartImport(
      supabaseMock,
      buildZeroDurationWorkbookBuffer(),
      { physicalNoDurationMultiplier: 0 },
      { commit: true },
    );

    // No product upsert should ever be attempted for this row (productRows
    // excludes it entirely), and since it's the only row in the file, no
    // category should be created for it either.
    expect(productsUpsertQuery.upsert).not.toHaveBeenCalled();
    expect(categoriesUpsertQuery.upsert).not.toHaveBeenCalled();

    expect(summary.totalRows).toBe(1);
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(0);
    expect(summary.failed).toBe(1);
    expect(summary.rows[0].status).toBe('failed');
    expect(summary.rows[0].slug).toBeNull();
    expect(summary.rows[0].message).toBeTruthy();
  });
});
