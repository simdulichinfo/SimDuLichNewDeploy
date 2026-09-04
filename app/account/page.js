import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

export default async function AccountPage() {
  const supabase = await createClient();

  if (!supabase) {
    redirect('/login');
  }

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role, status')
    .eq('id', user.id)
    .single();

  return (
    <div className="container mx-auto px-4 max-w-[720px] py-10">
      <h1 className="text-2xl font-extrabold text-slate-900">Tài khoản của bạn</h1>
      <dl className="mt-6 space-y-3 text-sm">
        <div>
          <dt className="text-slate-400">Email</dt>
          <dd className="font-semibold">{user.email}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Họ tên</dt>
          <dd className="font-semibold">{profile?.name}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Vai trò</dt>
          <dd className="font-semibold">{profile?.role}</dd>
        </div>
        <div>
          <dt className="text-slate-400">Trạng thái</dt>
          <dd className="font-semibold">{profile?.status}</dd>
        </div>
      </dl>
    </div>
  );
}
