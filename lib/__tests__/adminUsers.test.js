import { describe, it, expect, vi, beforeEach } from 'vitest';

function createQueryBuilderMock(result) {
  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (resolve) => resolve(result),
  };
  return builder;
}

const fromMock = vi.fn();
const supabaseMock = { from: fromMock };

import { toggleUserStatus, AdminUsersError } from '../adminUsers';

describe('toggleUserStatus', () => {
  beforeEach(() => {
    fromMock.mockReset();
  });

  it('ném AdminUsersError 400 khi tự khoá chính mình, không gọi DB', async () => {
    await expect(toggleUserStatus(supabaseMock, { targetId: 'u1', actingUserId: 'u1' }))
      .rejects.toMatchObject({ status: 400 });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it('trả null khi không tìm thấy user', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: null }));

    const result = await toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' });

    expect(result).toBeNull();
  });

  it('ném AdminUsersError 500 khi tra user lỗi hạ tầng', async () => {
    fromMock.mockReturnValue(createQueryBuilderMock({ data: null, error: { message: 'boom' } }));

    await expect(toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('lật active -> banned', async () => {
    const lookupQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'active' },
      error: null,
    });
    const updateQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' },
      error: null,
    });
    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? lookupQuery : updateQuery;
    });

    const result = await toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' });

    expect(updateQuery.update).toHaveBeenCalledWith({ status: 'banned' });
    expect(result).toEqual({ id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' });
  });

  it('lật banned -> active', async () => {
    const lookupQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'banned' },
      error: null,
    });
    const updateQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'active' },
      error: null,
    });
    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? lookupQuery : updateQuery;
    });

    const result = await toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' });

    expect(updateQuery.update).toHaveBeenCalledWith({ status: 'active' });
    expect(result.status).toBe('active');
  });

  it('ném AdminUsersError 500 khi update lỗi', async () => {
    const lookupQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'active' },
      error: null,
    });
    const updateQuery = createQueryBuilderMock({ data: null, error: { message: 'boom' } });
    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? lookupQuery : updateQuery;
    });

    await expect(toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('ném AdminUsersError 500 (không phải TypeError) khi update trả về null mà không có lỗi', async () => {
    const lookupQuery = createQueryBuilderMock({
      data: { id: 'u2', name: 'A', email: 'a@x.vn', phone: '0900000000', role: 'customer', status: 'active' },
      error: null,
    });
    const updateQuery = createQueryBuilderMock({ data: null, error: null });
    let callCount = 0;
    fromMock.mockImplementation(() => {
      callCount += 1;
      return callCount === 1 ? lookupQuery : updateQuery;
    });

    let caughtError;
    try {
      await toggleUserStatus(supabaseMock, { targetId: 'u2', actingUserId: 'admin1' });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(AdminUsersError);
    expect(caughtError).toMatchObject({ status: 500 });
  });
});
