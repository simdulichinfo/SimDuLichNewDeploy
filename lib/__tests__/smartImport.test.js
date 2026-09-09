import { describe, it, expect } from 'vitest';
import {
  slugify, classify, resolveCountries, buildApnCountryGroups, computeRowPricing,
  parseSmartImportWorkbook, DIRECT_REGION_TO_ISO, NO_COUNTRY_MAPPING, VN_TO_ISO,
} from '../smartImport';
import * as XLSX from 'xlsx';

describe('slugify', () => {
  it('chuyển chữ hoa, khoảng trắng, ký tự đặc biệt thành dạng slug', () => {
    expect(slugify('Asia Multi-region A, 3 Days')).toBe('asia-multi-region-a-3-days');
  });

  it('gộp nhiều dấu gạch ngang liên tiếp và bỏ dấu gạch ở đầu/cuối', () => {
    expect(slugify('  --Nhật Bản!!--  ')).toBe('nh-t-b-n');
  });
});

describe('classify', () => {
  it('nhận diện gói unlimited', () => {
    expect(classify('Unlimited Data 5 Days', '')).toEqual({
      packageType: 'unlimited', capacityBucket: 'unlimited', dataInfo: 'Không giới hạn',
    });
  });

  it('nhận diện gói theo ngày (daily) và bucket 1gb', () => {
    expect(classify('Japan 1GB/day, 3 Days', '')).toEqual({
      packageType: 'daily', capacityBucket: '1gb', dataInfo: '1GB/ngày',
    });
  });

  it('nhận diện gói cố định (fixed) và bucket 2gb', () => {
    expect(classify('Asia 2GB, 5 Days', '')).toEqual({
      packageType: 'fixed', capacityBucket: '2gb', dataInfo: '2GB',
    });
  });

  it('bucket other-fixed khi dung lượng không khớp 1/2GB', () => {
    expect(classify('Asia 10GB, 5 Days', '')).toEqual({
      packageType: 'fixed', capacityBucket: 'other-fixed', dataInfo: '10GB',
    });
  });

  it('dataInfo trả về nguyên title khi không tìm được dung lượng', () => {
    expect(classify('Flat rate package', '')).toEqual({
      packageType: 'fixed', capacityBucket: 'other-fixed', dataInfo: 'Flat rate package',
    });
  });
});

describe('resolveCountries', () => {
  it('trả về mảng cố định khi region có trong DIRECT_REGION_TO_ISO', () => {
    expect(resolveCountries('Japan', {}, {})).toEqual(['jp']);
    expect(DIRECT_REGION_TO_ISO.Japan).toEqual(['jp']);
  });

  it('trả về [] khi region thuộc NO_COUNTRY_MAPPING', () => {
    expect(resolveCountries('Worldwide', {}, {})).toEqual([]);
    expect(NO_COUNTRY_MAPPING.has('Worldwide')).toBe(true);
  });

  it('tra cứu qua apn group khi không khớp 2 bảng tĩnh trên', () => {
    const apnEsim = { 'asia multi region a': ['sg', 'my'] };
    expect(resolveCountries('Asia Multi-region A', apnEsim, {})).toEqual(['sg', 'my']);
  });

  it('trả về null khi không resolve được ở đâu cả', () => {
    expect(resolveCountries('Vùng lạ chưa từng gặp', {}, {})).toBeNull();
  });
});

describe('buildApnCountryGroups', () => {
  it('gom các dòng quốc gia con vào đúng group header phía trên', () => {
    const rows2D = Array.from({ length: 16 }, () => [null, null]);
    rows2D[14] = ['Asia Multi-region A', 'Nhật Bản'];
    rows2D[15] = [null, 'Hàn Quốc'];
    const groups = buildApnCountryGroups(rows2D);
    expect(groups['asia multi region a']).toEqual(['jp', 'kr']);
  });

  it('bỏ qua tên quốc gia không có trong VN_TO_ISO', () => {
    const rows2D = Array.from({ length: 16 }, () => [null, null]);
    rows2D[14] = ['Nhóm test', 'Quốc gia không tồn tại'];
    const groups = buildApnCountryGroups(rows2D);
    expect(groups['nh-m-test'] ?? groups['nhom test']).toBeUndefined();
    expect(Object.keys(groups)).toContain('nhóm test'.normalize());
  });
});

describe('computeRowPricing', () => {
  it('dùng thẳng giá từ file khi có priceBuyFromFile', () => {
    const result = computeRowPricing(
      { simType: 'esim', durationDays: 3, priceImport: 100000, priceBuyFromFile: 130000 },
      {},
    );
    expect(result).toEqual({ priceBuy: 130000, pricingRule: 'fromFile', warning: null });
  });

  it('esim thiếu giá file -> tính markupPercent', () => {
    const result = computeRowPricing(
      { simType: 'esim', durationDays: 3, priceImport: 100000, priceBuyFromFile: null },
      { esimMarkupPercent: 30 },
    );
    expect(result).toEqual({ priceBuy: 130000, pricingRule: 'markupPercent', warning: null });
  });

  it('physical có durationDays, thiếu giá file -> tính daysPlusFee', () => {
    const result = computeRowPricing(
      { simType: 'physical', durationDays: 5, priceImport: 100000, priceBuyFromFile: null },
      { physicalFixedFee: 14000 },
    );
    expect(result).toEqual({ priceBuy: 514000, pricingRule: 'daysPlusFee', warning: null });
  });

  it('physical không có durationDays, thiếu giá file -> tính noDurationMultiplier kèm warning', () => {
    const result = computeRowPricing(
      { simType: 'physical', durationDays: null, priceImport: 100000, priceBuyFromFile: null },
      { physicalNoDurationMultiplier: 2 },
    );
    expect(result).toEqual({
      priceBuy: 200000,
      pricingRule: 'noDurationMultiplier',
      warning: 'Không tìm thấy số ngày trong tên gói — áp dụng giá bán = giá nhập × 2.',
    });
  });

  it('priceBuyFromFile = 0 -> coi như không có giá từ file, rơi xuống công thức markupPercent (esim)', () => {
    const result = computeRowPricing(
      { simType: 'esim', durationDays: 3, priceImport: 100000, priceBuyFromFile: 0 },
      { esimMarkupPercent: 30 },
    );
    expect(result).toEqual({ priceBuy: 130000, pricingRule: 'markupPercent', warning: null });
  });

  it('priceBuyFromFile âm -> coi như không có giá từ file, rơi xuống công thức daysPlusFee (physical)', () => {
    const result = computeRowPricing(
      { simType: 'physical', durationDays: 5, priceImport: 100000, priceBuyFromFile: -1 },
      { physicalFixedFee: 14000 },
    );
    expect(result).toEqual({ priceBuy: 514000, pricingRule: 'daysPlusFee', warning: null });
  });
});

describe('parseSmartImportWorkbook', () => {
  it('đọc đúng dòng dữ liệu từ 2 sheet giá, bỏ qua sheet apn khi build rows', () => {
    const wb = XLSX.utils.book_new();

    const esimSheetData = Array.from({ length: 11 }, () => [null]);
    esimSheetData[10] = [1, 'WM-JP-1D', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 50000, 65000, ''];
    const esimSheet = XLSX.utils.aoa_to_sheet(esimSheetData);
    XLSX.utils.book_append_sheet(wb, esimSheet, 'eSIM prices new');

    const physicalSheetData = Array.from({ length: 11 }, () => [null]);
    physicalSheetData[10] = [1, 'WM-VN-P', 'Vietnam physical 5GB', 'Vietnam', '', null, null, 'physical', 80000, null, ''];
    const physicalSheet = XLSX.utils.aoa_to_sheet(physicalSheetData);
    XLSX.utils.book_append_sheet(wb, physicalSheet, 'Sim vật lý new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows, regionResolutions } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      sheet: 'eSIM prices new', row: 11, code: 'WM-JP-1D', rawTitle: 'Japan 1GB, 1 Day',
      region: 'Japan', description: '', durationDays: 1, priceImport: 50000,
      priceBuyFromFile: 65000, simType: 'esim',
    });
    expect(rows[1]).toEqual({
      sheet: 'Sim vật lý new', row: 11, code: 'WM-VN-P', rawTitle: 'Vietnam physical 5GB',
      region: 'Vietnam', description: '', durationDays: null, priceImport: 80000,
      priceBuyFromFile: null, simType: 'physical',
    });
    expect(regionResolutions.get('Japan')).toEqual(['jp']);
    expect(regionResolutions.get('Vietnam')).toEqual(['vn']);
  });

  it('dòng thiếu tên gói hoặc khu vực -> vẫn xuất hiện trong rows kèm parseError, không bị bỏ qua âm thầm', () => {
    const wb = XLSX.utils.book_new();

    const esimSheetData = Array.from({ length: 11 }, () => [null]);
    // Missing rawTitle (column index 2).
    esimSheetData[10] = [1, 'WM-NOTITLE', null, 'Japan', '', 1, null, 'esim', 50000, 65000, ''];
    // Missing region (column index 3).
    esimSheetData.push([2, 'WM-NOREGION', 'Some package', null, '', 1, null, 'esim', 50000, 65000, '']);
    const esimSheet = XLSX.utils.aoa_to_sheet(esimSheetData);
    XLSX.utils.book_append_sheet(wb, esimSheet, 'eSIM prices new');

    const physicalSheetData = Array.from({ length: 11 }, () => [null]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0].parseError).toBe('Thiếu tên gói hoặc quốc gia/khu vực.');
    expect(rows[0].row).toBe(11);
    expect(rows[1].parseError).toBe('Thiếu tên gói hoặc quốc gia/khu vực.');
    expect(rows[1].row).toBe(12);
  });

  it('dòng thiếu giá nhập -> vẫn xuất hiện trong rows kèm parseError, không bị bỏ qua âm thầm', () => {
    const wb = XLSX.utils.book_new();

    const esimSheetData = Array.from({ length: 11 }, () => [null]);
    // Missing priceImport (column index 8).
    esimSheetData[10] = [1, 'WM-NOPRICE', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', null, 65000, ''];
    const esimSheet = XLSX.utils.aoa_to_sheet(esimSheetData);
    XLSX.utils.book_append_sheet(wb, esimSheet, 'eSIM prices new');

    const physicalSheetData = Array.from({ length: 11 }, () => [null]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0].parseError).toBe('Thiếu giá nhập.');
    expect(rows[0].row).toBe(11);
    expect(rows[0].rawTitle).toBe('Japan 1GB, 1 Day');
    expect(rows[0].region).toBe('Japan');
  });

  it('dòng có priceImport = 0 -> bị loại khỏi rows hợp lệ, xuất hiện với parseError (không lọt xuống tính giá 0)', () => {
    const wb = XLSX.utils.book_new();

    const esimSheetData = Array.from({ length: 11 }, () => [null]);
    esimSheetData[10] = [1, 'WM-ZEROPRICE', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 0, null, ''];
    const esimSheet = XLSX.utils.aoa_to_sheet(esimSheetData);
    XLSX.utils.book_append_sheet(wb, esimSheet, 'eSIM prices new');

    const physicalSheetData = Array.from({ length: 11 }, () => [null]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0].parseError).toBe('Thiếu giá nhập.');
    expect(rows[0].rawTitle).toBe('Japan 1GB, 1 Day');
    expect(rows[0].row).toBe(11);
  });

  it('dòng có priceImport không phải số (ví dụ ô ghi "N/A") -> bị loại khỏi rows hợp lệ, xuất hiện với parseError', () => {
    const wb = XLSX.utils.book_new();

    const esimSheetData = Array.from({ length: 11 }, () => [null]);
    esimSheetData[10] = [1, 'WM-BADPRICE', 'Japan 1GB, 1 Day', 'Japan', '', 1, null, 'esim', 'N/A', null, ''];
    const esimSheet = XLSX.utils.aoa_to_sheet(esimSheetData);
    XLSX.utils.book_append_sheet(wb, esimSheet, 'eSIM prices new');

    const physicalSheetData = Array.from({ length: 11 }, () => [null]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(physicalSheetData), 'Sim vật lý new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0].parseError).toBe('Thiếu giá nhập.');
  });

  it('durationDays = 0 trong cell -> được chuẩn hóa về null, không giữ nguyên 0', () => {
    const wb = XLSX.utils.book_new();

    const physicalSheetData = Array.from({ length: 11 }, () => [null]);
    physicalSheetData[10] = [1, 'WM-VN-P0', 'Vietnam physical 5GB', 'Vietnam', '', 0, null, 'physical', 80000, null, ''];
    const physicalSheet = XLSX.utils.aoa_to_sheet(physicalSheetData);
    XLSX.utils.book_append_sheet(wb, physicalSheet, 'Sim vật lý new');

    const esimSheetData = Array.from({ length: 11 }, () => [null]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0].durationDays).toBeNull();
    expect(rows[0].parseError).toBeUndefined();
  });

  it('dòng không có duration parse được (không phải lỗi) vẫn được giữ lại với durationDays: null, không có parseError', () => {
    const wb = XLSX.utils.book_new();

    const physicalSheetData = Array.from({ length: 11 }, () => [null]);
    physicalSheetData[10] = [1, 'WM-VN-P', 'Vietnam physical 5GB', 'Vietnam', '', null, null, 'physical', 80000, null, ''];
    const physicalSheet = XLSX.utils.aoa_to_sheet(physicalSheetData);
    XLSX.utils.book_append_sheet(wb, physicalSheet, 'Sim vật lý new');

    const esimSheetData = Array.from({ length: 11 }, () => [null]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esimSheetData), 'eSIM prices new');

    const apnSheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 15 }, () => []));
    XLSX.utils.book_append_sheet(wb, apnSheet, 'eSIM apn');
    XLSX.utils.book_append_sheet(wb, apnSheet, 'SIM apn');

    const buffer = XLSX.write(wb, { type: 'buffer' });
    const { rows } = parseSmartImportWorkbook(buffer);

    expect(rows).toHaveLength(1);
    expect(rows[0].durationDays).toBeNull();
    expect(rows[0].parseError).toBeUndefined();
  });
});
