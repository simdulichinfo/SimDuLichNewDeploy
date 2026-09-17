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

-- Seed: 3 categories carried over from the old hardcoded frontend data
-- (src/data/defaultSiteContent.js), plus the 6 posts that were baked into that file, so the
-- public site keeps showing the same content once BlogPage.jsx/Blog.jsx switch to the real API
-- (Task 7).
insert into public.blog_categories (name, slug) values
  ('Hướng dẫn cài đặt', 'guides'),
  ('Kinh nghiệm du lịch', 'travel'),
  ('So sánh & Tư vấn', 'compare');

insert into public.blog_posts (category_id, title, slug, excerpt, content, image_url, author, status, published_at) values
(
  (select id from public.blog_categories where slug = 'guides'),
  'Cách cài đặt và kích hoạt eSIM nhanh nhất trên iPhone & Android',
  'cach-cai-dat-kich-hoat-esim-iphone-android',
  'Hướng dẫn từng bước chi tiết quét mã QR và cấu hình dữ liệu di động trước khi khởi hành chuyến đi của bạn.',
  '<p class="text-base md:text-lg leading-relaxed text-slate-600 font-medium">Kích hoạt eSIM (SIM điện tử) là giải pháp vô cùng nhanh chóng để bạn chuẩn bị kết nối mạng di động nước ngoài mà không cần khay SIM vật lý. Dưới đây là hướng dẫn chuẩn xác nhất cho cả iOS và Android.</p>
<div class="bg-amber-50 border border-amber-200 rounded-2xl p-5 my-6 flex items-start gap-3">
  <div>
    <p class="font-bold text-amber-900 text-sm">Lưu ý cực kỳ quan trọng trước khi cài đặt</p>
    <ul class="list-disc list-inside text-amber-800 text-xs mt-2 space-y-1">
      <li>Thiết bị của bạn phải kết nối mạng Wi-Fi ổn định trong suốt quá trình kích hoạt.</li>
      <li>Không được tắt hoặc thoát màn hình khi quá trình tải cấu hình eSIM đang diễn ra.</li>
      <li>Mỗi mã QR chỉ quét được 1 LẦN DUY NHẤT. Tuyệt đối không tự ý xóa eSIM khi gặp sự cố mà hãy liên hệ kỹ thuật để được hỗ trợ.</li>
    </ul>
  </div>
</div>
<h2 class="text-2xl font-bold text-slate-800 mt-8">Phần 1: Cài đặt eSIM trên hệ điều hành iOS (iPhone)</h2>
<p class="text-slate-600 leading-relaxed">iPhone hỗ trợ quản lý nhiều eSIM vô cùng mượt mà. Hãy thực hiện theo các bước sau từ trước khi lên máy bay:</p>
<ol class="list-decimal list-inside space-y-3 pl-2 text-slate-700 font-semibold text-sm">
  <li>Mở ứng dụng <span class="text-primary">Cài đặt (Settings)</span> và chọn <span class="text-primary">Di động (Cellular)</span>.</li>
  <li>Bấm chọn <span class="text-primary">Thêm eSIM (Add eSIM)</span> hoặc <span class="text-primary">Thêm gói cước di động</span>.</li>
  <li>Chọn <span class="text-primary">Sử dụng mã QR (Use QR Code)</span>.</li>
  <li>Đưa camera điện thoại quét mã QR được gửi trong Email đơn hàng của bạn.</li>
  <li>Chờ 30 giây để thiết bị tải cấu hình. Sau khi hoàn tất, hãy đặt tên nhãn cho eSIM mới này (Ví dụ: "SIMDULICH.VN Du Lịch").</li>
</ol>
<h2 class="text-2xl font-bold text-slate-800 mt-8">Phần 2: Cài đặt eSIM trên hệ điều hành Android (Samsung, Pixel)</h2>
<ol class="list-decimal list-inside space-y-3 pl-2 text-slate-700 font-semibold text-sm">
  <li>Truy cập <span class="text-primary">Cài đặt (Settings)</span> → chọn <span class="text-primary">Kết nối (Connections)</span>.</li>
  <li>Chọn mục <span class="text-primary">Quản lý SIM (SIM Manager)</span>.</li>
  <li>Bấm chọn <span class="text-primary">Thêm eSIM (Add mobile plan)</span>.</li>
  <li>Chọn <span class="text-primary">Quét mã QR từ nhà mạng (Scan carrier QR code)</span>.</li>
  <li>Quét mã QR từ email của bạn và bấm <span class="text-primary">Thêm (Add / Confirm)</span> để hoàn thành.</li>
</ol>
<div class="bg-[#F9F5FD] rounded-2xl p-6 border border-[#F0E5FA] mt-8">
  <h3 class="font-bold text-slate-800 text-base mb-2">Cách kích hoạt sử dụng khi đáp xuống sân bay quốc tế</h3>
  <p class="text-slate-600 text-sm leading-relaxed">Ngay khi máy bay hạ cánh: Vào <strong>Cài đặt di động</strong> → Bật đường truyền <strong>SIMDULICH.VN</strong> → Chọn dòng này làm <strong>Dữ liệu di động chính (Cellular Data)</strong> → Đồng thời bật nút <strong>Chuyển vùng dữ liệu (Data Roaming)</strong> của eSIM lên để kết nối internet quốc tế.</p>
</div>',
  '/images/blog_image_1.png',
  'Kỹ thuật viên SIMDULICH.VN',
  'published',
  '2026-06-17 00:00:00+07'
),
(
  (select id from public.blog_categories where slug = 'travel'),
  'Kinh nghiệm du lịch tự túc Thái Lan với kết nối mạng 5G không giới hạn',
  'kinh-nghiem-du-lich-thai-lan-esim-5g',
  'Chia sẻ mẹo chọn gói cước eSIM và giữ liên lạc thông suốt trong suốt hành trình phượt Bangkok - Phuket.',
  '<p class="text-base md:text-lg leading-relaxed text-slate-600 font-medium">Du lịch Thái Lan tự túc đã trở thành lựa chọn quen thuộc của đông đảo bạn trẻ Việt. Tuy nhiên, để có chuyến đi trọn vẹn thì internet tốc độ cao là điều bắt buộc phải có để dò đường Google Maps, đặt xe Grab/Bolt và dịch thuật tại chỗ.</p>
<h2 class="text-2xl font-bold text-slate-800 mt-8">Lý do vì sao bạn nên chọn eSIM thay vì mua SIM tại sân bay Bangkok</h2>
<p class="text-slate-600 leading-relaxed">Nhiều du khách thường chọn mua SIM tại quầy dịch vụ ở sân bay Suvarnabhumi hoặc Don Mueang. Tuy nhiên, phương án này có nhiều bất cập: phải xếp hàng dài sau chuyến bay mệt mỏi, chi phí đắt hơn và nguy cơ thất lạc SIM gốc của Việt Nam khi tháo lắp thiết bị.</p>
<h2 class="text-2xl font-bold text-slate-800 mt-8">Trải nghiệm tốc độ 5G của nhà mạng DTAC & AIS</h2>
<p class="text-slate-600 leading-relaxed">SIMDULICH.VN cung cấp gói cước tích hợp roaming với nhà mạng lớn nhất Thái Lan. Trải nghiệm thực tế tại Bangkok cho thấy sóng luôn căng tràn 5 vạch 5G, tốc độ download lên đến 180 Mbps, cho phép livestream HD và thực hiện cuộc gọi video hoàn toàn không bị trễ/giật.</p>
<h3 class="text-lg font-bold text-slate-800 mt-6">Lịch trình đề xuất & Gói cước khuyên dùng:</h3>
<ul class="list-disc list-inside space-y-2 text-slate-600 text-sm">
  <li>Lịch trình 3-5 ngày (Bangkok & Pattaya): Chọn gói eSIM 1GB/Ngày tốc độ cao là đủ dùng cho nhu cầu cơ bản.</li>
  <li>Lịch trình trên 5 ngày hoặc có đi Phuket/Chiang Mai: Khuyên dùng gói dữ liệu Không giới hạn dung lượng để phát sóng thoải mái cho bạn bè đi cùng.</li>
</ul>',
  '/images/blog_image_2.png',
  'Admin SIMDULICH.VN',
  'published',
  '2026-06-16 00:00:00+07'
),
(
  (select id from public.blog_categories where slug = 'compare'),
  'So sánh eSIM du lịch và SIM vật lý: Lựa chọn nào tối ưu cho phượt thủ?',
  'so-sanh-esim-va-sim-vat-ly',
  'Phân tích chi tiết về giá cả, độ tiện dụng, khả năng chuyển vùng và tương thích thiết bị của hai hình thức kết nối.',
  '<p class="text-base md:text-lg leading-relaxed text-slate-600 font-medium">Khi chuẩn bị đi du lịch nước ngoài, lựa chọn giữa eSIM (SIM điện tử kỹ thuật số) và thẻ SIM vật lý truyền thống là băn khoăn của rất nhiều du khách. Hãy cùng chúng tôi so sánh chi tiết các khía cạnh dưới đây.</p>
<h2 class="text-2xl font-bold text-slate-800 mt-8">Bảng so sánh chi tiết: eSIM vs SIM vật lý</h2>
<div class="overflow-x-auto my-6 border border-slate-100 rounded-2xl shadow-sm">
  <table class="w-full text-sm text-left text-slate-600 border-collapse">
    <thead class="bg-slate-50 text-slate-800 uppercase font-bold text-xs border-b border-slate-200">
      <tr>
        <th class="px-6 py-4">Tiêu chí</th>
        <th class="px-6 py-4">eSIM Du Lịch</th>
        <th class="px-6 py-4">SIM Vật Lý Du Lịch</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100">
      <tr>
        <td class="px-6 py-4 font-semibold text-slate-800">Thao tác lắp đặt</td>
        <td class="px-6 py-4 text-emerald-600 font-semibold">Quét mã QR online (Không cần tháo máy)</td>
        <td class="px-6 py-4 text-slate-500">Phải dùng que chọc SIM và thay đổi thẻ vật lý</td>
      </tr>
      <tr>
        <td class="px-6 py-4 font-semibold text-slate-800">Khả năng mất SIM gốc</td>
        <td class="px-6 py-4 text-emerald-600 font-semibold">Không (Giữ nguyên SIM gốc trong máy)</td>
        <td class="px-6 py-4 text-amber-600 font-semibold">Có (Dễ thất lạc thẻ SIM Việt Nam)</td>
      </tr>
      <tr>
        <td class="px-6 py-4 font-semibold text-slate-800">Thời gian nhận hàng</td>
        <td class="px-6 py-4 text-emerald-600 font-semibold">Trong 5 phút qua Email (24/7)</td>
        <td class="px-6 py-4 text-slate-500">Phải chờ ship COD hoặc nhận tại sân bay</td>
      </tr>
      <tr>
        <td class="px-6 py-4 font-semibold text-slate-800">Độ tương thích máy</td>
        <td class="px-6 py-4 text-amber-600 font-semibold">Chỉ hỗ trợ điện thoại thế hệ mới</td>
        <td class="px-6 py-4 text-emerald-600 font-semibold">Hỗ trợ 100% tất cả các loại điện thoại</td>
      </tr>
    </tbody>
  </table>
</div>
<h2 class="text-2xl font-bold text-slate-800 mt-8">Đánh giá chung: Bạn nên chọn loại nào?</h2>
<p class="text-slate-600 leading-relaxed">Nếu điện thoại của bạn hỗ trợ eSIM (các dòng máy sản xuất từ năm 2020 trở lại đây), chúng tôi khuyên bạn nên lựa chọn <strong>eSIM</strong> vì sự tiện ích, tốc độ nhận gói cước ngay lập tức và tính an toàn tuyệt đối cho khay SIM gốc Việt Nam. Đối với các dòng máy cũ hơn, <strong>SIM vật lý</strong> vẫn là lựa chọn bắt buộc giúp kết nối internet ổn định suốt hành trình.</p>',
  '/images/blog_image_3.png',
  'Trần Minh Tuấn',
  'published',
  '2026-06-15 00:00:00+07'
),
(
  (select id from public.blog_categories where slug = 'travel'),
  'Kinh nghiệm mua và sử dụng eSIM tại Nhật Bản: Những điều cần lưu ý',
  'kinh-nghiem-esim-tai-nhat-ban',
  'Giúp bạn tránh những lỗi thường gặp khi thiết lập kết nối mạng Docomo/SoftBank tại xứ sở mặt trời mọc.',
  '<p class="text-left text-slate-600 leading-relaxed">Hướng dẫn chi tiết về cách kích hoạt eSIM tại Nhật Bản và kết nối sóng nhà mạng Docomo / SoftBank...</p>',
  '/images/blog_image_4.png',
  'Lê Hoàng Hải',
  'published',
  '2026-06-14 00:00:00+07'
),
(
  (select id from public.blog_categories where slug = 'travel'),
  'Top 5 ứng dụng hữu ích nhất khi du lịch nước ngoài cần kết nối Internet',
  'top-5-ung-dung-du-lich-nuoc-ngoai',
  'Từ bản đồ số, dịch thuật trực tiếp đến các app gọi xe công nghệ tại khu vực Đông Nam Á và Châu Âu.',
  '<p class="text-left text-slate-600 leading-relaxed">Danh sách 5 ứng dụng đắc lực nhất giúp chuyến hành trình tự túc nước ngoài của bạn trở nên trơn tru nhất...</p>',
  '/images/blog_image_5.png',
  'Nguyễn Thị Vy',
  'published',
  '2026-06-12 00:00:00+07'
),
(
  (select id from public.blog_categories where slug = 'guides'),
  'Danh sách điện thoại hỗ trợ eSIM mới nhất năm 2026',
  'danh-sach-dien-thoai-ho-tro-esim-2026',
  'Cách tra cứu xem thiết bị iPhone, Samsung, Xiaomi của bạn có tích hợp vi mạch eSIM để mua sắm an tâm hơn.',
  '<p class="text-left text-slate-600 leading-relaxed">Bảng tổng hợp chi tiết tất cả các mẫu điện thoại tích hợp sẵn chip eSIM mới nhất hiện nay...</p>',
  '/images/blog_image_6.png',
  'Kỹ thuật viên SIMDULICH.VN',
  'published',
  '2026-06-10 00:00:00+07'
);
