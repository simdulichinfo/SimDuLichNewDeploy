import { mapUserResponse } from './apiAuth';

export class AdminUsersError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const PROFILE_COLUMNS = 'id, name, phone, email, role, status';

export async function toggleUserStatus(supabase, { targetId, actingUserId }) {
  if (targetId === actingUserId) {
    throw new AdminUsersError('Không thể tự khoá tài khoản của chính mình.', 400);
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', targetId)
    .maybeSingle();
  if (error) {
    console.error('[adminUsers] user lookup failed', error);
    throw new AdminUsersError('Không tải được người dùng.', 500);
  }
  if (!profile) {
    return null;
  }

  const nextStatus = profile.status === 'active' ? 'banned' : 'active';
  const { data: updated, error: updateError } = await supabase
    .from('profiles')
    .update({ status: nextStatus })
    .eq('id', targetId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (updateError) {
    console.error('[adminUsers] status update failed', updateError);
    throw new AdminUsersError('Không cập nhật được trạng thái người dùng.', 500);
  }

  return mapUserResponse(updated);
}
