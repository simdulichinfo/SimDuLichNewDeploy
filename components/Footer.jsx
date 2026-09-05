import Link from 'next/link';
import { Mail, Phone, MapPin } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-[#1C0D24] text-purple-100/90 pt-16 pb-8 border-t border-[#2A1436] rounded-t-[40px] relative z-20">
      <div className="container mx-auto px-6 max-w-[1232px]">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10">
          <div className="flex flex-col gap-4 text-left">
            <img
              src="/logo.svg"
              alt="SIMDULICH.VN Logo"
              className="h-10 w-auto object-contain max-w-[163px] self-start invert brightness-0"
            />
            <p className="text-sm leading-relaxed text-slate-400 mt-2">
              SIMDULICH.VN - Đơn vị cung cấp giải pháp kết nối internet quốc tế hàng đầu tại Việt Nam.
            </p>
          </div>

          <div className="flex flex-col gap-4 text-left">
            <h3 className="text-white font-bold text-lg">Liên kết nhanh</h3>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/esim" className="hover:text-primary transition-colors">Mua eSIM</Link></li>
              <li><Link href="/about" className="hover:text-primary transition-colors">Về chúng tôi</Link></li>
              <li><Link href="/guide" className="hover:text-primary transition-colors">Hướng dẫn sử dụng</Link></li>
              <li><Link href="/blog" className="hover:text-primary transition-colors">Tin tức & Blog</Link></li>
            </ul>
          </div>

          <div className="flex flex-col gap-4 text-left">
            <h3 className="text-white font-bold text-lg">Liên hệ hỗ trợ</h3>
            <ul className="space-y-3.5 text-sm">
              <li className="flex items-center gap-3">
                <Phone className="h-4.5 w-4.5 text-primary shrink-0" />
                <span className="font-semibold text-white">0901 686 999</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4.5 w-4.5 text-primary shrink-0" />
                <a href="mailto:service@simdulich.vn" className="hover:text-primary transition-colors">service@simdulich.vn</a>
              </li>
              <li className="flex items-start gap-3">
                <MapPin className="h-4.5 w-4.5 text-primary shrink-0 mt-0.5" />
                <span className="leading-relaxed text-slate-400">
                  Lầu 7 ROX Tower, 180-192 Nguyễn Công Trứ, phường Bến Thành, Quận 1, TP. Hồ Chí Minh
                </span>
              </li>
            </ul>
          </div>

          <div className="flex flex-col gap-4 text-left">
            <h3 className="text-white font-bold text-lg">Theo dõi chúng tôi</h3>
            <a
              href="https://www.facebook.com/SIMDULICH.VNVietNam/"
              target="_blank"
              rel="noreferrer"
              className="h-9 w-9 rounded-full bg-[#2A1436] hover:bg-primary transition-colors flex items-center justify-center text-white"
              aria-label="Facebook"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </a>
          </div>
        </div>

        <div className="border-t border-[#2A1436] mt-16 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-purple-300/40">
          <p>© {new Date().getFullYear()} SIMDULICH.VN. Đã đăng ký bản quyền.</p>
        </div>
      </div>
    </footer>
  );
}
