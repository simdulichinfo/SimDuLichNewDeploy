'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthProvider';

const NAV_LINKS = [
  { name: 'Mua eSIM', href: '/esim' },
  { name: 'Về chúng tôi', href: '/about' },
  { name: 'Hướng dẫn sử dụng', href: '/guide' },
  { name: 'Liên hệ', href: '/contact' },
  { name: 'Blog', href: '/blog' },
];

export default function Header({ currentPath }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();

  return (
    <>
      <header className="sticky z-50 top-4 md:top-6 transition-all duration-300">
        <div className="container mx-auto px-4 max-w-[1232px]">
          <div className="flex items-center justify-between gap-2 rounded-full border border-white/30 bg-white/20 p-2.5 shadow-lg shadow-black/5 backdrop-blur-xl sm:gap-3 sm:p-3">
            <Link href="/" className="flex items-center shrink-0">
              <img
                src="/logo.svg"
                alt="SIMDULICH.VN Logo"
                className="h-7 w-auto md:h-9 max-w-[163px] shrink-0 object-contain"
              />
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.name}
                  href={link.href}
                  className={`text-base font-semibold px-4 py-2 rounded-full transition-colors duration-200 ${
                    currentPath === link.href
                      ? 'text-brand-gradient bg-white/40 shadow-sm'
                      : 'text-foreground/70 hover:text-secondary'
                  }`}
                >
                  {link.name}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="flex h-9 w-9 shrink-0 items-center justify-center text-foreground lg:hidden sm:h-10 sm:w-10 rounded-full hover:bg-white/10 transition-colors"
                aria-label="Toggle Menu"
              >
                <Menu className="h-5 w-5 text-primary sm:h-6 sm:w-6" />
              </button>

              {isAuthenticated ? (
                <div className="hidden lg:flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground/80 px-2">{user?.user_metadata?.name || user?.email}</span>
                  <button
                    onClick={logout}
                    className="flex items-center justify-center h-10 rounded-full px-4 text-sm font-semibold text-foreground/70 hover:bg-white/20 transition-colors"
                  >
                    Đăng xuất
                  </button>
                </div>
              ) : (
                <Link
                  href="/login"
                  className="items-center justify-center text-sm font-semibold transition-all duration-200 text-white h-10 py-2 hidden lg:flex rounded-full px-6 bg-brand-gradient hover:opacity-95 shadow-md shadow-secondary/20"
                >
                  Đăng nhập
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm transition-opacity lg:hidden">
          <div className="fixed inset-y-0 right-0 w-full max-w-[280px] bg-white p-6 shadow-2xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-8">
                <img src="/logo.svg" alt="SIMDULICH.VN Logo" className="h-7 w-auto object-contain" />
                <button
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-1 rounded-full hover:bg-slate-100 text-slate-500"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.name}
                    href={link.href}
                    onClick={() => setIsMobileMenuOpen(false)}
                    className={`text-lg font-semibold py-2 border-b border-slate-100 ${
                      currentPath === link.href ? 'text-brand-gradient' : 'text-slate-700'
                    }`}
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
            </div>

            {isAuthenticated ? (
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  logout();
                }}
                className="w-full text-center font-semibold text-white py-3 rounded-full bg-brand-gradient hover:opacity-95 transition-all"
              >
                Đăng xuất
              </button>
            ) : (
              <Link
                href="/login"
                onClick={() => setIsMobileMenuOpen(false)}
                className="w-full text-center font-semibold text-white py-3 rounded-full bg-brand-gradient hover:opacity-95 transition-all"
              >
                Đăng nhập
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
