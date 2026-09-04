export const inputClass =
  'w-full h-[52px] rounded-full border border-transparent bg-[#F2F6FC] px-5 text-[15px] text-slate-800 ' +
  'placeholder-slate-400 outline-none transition-all focus:border-primary/40 focus:bg-white focus:ring-2 focus:ring-primary/20';

const AUTH_ERROR_MESSAGES = {
  'Invalid login credentials': 'Email hoặc mật khẩu không đúng.',
  'User already registered': 'Email này đã được đăng ký.',
  'Password should be at least 6 characters': 'Mật khẩu tối thiểu 6 ký tự.',
};

export function translateAuthError(message) {
  return AUTH_ERROR_MESSAGES[message] || message;
}
