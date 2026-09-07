import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const rpcMock = vi.fn();
const supabaseMock = { from: fromMock, rpc: rpcMock };

vi.mock('../supabase/apiClient', () => ({
  createApiClient: vi.fn(() => supabaseMock),
}));

import {
  listCategories,
  listProductsByCountry,
  listProductsByCategory,
  listAllProducts,
  getProductBySlug,
  getProductById,
  getMinPriceByCountry,
  searchProducts,
} from '../catalog';

const sampleProductRow = {
  id: 10, category_id: 1, title: 'eSIM Nhật Bản', slug: 'esim-nb', sim_type: 'esim',
  price_buy: 89000, data_info: '1GB/ngày', duration_days: 3, package_type: 'daily',
  capacity_bucket: '1gb', status: 'active',
};
const sampleProductMapped = {
  id: 10, categoryId: 1, title: 'eSIM Nhật Bản', slug: 'esim-nb', simType: 'esim',
  priceBuy: 89000, dataInfo: '1GB/ngày', durationDays: 3, packageType: 'daily',
  capacityBucket: '1gb', status: 'active',
};

describe('lib/catalog', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  describe('listCategories', () => {
    it('map dữ liệu category_countries lồng nhau thành coveredCountries', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({
        data: [
          { id: 1, name: 'Nhật Bản', slug: 'nhat-ban', image_url: null, status: 'active', category_countries: [{ country_code: 'jp' }] },
        ],
        error: null,
      }));

      const result = await listCategories();

      expect(fromMock).toHaveBeenCalledWith('categories');
      expect(result).toEqual([
        { id: 1, name: 'Nhật Bản', slug: 'nhat-ban', imageUrl: null, status: 'active', coveredCountries: ['jp'] },
      ]);
    });
  });

  describe('listProductsByCountry', () => {
    it('tra category_countries trước, rồi lọc products_public theo category_id', async () => {
      const countryQuery = createQueryBuilderMock({ data: [{ category_id: 1 }, { category_id: 2 }], error: null });
      const productsQuery = createQueryBuilderMock({ data: [sampleProductRow], error: null });
      fromMock.mockImplementation((table) => (table === 'category_countries' ? countryQuery : productsQuery));

      const result = await listProductsByCountry('jp');

      expect(countryQuery.in).toHaveBeenCalledWith('country_code', ['jp']);
      expect(productsQuery.in).toHaveBeenCalledWith('category_id', [1, 2]);
      expect(result).toEqual([sampleProductMapped]);
    });

    it('trả mảng rỗng nếu không quốc gia nào khớp category nào', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

      const result = await listProductsByCountry('zz');

      expect(result).toEqual([]);
    });
  });

  describe('listProductsByCategory', () => {
    it('tra category theo slug trước, rồi lọc products_public theo category_id', async () => {
      const categoryQuery = createQueryBuilderMock({ data: [{ id: 5 }], error: null });
      const productsQuery = createQueryBuilderMock({ data: [], error: null });
      fromMock.mockImplementation((table) => (table === 'categories' ? categoryQuery : productsQuery));

      await listProductsByCategory('singapore');

      expect(categoryQuery.eq).toHaveBeenCalledWith('slug', 'singapore');
      expect(productsQuery.eq).toHaveBeenCalledWith('category_id', 5);
    });

    it('trả mảng rỗng nếu không tìm thấy category theo slug', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [], error: null }));

      const result = await listProductsByCategory('khong-ton-tai');

      expect(result).toEqual([]);
    });
  });

  describe('listAllProducts', () => {
    it('trả toàn bộ sản phẩm active, không lọc theo category', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: [sampleProductRow], error: null }));

      const result = await listAllProducts();

      expect(fromMock).toHaveBeenCalledWith('products_public');
      expect(result).toEqual([sampleProductMapped]);
    });
  });

  describe('getProductBySlug', () => {
    it('trả sản phẩm khi tìm thấy slug', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: sampleProductRow, error: null }));

      const result = await getProductBySlug('esim-nb');

      expect(result).toEqual(sampleProductMapped);
    });

    it('trả null khi không tìm thấy slug', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getProductBySlug('khong-ton-tai');

      expect(result).toBeNull();
    });
  });

  describe('getProductById', () => {
    it('trả sản phẩm khi tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: sampleProductRow, error: null }));

      const result = await getProductById(10);

      expect(result).toEqual(sampleProductMapped);
    });

    it('trả null khi không tìm thấy id', async () => {
      fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

      const result = await getProductById(999);

      expect(result).toBeNull();
    });
  });

  describe('searchProducts', () => {
    it('áp bộ lọc mặc định: sim_type=esim, giá tối đa 1.000.000, phân trang 12/trang từ trang 1', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({});

      expect(query.eq).toHaveBeenCalledWith('sim_type', 'esim');
      expect(query.lte).toHaveBeenCalledWith('price_buy', 1000000);
      expect(query.range).toHaveBeenCalledWith(0, 11);
      expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
    });

    it('sortBy=price-asc sắp xếp tăng dần theo giá', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({ sortBy: 'price-asc' });

      expect(query.order).toHaveBeenCalledWith('price_buy', { ascending: true });
    });

    it('sortBy=price-desc sắp xếp giảm dần theo giá', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({ sortBy: 'price-desc' });

      expect(query.order).toHaveBeenCalledWith('price_buy', { ascending: false });
    });

    it('lọc types/capacities bằng .in() đúng cột', async () => {
      const query = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockReturnValue(query);

      await searchProducts({ types: ['daily', 'unlimited'], capacities: ['1gb'] });

      expect(query.in).toHaveBeenCalledWith('package_type', ['daily', 'unlimited']);
      expect(query.in).toHaveBeenCalledWith('capacity_bucket', ['1gb']);
    });

    it('tính totalPages từ totalElements và size', async () => {
      const query = createQueryBuilderMock({ data: [], count: 25, error: null });
      fromMock.mockReturnValue(query);

      const result = await searchProducts({ size: 12 });

      expect(result.totalElements).toBe(25);
      expect(result.totalPages).toBe(3);
    });

    it('countryCodes không khớp category nào trả về ngay kết quả rỗng, không query products', async () => {
      const countryQuery = createQueryBuilderMock({ data: [], error: null });
      fromMock.mockReturnValue(countryQuery);

      const result = await searchProducts({ countryCodes: ['zz'] });

      expect(result).toEqual({ content: [], page: 1, size: 12, totalElements: 0, totalPages: 0 });
    });

    it('search không chứa ký tự đặc biệt: giữ nguyên dạng ilike.%...% không quote (hành vi cũ)', async () => {
      const categoriesQuery = createQueryBuilderMock({ data: [], error: null });
      const productsQuery = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockImplementation((table) => (table === 'categories' ? categoriesQuery : productsQuery));

      await searchProducts({ search: 'esim' });

      expect(productsQuery.or).toHaveBeenCalledWith('title.ilike.%esim%');
    });

    it('search chứa dấu phẩy: phải escape/quote để không phá cấu trúc filter .or()', async () => {
      const categoriesQuery = createQueryBuilderMock({ data: [], error: null });
      const productsQuery = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockImplementation((table) => (table === 'categories' ? categoriesQuery : productsQuery));

      await searchProducts({ search: 'Japan, Korea' });

      // Dấu phẩy trong search KHÔNG được phép trở thành delimiter phân tách
      // term trong .or(); giá trị phải được bọc trong dấu ngoặc kép theo quy
      // ước của PostgREST.
      expect(productsQuery.or).toHaveBeenCalledWith('title.ilike."%Japan, Korea%"');
    });

    it('search chứa dấu ngoặc đơn: phải escape/quote để không phá cú pháp in.() của .or()', async () => {
      const categoriesQuery = createQueryBuilderMock({ data: [], error: null });
      const productsQuery = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockImplementation((table) => (table === 'categories' ? categoriesQuery : productsQuery));

      await searchProducts({ search: 'eSIM (test)' });

      expect(productsQuery.or).toHaveBeenCalledWith('title.ilike."%eSIM (test)%"');
    });

    it('search chứa dấu phẩy vẫn kết hợp đúng với điều kiện category_id.in() khi có category khớp tên', async () => {
      const categoriesQuery = createQueryBuilderMock({ data: [{ id: 7 }], error: null });
      const productsQuery = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockImplementation((table) => (table === 'categories' ? categoriesQuery : productsQuery));

      await searchProducts({ search: 'Japan, Korea' });

      expect(productsQuery.or).toHaveBeenCalledWith('title.ilike."%Japan, Korea%",category_id.in.(7)');
    });

    it('search chứa dấu % của người dùng: không escape/nhân đôi ký tự % do search mang vào', async () => {
      const categoriesQuery = createQueryBuilderMock({ data: [], error: null });
      const productsQuery = createQueryBuilderMock({ data: [], count: 0, error: null });
      fromMock.mockImplementation((table) => (table === 'categories' ? categoriesQuery : productsQuery));

      await searchProducts({ search: '50% off' });

      expect(productsQuery.or).toHaveBeenCalledWith('title.ilike.%50% off%');
    });
  });

  describe('getMinPriceByCountry', () => {
    it('gọi RPC min_price_by_country và map thành object { [code]: giá }', async () => {
      rpcMock.mockResolvedValue({ data: [{ country_code: 'jp', min_price: 89000 }, { country_code: 'kr', min_price: 129000 }], error: null });

      const result = await getMinPriceByCountry();

      expect(rpcMock).toHaveBeenCalledWith('min_price_by_country');
      expect(result).toEqual({ jp: 89000, kr: 129000 });
    });
  });
});
