import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

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
