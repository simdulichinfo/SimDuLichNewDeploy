'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '../../../lib/supabase/client';
import { inputClass, translateAuthError } from '../authUI';

export default function LoginPage() {
  const router = useRouter();
  const [showPwd, setShowPwd] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(translateAuthError(signInError.message));
      return;
    }
    router.push('/account');
    router.refresh();
  };

  return (
    <div className="py-6 md:py-8">
      <div className="container mx-auto px-4">
        <div className="mx-auto w-full max-w-[520px] rounded-[28px] border border-[#F5EFFB] bg-white p-7 shadow-sm sm:p-9">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-slate-900">Đăng nhập</h1>
            <p className="mt-1.5 text-[15px] text-slate-400">Đăng nhập vào tài khoản của bạn</p>
          </div>

          {error && (
            <div className="mt-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <form className={`space-y-4 ${error ? 'mt-4' : 'mt-6'}`} onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-[15px] font-semibold text-slate-800">Email</label>
              <input
                type="email"
                placeholder="Email"
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-[15px] font-semibold text-slate-800">Mật khẩu</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  placeholder="Mật khẩu"
                  className={`${inputClass} pr-12`}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((s) => !s)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPwd ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="h-[52px] w-full rounded-full bg-brand-gradient text-[15px] font-bold text-white shadow-md shadow-secondary/20 transition-all hover:opacity-95 disabled:opacity-60"
            >
              {submitting ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500">
            Chưa có tài khoản?{' '}
            <Link href="/register" className="font-semibold text-primary hover:underline">
              Đăng ký ngay
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
