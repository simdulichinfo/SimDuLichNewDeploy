# Nền tảng Next.js + Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold app Next.js (App Router, JavaScript) trong repo `simDulichNew`, nối Supabase Auth (email/password) thay cho identity-service Java cũ, port lại layout/trang đăng nhập/đăng ký từ code React hiện có.

**Architecture:** 1 app Next.js duy nhất (không tách frontend/backend), gọi thẳng Supabase (Auth + Postgres) qua `@supabase/ssr`, không còn api-gateway/JWT tự viết/RabbitMQ.

**Tech Stack:** Next.js (App Router), React 19, Tailwind CSS v4 (CSS-based config, không có `tailwind.config.js`), `@supabase/supabase-js` + `@supabase/ssr`, Vitest + Testing Library.

## Global Constraints

- Spec: [`docs/superpowers/specs/2026-09-03-nextjs-supabase-foundation-design.md`](../specs/2026-09-03-nextjs-supabase-foundation-design.md)
- JavaScript, không dùng TypeScript.
- Import tương đối (`../../lib/...`), không dùng alias `@/` — khớp phong cách import hiện có ở repo `Simdulich`.
- Supabase Auth: chỉ bật provider email/password ở giai đoạn này. Không code Google Sign-In.
- Bảng `profiles` (id → `auth.users.id`, `name`, `phone`, `role='customer'` mặc định, `status='active'` mặc định) thay hẳn bảng `users` tự viết cũ — tạo qua trigger `handle_new_user`, không tự gọi thêm API tạo user.
- RLS bật trên `profiles`, mỗi user chỉ đọc/sửa được dòng của chính mình.
- Route `/account` phải redirect `/login` nếu chưa đăng nhập (qua middleware).
- Deploy thử: Vercel free tier (không nằm trong phạm vi plan này — làm thủ công sau khi Task 5 xong).

---

### Task 1: Scaffold Next.js + Tailwind theme + Vitest + layout tĩnh

**Files:**
- Create: toàn bộ scaffold từ `create-next-app` (`package.json`, `next.config.js`, `eslint.config.mjs`, `jsconfig.json`, `.gitignore`, `app/layout.js`, `app/page.js`, `app/globals.css`)
- Modify: `app/globals.css` (port theme từ `Simdulich/src/index.css`)
- Modify: `app/layout.js` (bọc `Header`/`Footer`)
- Modify: `app/page.js` (trang chủ tạm thời)
- Create: `components/Header.jsx`
- Create: `components/Footer.jsx`
- Create: `public/logo.svg` (copy từ `Simdulich/public/logo.svg`)
- Create: `vitest.config.js`
- Create: `test/setup.js`
- Test: `components/__tests__/Header.test.jsx`

**Interfaces:**
- Produces: `<Header currentPath />`, `<Footer />` (component thuần, chưa nhận biết đăng nhập — Task 4 sẽ thêm phần đó) — Task 4/5 import trực tiếp trong `app/layout.js`.

- [ ] **Step 1: Scaffold Next.js vào thư mục tạm rồi copy vào repo**

Repo hiện có `.git/` và `docs/` nên `create-next-app` sẽ từ chối chạy thẳng vào đây (yêu cầu thư mục trống). Scaffold ra thư mục tạm cạnh bên rồi copy nội dung vào.

Run (từ `D:\SimDuLich`):
```bash
npx create-next-app@latest simdulichnew-scaffold --js --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
```
Expected: tạo xong thư mục `D:\SimDuLich\simdulichnew-scaffold` với `package.json`, `app/`, `next.config.js`...

```bash
rm -rf simdulichnew-scaffold/.git simdulichnew-scaffold/node_modules
cp -r simdulichnew-scaffold/. simDulichNew/
rm -rf simdulichnew-scaffold
cd simDulichNew
npm install
```
Expected: `npm install` chạy xong không lỗi, có `node_modules/` và `package-lock.json`.

- [ ] **Step 2: Cài thêm Vitest + Testing Library**

Run: `npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event`

Thêm script test vào `package.json` (trong khối `"scripts"`, cạnh `"dev"`/`"build"`/`"start"`/`"lint"` đã có sẵn):

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Tạo cấu hình Vitest + setup file**

Tạo file `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
  },
});
```

Tạo file `test/setup.js`:

```js
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Viết test thất bại cho `Header`**

Tạo file `components/__tests__/Header.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Header from '../Header';

describe('Header', () => {
  it('hiển thị logo và các link điều hướng chính', () => {
    render(<Header currentPath="/" />);
    expect(screen.getByAltText('SIMDULICH.VN Logo')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về chúng tôi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Đăng nhập' })).toHaveAttribute('href', '/login');
  });
});
```

- [ ] **Step 5: Chạy test, xác nhận thất bại**

Run: `npm test -- Header.test.jsx`
Expected: FAIL — `Cannot find module '../Header'`.

- [ ] **Step 6: Copy logo asset**

Copy file `Simdulich/public/logo.svg` → `simDulichNew/public/logo.svg` (ghi đè `public/next.svg`/`vercel.svg` mặc định của scaffold nếu muốn dọn, không bắt buộc).

- [ ] **Step 7: Port theme Tailwind v4 vào `app/globals.css`**

Thay toàn bộ nội dung `app/globals.css` (do `create-next-app --tailwind` sinh ra) bằng:

```css
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&family=Roboto:ital,wght@0,100..900;1,100..900&display=swap');
@import "tailwindcss";

@theme {
  --font-sans: 'Open Sans', ui-sans-serif, system-ui, sans-serif;
  --font-roboto: 'Roboto', sans-serif;

  --color-primary: hsl(286 50% 32%);
  --color-primary-foreground: hsl(0 0% 100%);
  --color-secondary: hsl(331 85% 47%);
  --color-secondary-foreground: hsl(0 0% 100%);
  --color-yellow-brand: hsl(38 96% 54%);
  --color-background: hsl(286 20% 98%);
  --color-foreground: hsl(0 0% 9%);
  --color-card: hsl(0 0% 100%);
  --color-card-foreground: hsl(0 0% 9%);
  --color-popover: hsl(0 0% 100%);
  --color-popover-foreground: hsl(0 0% 9%);
  --color-muted: hsl(286 20% 96%);
  --color-muted-foreground: hsl(286 10% 50%);
  --color-accent: hsl(286 50% 96%);
  --color-accent-foreground: hsl(286 50% 32%);
  --color-destructive: hsl(4 86% 58%);
  --color-destructive-foreground: hsl(0 0% 100%);
  --color-bluelight: hsl(286 50% 96%);
  --color-border: hsl(0 0% 85%);
  --color-input: hsl(0 0% 100%);
  --color-ring: hsl(286 50% 32%);
  --color-brand: hsl(286 50% 32%);
  --color-brand-hover: hsl(286 50% 25%);
  --color-brand-light: hsl(286 50% 96%);
  --radius: 2rem;
}

@utility bg-brand-gradient {
  background-image: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
}

@utility text-brand-gradient {
  background-image: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.bg-primary,
.hover\:bg-primary:hover,
.active\:bg-primary:active,
.focus\:bg-primary:focus {
  background-image: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%) !important;
  background-color: transparent !important;
}

@layer base {
  button:not(:disabled),
  [role="button"]:not([aria-disabled="true"]),
  summary,
  label[for] {
    cursor: pointer;
  }
}

body {
  background-color: hsl(286 20% 98%);
  color: hsl(0 0% 9%);
  font-family: var(--font-sans);
  overflow-x: hidden;
}
```

(Bỏ các animation/utility riêng cho trang chủ/marquee/admin của bản cũ — sẽ port lại đúng lúc ở các giai đoạn cần chúng, tránh CSS chết ở giai đoạn nền tảng.)

- [ ] **Step 8: Cài `lucide-react`**

Run: `npm install lucide-react`

- [ ] **Step 9: Tạo `components/Header.jsx` (tĩnh, chưa nhận biết đăng nhập)**

```jsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

const NAV_LINKS = [
  { name: 'Mua eSIM', href: '/esim' },
  { name: 'Về chúng tôi', href: '/about' },
  { name: 'Hướng dẫn sử dụng', href: '/guide' },
  { name: 'Liên hệ', href: '/contact' },
  { name: 'Blog', href: '/blog' },
];

export default function Header({ currentPath }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

              <Link
                href="/login"
                className="items-center justify-center text-sm font-semibold transition-all duration-200 text-white h-10 py-2 hidden lg:flex rounded-full px-6 bg-brand-gradient hover:opacity-95 shadow-md shadow-secondary/20"
              >
                Đăng nhập
              </Link>
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

            <Link
              href="/login"
              onClick={() => setIsMobileMenuOpen(false)}
              className="w-full text-center font-semibold text-white py-3 rounded-full bg-brand-gradient hover:opacity-95 transition-all"
            >
              Đăng nhập
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
```

(Bỏ giỏ hàng/`useCart`/`useSiteContent`/trạng thái đăng nhập ở bước này — giỏ hàng thuộc giai đoạn Catalog/Đơn hàng, trạng thái đăng nhập thêm ở Task 4.)

- [ ] **Step 10: Tạo `components/Footer.jsx` (nội dung liên hệ hardcode tạm — sẽ chuyển thành dữ liệu quản trị được ở giai đoạn Admin)**

```jsx
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
                <span className="font-semibold text-white">0939 909 545</span>
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
```

- [ ] **Step 11: Nối `Header`/`Footer` vào `app/layout.js`**

Thay nội dung `app/layout.js` (giữ nguyên phần `metadata`/font do scaffold sinh ra, chỉ đổi phần `<body>`):

```jsx
import './globals.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

export const metadata = {
  title: 'SIMDULICH.VN',
  description: 'Bay khắp thế giới, không cần đổi SIM',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
```

- [ ] **Step 12: Thay `app/page.js` bằng trang chủ tạm thời**

```jsx
export default function HomePage() {
  return (
    <div className="container mx-auto px-4 py-16 text-center">
      <h1 className="text-4xl font-extrabold text-slate-900">SIMDULICH.VN</h1>
      <p className="mt-3 text-slate-500">Bay khắp thế giới, không cần đổi SIM.</p>
    </div>
  );
}
```

- [ ] **Step 13: Chạy lại test, xác nhận PASS**

Run: `npm test -- Header.test.jsx`
Expected: PASS.

- [ ] **Step 14: Chạy thử dev server, xác nhận trang chủ render đúng**

Run: `npm run dev` (nền), mở `http://localhost:3000`
Expected: thấy header (logo + nav + nút Đăng nhập) và footer, không lỗi console.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js app with ported Tailwind theme and static layout"
```

---

### Task 2: Supabase project + client helpers + schema `profiles`

**Files:**
- Create: `lib/supabase/client.js`
- Create: `lib/supabase/server.js`
- Create: `lib/supabase/middleware.js`
- Create: `supabase/migrations/0001_profiles.sql`
- Modify: `.env.local` (không commit — thêm vào `.gitignore` nếu scaffold chưa có sẵn)
- Modify: `.env.example` (commit — chỉ tên biến, không có giá trị thật)
- Test: `lib/supabase/__tests__/client.test.js`

**Interfaces:**
- Produces: `createClient()` (browser, từ `lib/supabase/client.js`), `createClient()` (server/async, từ `lib/supabase/server.js`), `updateSession(request)` (từ `lib/supabase/middleware.js`, trả `{ supabaseResponse, user }`) — Task 3/4/5 dùng cả ba.

- [ ] **Step 1: Tạo project Supabase mới (thao tác ngoài code)**

Trên [supabase.com](https://supabase.com/dashboard) (tài khoản mới, tách khỏi tài khoản cũ bị khóa):
1. Tạo Organization mới → New Project → đặt tên (vd `simdulich-new`), chọn region gần Việt Nam (Singapore).
2. Vào **Project Settings → API** → copy `Project URL` và `anon public` key.
3. Vào **Authentication → Providers** → xác nhận **Email** provider đang bật (mặc định đã bật sẵn).

- [ ] **Step 2: Cài `@supabase/supabase-js` và `@supabase/ssr`**

Run: `npm install @supabase/supabase-js @supabase/ssr`

- [ ] **Step 3: Tạo `.env.local` và `.env.example`**

Tạo file `.env.local` (KHÔNG commit — thêm dòng `.env*.local` vào `.gitignore` nếu scaffold chưa có, mặc định `create-next-app` đã có sẵn dòng này):

```
NEXT_PUBLIC_SUPABASE_URL=<Project URL vừa copy>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key vừa copy>
```

Tạo file `.env.example` (commit bình thường — chỉ tên biến):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

- [ ] **Step 4: Viết test thất bại cho client Supabase phía trình duyệt**

Tạo file `lib/supabase/__tests__/client.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({ mocked: true })),
}));

import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '../client';

describe('lib/supabase/client', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  });

  it('gọi createBrowserClient với URL và anon key từ env', () => {
    createClient();
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key-test',
    );
  });
});
```

- [ ] **Step 5: Chạy test, xác nhận thất bại**

Run: `npm test -- client.test.js`
Expected: FAIL — `Cannot find module '../client'`.

- [ ] **Step 6: Tạo `lib/supabase/client.js`**

```js
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
```

- [ ] **Step 7: Chạy lại test, xác nhận PASS**

Run: `npm test -- client.test.js`
Expected: PASS.

- [ ] **Step 8: Tạo `lib/supabase/server.js`**

```js
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          } catch {
            // Được gọi từ Server Component — bỏ qua vì middleware (Step 9) đã tự refresh session.
          }
        },
      },
    },
  );
}
```

(Không viết test cho file này — cần môi trường request/cookie thật của Next.js server runtime, `next/headers` không hoạt động ngoài request context nên mock không mang lại giá trị thật. Được xác minh gián tiếp qua test tích hợp thủ công ở Task 5.)

- [ ] **Step 9: Tạo `lib/supabase/middleware.js`**

```js
import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

export async function updateSession(request) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}
```

- [ ] **Step 10: Tạo migration SQL cho `profiles`**

Tạo file `supabase/migrations/0001_profiles.sql`:

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  role text not null default 'customer',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.raw_user_meta_data->>'phone'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 11: Chạy migration trên Supabase (thao tác ngoài code)**

Vào Supabase Dashboard → **SQL Editor** → New query → dán nguyên nội dung `supabase/migrations/0001_profiles.sql` → **Run**.
Expected: chạy thành công, không lỗi. Vào **Table Editor** thấy bảng `profiles` với đúng 6 cột.

- [ ] **Step 12: Commit**

```bash
git add lib/supabase/client.js lib/supabase/server.js lib/supabase/middleware.js lib/supabase/__tests__/client.test.js supabase/migrations/0001_profiles.sql .env.example package.json package-lock.json
git commit -m "feat: add Supabase client helpers and profiles table migration"
```

(Không `git add .env.local` — file này chứa giá trị thật, đã bị `.gitignore` chặn theo mặc định của `create-next-app`.)

---

### Task 3: Trang Đăng ký (Supabase `signUp`)

**Files:**
- Create: `app/(auth)/authUI.js`
- Create: `app/(auth)/register/page.js`
- Test: `app/(auth)/register/__tests__/page.test.jsx`

**Interfaces:**
- Consumes: `createClient()` từ `lib/supabase/client.js` (Task 2).
- Produces: route `/register` — Task 5 (Header có thể link tới, không bắt buộc trong phạm vi này).

- [ ] **Step 1: Tạo `app/(auth)/authUI.js`**

```js
export const inputClass =
  'w-full h-[52px] rounded-full border border-transparent bg-[#F2F6FC] px-5 text-[15px] text-slate-800 ' +
  'placeholder-slate-400 outline-none transition-all focus:border-primary/40 focus:bg-white focus:ring-2 focus:ring-primary/20';
```

- [ ] **Step 2: Viết test thất bại cho trang Đăng ký**

Tạo file `app/(auth)/register/__tests__/page.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const signUpMock = vi.fn();
vi.mock('../../../../lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: signUpMock } }),
}));

import RegisterPage from '../page';

describe('RegisterPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    signUpMock.mockReset();
  });

  it('đăng ký thành công gọi signUp rồi chuyển tới /account', async () => {
    signUpMock.mockResolvedValue({ error: null });
    render(<RegisterPage />);

    await userEvent.type(screen.getByPlaceholderText('Họ tên'), 'Nguyễn Văn A');
    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'matkhau123');
    await userEvent.type(screen.getByPlaceholderText('Xác nhận mật khẩu'), 'matkhau123');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));

    await waitFor(() => expect(signUpMock).toHaveBeenCalledWith({
      email: 'a@simdulich.vn',
      password: 'matkhau123',
      options: { data: { name: 'Nguyễn Văn A', phone: '' } },
    }));
    expect(pushMock).toHaveBeenCalledWith('/account');
  });

  it('mật khẩu xác nhận không khớp thì không gọi signUp', async () => {
    render(<RegisterPage />);

    await userEvent.type(screen.getByPlaceholderText('Họ tên'), 'Nguyễn Văn A');
    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'matkhau123');
    await userEvent.type(screen.getByPlaceholderText('Xác nhận mật khẩu'), 'khac123');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Đăng ký' }));

    expect(await screen.findByText('Mật khẩu xác nhận không khớp.')).toBeInTheDocument();
    expect(signUpMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận thất bại**

Run: `npm test -- register/__tests__/page.test.jsx`
Expected: FAIL — `Cannot find module '../page'`.

- [ ] **Step 4: Tạo `app/(auth)/register/page.js`**

```jsx
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
```

- [ ] **Step 5: Chạy lại test, xác nhận PASS**

Run: `npm test -- register/__tests__/page.test.jsx`
Expected: PASS (2 test).

- [ ] **Step 6: Commit**

```bash
git add app/\(auth\)/authUI.js app/\(auth\)/register
git commit -m "feat: add register page wired to Supabase Auth signUp"
```

---

### Task 4: Trang Đăng nhập (Supabase `signInWithPassword`) + `AuthProvider`

**Files:**
- Create: `context/AuthProvider.jsx`
- Create: `app/(auth)/login/page.js`
- Modify: `app/layout.js` (bọc `AuthProvider`)
- Modify: `components/Header.jsx` (đọc trạng thái đăng nhập, hiện tên/nút đăng xuất)
- Test: `app/(auth)/login/__tests__/page.test.jsx`
- Test: `components/__tests__/Header.test.jsx` (thêm case đã đăng nhập)

**Interfaces:**
- Consumes: `createClient()` từ `lib/supabase/client.js` (Task 2).
- Produces: `useAuth()` (`{ user, isAuthenticated, loading, logout() }`) từ `context/AuthProvider.jsx` — Task 5 (`/account` phía client nếu cần) và các giai đoạn sau dùng.

- [ ] **Step 1: Viết test thất bại cho `AuthProvider`**

Tạo file `context/__tests__/AuthProvider.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthProvider';

const getUserMock = vi.fn();
const onAuthStateChangeMock = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }));

vi.mock('../../lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
  }),
}));

const wrapper = ({ children }) => <AuthProvider>{children}</AuthProvider>;

describe('AuthProvider', () => {
  beforeEach(() => {
    getUserMock.mockReset();
    onAuthStateChangeMock.mockClear();
  });

  it('nạp user hiện tại lúc khởi động', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@simdulich.vn' } } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user.email).toBe('a@simdulich.vn');
  });

  it('chưa đăng nhập thì isAuthenticated là false', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `npm test -- AuthProvider.test.jsx`
Expected: FAIL — `Cannot find module '../AuthProvider'`.

- [ ] **Step 3: Tạo `context/AuthProvider.jsx`**

```jsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { createClient } from '../lib/supabase/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: Boolean(user), loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
```

- [ ] **Step 4: Chạy lại test, xác nhận PASS**

Run: `npm test -- AuthProvider.test.jsx`
Expected: PASS (2 test).

- [ ] **Step 5: Viết test thất bại cho trang Đăng nhập**

Tạo file `app/(auth)/login/__tests__/page.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const signInWithPasswordMock = vi.fn();
vi.mock('../../../../lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword: signInWithPasswordMock } }),
}));

import LoginPage from '../page';

describe('LoginPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    signInWithPasswordMock.mockReset();
  });

  it('đăng nhập thành công chuyển tới /account', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'matkhau123');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    await waitFor(() => expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: 'a@simdulich.vn',
      password: 'matkhau123',
    }));
    expect(pushMock).toHaveBeenCalledWith('/account');
  });

  it('sai mật khẩu hiển thị lỗi tiếng Việt, không chuyển trang', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<LoginPage />);

    await userEvent.type(screen.getByPlaceholderText('Email'), 'a@simdulich.vn');
    await userEvent.type(screen.getByPlaceholderText('Mật khẩu'), 'sai-mat-khau');
    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }));

    expect(await screen.findByText('Email hoặc mật khẩu không đúng.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Chạy test, xác nhận thất bại**

Run: `npm test -- login/__tests__/page.test.jsx`
Expected: FAIL — `Cannot find module '../page'`.

- [ ] **Step 7: Tạo `app/(auth)/login/page.js`**

```jsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { createClient } from '../../../lib/supabase/client';
import { inputClass } from '../authUI';

const ERROR_MESSAGES = {
  'Invalid login credentials': 'Email hoặc mật khẩu không đúng.',
};

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
      setError(ERROR_MESSAGES[signInError.message] || signInError.message);
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
```

- [ ] **Step 8: Chạy lại test, xác nhận PASS**

Run: `npm test -- login/__tests__/page.test.jsx`
Expected: PASS (2 test).

- [ ] **Step 9: Bọc `AuthProvider` trong `app/layout.js`**

Đổi `app/layout.js` thành:

```jsx
import './globals.css';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { AuthProvider } from '../context/AuthProvider';

export const metadata = {
  title: 'SIMDULICH.VN',
  description: 'Bay khắp thế giới, không cần đổi SIM',
};

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <body>
        <AuthProvider>
          <Header />
          <main>{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 10: Cập nhật `components/Header.jsx` — hiện tên/nút đăng xuất khi đã đăng nhập**

Thêm import ở đầu file:

```jsx
import { useAuth } from '../context/AuthProvider';
```

Đổi dòng đầu hàm `Header`:

```jsx
export default function Header({ currentPath }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
```

thành:

```jsx
export default function Header({ currentPath }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { user, isAuthenticated, logout } = useAuth();
```

Đổi khối nút "Đăng nhập" ở phần desktop (trong `<div className="flex items-center gap-2 sm:gap-3">`) từ:

```jsx
              <Link
                href="/login"
                className="items-center justify-center text-sm font-semibold transition-all duration-200 text-white h-10 py-2 hidden lg:flex rounded-full px-6 bg-brand-gradient hover:opacity-95 shadow-md shadow-secondary/20"
              >
                Đăng nhập
              </Link>
```

thành:

```jsx
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
```

- [ ] **Step 11: Thêm test cho `Header` khi đã đăng nhập**

Trong `components/__tests__/Header.test.jsx`, thêm mock ở đầu file (trước `import Header from '../Header';`):

```jsx
import { vi } from 'vitest';

const useAuthMock = vi.fn();
vi.mock('../../context/AuthProvider', () => ({
  useAuth: () => useAuthMock(),
}));
```

Đổi test hiện có để set mock trước khi render — thêm `beforeEach`:

```jsx
beforeEach(() => {
  useAuthMock.mockReturnValue({ user: null, isAuthenticated: false, logout: vi.fn() });
});
```

Thêm test mới vào cuối `describe` block:

```jsx
  it('hiện tên người dùng và nút Đăng xuất khi đã đăng nhập', () => {
    useAuthMock.mockReturnValue({
      user: { email: 'a@simdulich.vn', user_metadata: { name: 'Nguyễn Văn A' } },
      isAuthenticated: true,
      logout: vi.fn(),
    });
    render(<Header currentPath="/" />);
    expect(screen.getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Đăng nhập' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 12: Chạy toàn bộ test suite, xác nhận PASS**

Run: `npm test`
Expected: tất cả PASS (Header, AuthProvider, LoginPage, RegisterPage, client Supabase).

- [ ] **Step 13: Commit**

```bash
git add context/AuthProvider.jsx context/__tests__/AuthProvider.test.jsx "app/(auth)/login" app/layout.js components/Header.jsx components/__tests__/Header.test.jsx
git commit -m "feat: add login page, AuthProvider, and auth-aware Header"
```

---

### Task 5: Middleware bảo vệ `/account` + trang `/account` + kiểm thử thủ công end-to-end

**Files:**
- Create: `middleware.js`
- Create: `app/account/page.js`

**Interfaces:**
- Consumes: `updateSession(request)` (Task 2), `createClient()` server (Task 2).

- [ ] **Step 1: Tạo `middleware.js` (gốc repo, ngang hàng `package.json`)**

```js
import { NextResponse } from 'next/server';
import { updateSession } from './lib/supabase/middleware';

const PROTECTED_PATHS = ['/account'];

export async function middleware(request) {
  const { supabaseResponse, user } = await updateSession(request);

  const isProtected = PROTECTED_PATHS.some((path) =>
    request.nextUrl.pathname.startsWith(path));

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 2: Tạo `app/account/page.js`**

```jsx
import { redirect } from 'next/navigation';
import { createClient } from '../../lib/supabase/server';

export default async function AccountPage() {
  const supabase = await createClient();
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
```

(Không viết test tự động cho file này — Server Component `async` gọi `next/headers`/`cookies()` cần request context thật của Next.js runtime, Vitest không render được loại component này một cách có ý nghĩa. Xác minh bằng kiểm thử thủ công ở Step 3.)

- [ ] **Step 3: Kiểm thử thủ công end-to-end qua trình duyệt**

Chạy `npm run dev`, mở `http://localhost:3000`.

1. Vào `/account` khi chưa đăng nhập → xác nhận redirect về `/login`.
2. Vào `/register`, điền form hợp lệ, submit → xác nhận chuyển tới `/account`, thấy đúng email/họ tên/`role: customer`/`status: active`.
3. Vào Supabase Dashboard → Table Editor → `profiles` → xác nhận có đúng 1 dòng mới khớp thông tin vừa đăng ký.
4. Bấm "Đăng xuất" ở Header → xác nhận quay lại trạng thái chưa đăng nhập (nút "Đăng nhập" hiện lại), vào `/account` lại bị redirect về `/login`.
5. Vào `/login`, đăng nhập lại đúng tài khoản vừa tạo → xác nhận vào được `/account`, Header hiện đúng tên.
6. Thử đăng nhập sai mật khẩu → xác nhận thấy thông báo "Email hoặc mật khẩu không đúng.", không chuyển trang.

- [ ] **Step 4: Commit**

```bash
git add middleware.js app/account
git commit -m "feat: protect /account route via middleware and add account page"
```

- [ ] **Step 5: Push lên GitHub (chỉ khi đã xác nhận với người dùng)**

```bash
git push origin main
```

---

## Self-Review

- **Spec coverage:** repo mới + tận dụng UI cũ (Task 1), Supabase project + bảng `profiles`/trigger/RLS (Task 2), JavaScript xuyên suốt (mọi task), Supabase Auth email/password cho đăng ký (Task 3) và đăng nhập (Task 4), middleware chặn `/account` + trang xác nhận role (Task 5) — khớp đủ mục "Quyết định phạm vi" và "Auth flow" trong spec. Google Sign-In, Catalog/Đơn hàng/Admin, trỏ domain — đúng như spec, nằm ngoài phạm vi plan này.
- **Placeholder scan:** không còn "TBD"/"TODO" — các bước thao tác ngoài code (tạo project Supabase, chạy SQL trên Dashboard, kiểm thử thủ công) đều liệt kê hành động cụ thể, không phải placeholder mơ hồ.
- **Type consistency:** `createClient()` (browser, Task 2) và `createClient()` (server, Task 2, khác file/namespace) dùng nhất quán tên hàm nhưng import path khác nhau rõ ràng ở từng nơi dùng (`lib/supabase/client` vs `lib/supabase/server`) — không nhầm lẫn vì luôn import theo path đầy đủ. `useAuth()` trả `{ user, isAuthenticated, loading, logout }` nhất quán giữa `AuthProvider.jsx` (Task 4), test của nó, và `Header.jsx` (Task 4). `updateSession(request)` trả `{ supabaseResponse, user }` nhất quán giữa `lib/supabase/middleware.js` (Task 2) và `middleware.js` gốc (Task 5).
