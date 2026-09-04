'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '../../../lib/supabase/client';
import { inputClass } from '../authUI';

function FieldLabel({ children, required }) {
  return (
    <label className="mb-2 block text-[15px] font-semibold text-slate-800">
      {children}
      {required && <span className="text-red-500"> *</span>}
    </label>
  );
}

function PasswordField({ placeholder, value, onChange }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        className={`${inputClass} pr-12`}
        value={value}
        onChange={onChange}
        required
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
        aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
      >
        {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
      </button>
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updateField = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 6) {
      setError('Mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }
    if (!agreed) {
      setError('Bạn cần đồng ý với Điều khoản dịch vụ để tiếp tục.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { name: form.name, phone: form.phone } },
    });
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
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
            <h1 className="text-3xl font-bold text-slate-900">Đăng ký tài khoản</h1>
            <p className="mt-1.5 text-[15px] text-slate-400">Tạo tài khoản mới để bắt đầu</p>
          </div>

          <div className="mt-6">
            {error && (
              <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <FieldLabel required>Họ tên</FieldLabel>
                <input type="text" placeholder="Họ tên" className={inputClass} value={form.name} onChange={updateField('name')} required />
              </div>
              <div>
                <FieldLabel required>Email</FieldLabel>
                <input type="email" placeholder="Email" className={inputClass} value={form.email} onChange={updateField('email')} required />
              </div>
              <div>
                <FieldLabel>Số điện thoại</FieldLabel>
                <input type="tel" placeholder="Số điện thoại" className={inputClass} value={form.phone} onChange={updateField('phone')} />
              </div>
              <div>
                <FieldLabel required>Mật khẩu</FieldLabel>
                <PasswordField placeholder="Mật khẩu" value={form.password} onChange={updateField('password')} />
              </div>
              <div>
                <FieldLabel required>Xác nhận mật khẩu</FieldLabel>
                <PasswordField placeholder="Xác nhận mật khẩu" value={form.confirmPassword} onChange={updateField('confirmPassword')} />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 accent-primary"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                Tôi đồng ý với{' '}
                <a href="#terms" className="font-medium text-primary hover:underline">Điều khoản dịch vụ</a>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="h-[52px] w-full rounded-full bg-brand-gradient text-[15px] font-bold text-white shadow-md shadow-secondary/20 transition-all hover:opacity-95 disabled:opacity-60"
              >
                {submitting ? 'Đang đăng ký...' : 'Đăng ký'}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-slate-500">
              Đã có tài khoản?{' '}
              <Link href="/login" className="font-semibold text-primary hover:underline">
                Đăng nhập
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
