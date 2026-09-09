import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as XLSX from 'xlsx';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { parseImportRows, computePriceBuyFromRow, runProductImport } from '../productImport';

function buildCsvBuffer(rows) {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
}

describe('parseImportRows', () => {
  it('đọc đúng field theo tên header trong file', () => {
    const buffer = buildCsvBuffer([
      { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active' },
    ]);

    const rows = parseImportRows(buffer);

    expect(rows).toEqual([
      { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active' },
    ]);
  });
});

describe('computePriceBuyFromRow', () => {
  it('dùng thẳng priceBuy trong file khi có, bất kể pricingMode', () => {
    expect(computePriceBuyFromRow({ priceBuy: 99000, priceImport: 50000 }, 'markupPercent', { markupPercent: 30 })).toBe(99000);
  });

  it('manual mode thiếu priceBuy -> trả null', () => {
    expect(computePriceBuyFromRow({ priceImport: 50000 }, 'manual', {})).toBeNull();
  });

  it('markupPercent mode tính đúng công thức', () => {
    expect(computePriceBuyFromRow({ priceImport: 100000 }, 'markupPercent', { markupPercent: 30 })).toBe(130000);
  });

  it('daysPlusFee mode tính đúng công thức', () => {
    expect(computePriceBuyFromRow({ priceImport: 100000, durationDays: 5 }, 'daysPlusFee', { fixedFee: 14000 })).toBe(514000);
  });
});

describe('runProductImport', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('tạo mới sản phẩm khi categorySlug tồn tại và slug sản phẩm chưa có', async () => {
    const categoryQuery = createQueryBuilderMock({ data: { id: 5 }, error: null });
    const existingProductQuery = createQueryBuilderMock({ data: null, error: null });
    const insertQuery = createQueryBuilderMock({ data: { id: 1 }, error: null });
    let productCallCount = 0;
    fromMock.mockImplementation((table) => {
      if (table === 'categories') return categoryQuery;
      productCallCount += 1;
      return productCallCount === 1 ? existingProductQuery : insertQuery;
    });

    const buffer = (function build() {
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([
        { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active', priceBuy: 65000 },
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
    })();

    const summary = await runProductImport(supabaseMock, buffer, { pricingMode: 'manual' });

    expect(summary.totalRows).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.rows[0]).toEqual({ row: 2, slug: 'a', status: 'created', message: null });
  });

  it('đánh dấu failed khi categorySlug không tồn tại', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    const buffer = (function build() {
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([
        { categorySlug: 'khong-ton-tai', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active', priceBuy: 65000 },
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
    })();

    const summary = await runProductImport(supabaseMock, buffer, { pricingMode: 'manual' });

    expect(summary.failed).toBe(1);
    expect(summary.rows[0].status).toBe('failed');
    expect(summary.rows[0].message).toBe('Không tìm thấy danh mục với slug "khong-ton-tai".');
  });

  it('đánh dấu failed khi manual mode thiếu priceBuy', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: { id: 5 }, error: null }));

    const buffer = (function build() {
      const wb = XLSX.utils.book_new();
      const sheet = XLSX.utils.json_to_sheet([
        { categorySlug: 'nhat-ban', title: 'A', slug: 'a', simType: 'esim', priceImport: 50000, dataInfo: '1GB', durationDays: 3, status: 'active' },
      ]);
      XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'csv' });
    })();

    const summary = await runProductImport(supabaseMock, buffer, { pricingMode: 'manual' });

    expect(summary.failed).toBe(1);
    expect(summary.rows[0].message).toBe('Thiếu giá bán (priceBuy) — chế độ manual yêu cầu cột này trong file.');
  });
});
