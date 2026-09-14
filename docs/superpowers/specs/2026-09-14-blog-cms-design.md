# Blog CMS (Admin + Public) — Design Spec

## Bối cảnh

Trang "Blog" hiện có trên web (`Simdulich`) hoàn toàn không có backend — 6 bài viết đang được viết
cứng trong `src/data/defaultSiteContent.js`, đọc qua `SiteContentContext`. Không có màn hình admin
nào để tạo/sửa/xoá bài; muốn đổi nội dung phải sửa trực tiếp code và deploy lại. Backend Java cũ
cũng chưa từng có module Blog/CMS — đây là tính năng hoàn toàn mới, không phải port lại hệ thống cũ.

## Phạm vi

**Trong phạm vi:**
- Backend: 2 bảng mới (`blog_categories`, `blog_posts`) trong `simDulichNew`, CRUD đầy đủ cho cả
  hai qua API admin, đọc công khai cho bài đã đăng.
- Admin UI: 3 trang mới trong `Simdulich` — quản lý bài viết (danh sách + soạn/sửa), quản lý danh
  mục.
- Rich-text editor (TipTap) cho phần nội dung bài viết.
- Trạng thái nháp (`draft`) / đã đăng (`published`) cho mỗi bài.
- Migrate 6 bài viết cứng hiện có thành dữ liệu seed trong Supabase.
- URL riêng cho mỗi bài (`/blog/<slug>`), hỗ trợ deep-link + Back/Forward/F5 đúng.
- Rewiring 2 chỗ ở frontend đang đọc `SiteContentContext.blogPosts` (`BlogPage.jsx`,
  `Blog.jsx` — khối trên trang chủ) sang gọi API thật.

**Ngoài phạm vi:**
- Upload ảnh thật (Supabase Storage) — chỉ nhập URL ảnh, giống cách danh mục sản phẩm đang làm.
- Phân trang/lọc phía server cho trang Blog công khai — số bài còn ít, lọc phía trình duyệt như
  hiện tại là đủ.
- Bình luận, lượt xem, SEO meta tags nâng cao (Open Graph, sitemap...) — có thể làm ở đợt sau nếu
  cần.
- Đổi rich-text editor's output khỏi HTML thô (vẫn lưu `content` dạng HTML string, giống cấu trúc
  dữ liệu cũ, chỉ khác là được sinh ra từ editor WYSIWYG thay vì viết tay).

## Kiến trúc

### Schema

```sql
create table public.blog_categories (
  id bigserial primary key,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.blog_posts (
  id bigserial primary key,
  category_id bigint not null references public.blog_categories(id),
  title text not null,
  slug text not null unique,
  excerpt text not null,
  content text not null,
  image_url text,
  author text not null,
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_blog_posts_status_published_at on public.blog_posts(status, published_at desc);
create index idx_blog_posts_category on public.blog_posts(category_id);
```

`published_at` được set khi status chuyển thành `published` lần đầu (giữ nguyên nếu đã có, không bị
ghi đè mỗi lần sửa bài đã đăng) — dùng để sắp bài mới nhất trước ở trang công khai. `updated_at` cập
nhật mỗi lần sửa (qua trigger hoặc set trực tiếp trong code — quyết định cụ thể ở bước viết plan).

Không có cột `read_time` (khác với dữ liệu cứng cũ có field `readTime` viết tay, ví dụ "3 phút
đọc") — thời gian đọc sẽ được **tính phía trình duyệt** từ độ dài `content` (ước lượng theo số từ),
không lưu trong DB, để admin không phải tự nhập/tính tay mỗi lần sửa bài.

### RLS

```sql
alter table public.blog_categories enable row level security;
alter table public.blog_posts enable row level security;

create policy "Anyone can view blog categories"
  on public.blog_categories for select
  using (true);

create policy "Admins can manage blog categories"
  on public.blog_categories for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());

create policy "Anyone can view published blog posts"
  on public.blog_posts for select
  using (status = 'published');

create policy "Admins can manage blog posts"
  on public.blog_posts for all
  using (public.is_admin_or_staff())
  with check (public.is_admin_or_staff());
```

Postgres RLS cho phép nhiều policy cùng `select` cộng lại (OR) — nên admin vẫn thấy được bài
`draft` qua policy "Admins can manage blog posts" (`for all` bao gồm `select`), còn khách xem qua
policy "Anyone can view published blog posts" chỉ thấy bài đã đăng. Không có tình huống
INSERT-nhưng-không-SELECT-được như đợt 4 (Order), vì admin ở đây có full quyền qua
`is_admin_or_staff()`, không cần RPC riêng.

### Backend API

Không cần replicate "doubled path" của backend cũ (tính năng mới, không có contract cũ nào để giữ).

**Công khai:**
- `GET /api/blog/posts` → `[{id, categoryId, categoryName, title, slug, excerpt, imageUrl, author, publishedAt}, ...]` — chỉ bài `published`, sắp `publishedAt` giảm dần, không phân trang.
- `GET /api/blog/posts/{slug}` → chi tiết đầy đủ 1 bài (thêm field `content`) — 404 nếu không tồn
  tại hoặc đang là `draft`.
- `GET /api/blog/categories` → `[{id, name, slug}, ...]`.

**Admin/staff** (yêu cầu `authenticate` + `requireRole(['admin', 'staff'])`, giống mọi route admin
khác trong dự án):
- `GET /api/blog/admin/posts?page&size` → `{content, number, totalElements, totalPages}` —
  0-indexed, tất cả bài (cả draft).
- `GET /api/blog/admin/posts/{id}` → chi tiết 1 bài để sửa.
- `POST /api/blog/admin/posts` → body `{title, slug, excerpt, content, imageUrl, author,
  categoryId, status}` — tạo mới. Slug trùng → 400.
- `PUT /api/blog/admin/posts/{id}` → sửa các field trên (bao gồm đổi `status`).
- `DELETE /api/blog/admin/posts/{id}` → xoá.
- `GET /api/blog/admin/categories`, `POST .../categories`, `PUT .../categories/{id}`,
  `DELETE .../categories/{id}` — CRUD danh mục. Xoá danh mục đang có bài viết dùng → 400 (không cho
  xoá, giống cách sản phẩm/danh mục hiện tại xử lý).

Mọi lỗi trả `{message: "..."}` kèm status code phù hợp, giống convention toàn dự án.

### Admin UI (`Simdulich`)

3 trang mới, đăng ký route trong `AdminApp.jsx` + thêm mục "Blog" vào sidebar (`AdminLayout.jsx`):

- **`BlogPostsPage.jsx`**: bảng danh sách (tiêu đề, danh mục, trạng thái, ngày), phân trang, nút
  Sửa/Xoá, nút "Viết bài mới" → `BlogPostEditorPage`.
- **`BlogPostEditorPage.jsx`**: form tạo/sửa — tiêu đề, slug (tự sinh từ tiêu đề bằng cách
  chuẩn hoá bỏ dấu + khoảng trắng thành gạch ngang, cho sửa tay), danh mục (dropdown từ
  `GET /api/blog/categories`), ảnh đại diện (input URL + preview `<img>`), mô tả ngắn (excerpt,
  textarea), tác giả (text input, tự do — không tự điền theo tài khoản đang đăng nhập), nội dung
  (TipTap rich-text editor), 2 nút riêng "Lưu nháp" / "Đăng bài" (map vào `status`).
- **`BlogCategoriesPage.jsx`**: CRUD đơn giản (tên, slug) — cấu trúc giống hệt `CategoriesPage.jsx`
  sản phẩm hiện có, chỉ đổi API gọi.

Thư viện rich-text: **TipTap** (`@tiptap/react` + `@tiptap/starter-kit`) — xuất ra HTML string qua
`editor.getHTML()`, lưu trực tiếp vào field `content`.

### Trang công khai — rewiring

- **`BlogPage.jsx`**: bỏ đọc `content.blogPosts` từ `SiteContentContext`, gọi `GET /api/blog/posts`
  lúc mount, lưu vào state cục bộ. Lọc theo danh mục/tìm kiếm vẫn xử lý ở trình duyệt như hiện tại
  (danh mục lấy từ `GET /api/blog/categories` thay cho mảng cứng `categories` trong file).
- **`Blog.jsx`** (khối "Tin tức nổi bật" trang chủ): tương tự, gọi API thật, lấy 6 bài mới nhất
  (API đã sắp `publishedAt` giảm dần nên chỉ cần `.slice(0, 6)`).
- **Deep-link `/blog/:slug`**: mở rộng `resolvePageFromUrl()` trong `App.jsx` để nhận diện thêm
  path `/blog` (→ trang danh sách) và `/blog/<slug>` (→ mở đúng bài đó). Khi người dùng bấm vào 1
  bài trong `BlogPage.jsx`, gọi `window.history.pushState(null, '', '/blog/<slug>')` (giống cách
  `enterAdminOps`/`exitAdminOps` đang làm cho `/admin`); khi bấm "Quay lại danh sách", pushState về
  `/blog`. `BlogPage.jsx` nhận slug ban đầu (nếu có) qua prop từ `App.jsx` để tự fetch đúng bài khi
  tải trang trực tiếp bằng URL đó.
- `defaultSiteContent.js`: xoá field `blogPosts` sau khi migrate xong dữ liệu (không còn ai đọc từ
  đây).

### Migration dữ liệu cũ

1 file seed riêng chuyển 6 bài viết cứng hiện có trong `defaultSiteContent.js` thành các câu
`insert into public.blog_posts (...) values (...)` — giữ nguyên `title`/`content`/`image`/`author`,
sinh `slug` từ `title` (bỏ dấu, thay khoảng trắng bằng gạch ngang, viết thường), `status =
'published'`, `published_at` lấy từ field `date` cũ (parse sang timestamp) hoặc `now()` nếu không
parse được rõ ràng. Danh mục cũ (`Guides`/`Travel`/`Compare`) insert trước thành 3 dòng
`blog_categories` tương ứng để bài viết map đúng `category_id`.

## Kiểm thử

- **Backend**: TDD/Vitest cho `lib/blogPosts.js`, `lib/blogCategories.js`, và từng route — che
  đúng draft/published filter ở endpoint công khai, 401/403 khi thiếu quyền, 404 khi không tìm
  thấy, 400 khi slug trùng hoặc xoá danh mục còn bài viết.
- **Frontend**: Vitest + Testing Library cho `BlogPostsPage`, `BlogPostEditorPage`,
  `BlogCategoriesPage` (render danh sách, submit form gọi đúng API, hiện lỗi khi API lỗi), và cập
  nhật test hiện có của `BlogPage.jsx`/`Blog.jsx` để mock API thay cho `SiteContentContext`.
- **Kiểm thử thủ công** (giống Task cuối các đợt trước): áp migration + seed lên Supabase thật,
  tạo/sửa/xoá bài qua UI admin thật, xác nhận trang Blog công khai và khối trang chủ hiển thị đúng
  dữ liệu thật, xác nhận `/blog/<slug>` bấm F5/Back/Forward giữ đúng bài đang xem.
