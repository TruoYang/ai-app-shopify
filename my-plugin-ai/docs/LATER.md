# Việc để sau

Danh sách việc đã biết nhưng chưa làm, kèm lý do. Cập nhật khi xong việc nào thì xóa dòng đó.

## Kiểm tra thủ công (cần dev server + trình duyệt)

- [ ] **Trang Insights:** mở admin → SmartCart RCM → Insights.
  - Kiểm tra trang hiện đúng với Data = "Simulated replay" (dữ liệu replay đã có trong DB).
  - Bấm thử "Run replay", "A/A check", "Delete simulated data".
- [ ] **Sự kiện thật từ widget:**
  - Trên store, xem widget, bấm 1 gợi ý, Add to cart 1 gợi ý.
  - Kiểm tra bảng `RecommendationEvent` có dòng `simulated = false` (impression, click, add_to_cart).
- [ ] **Ghi nhận đơn hàng:**
  - Đặt 1 đơn test (Bogus Gateway) có sản phẩm thêm từ widget.
  - Kiểm tra webhook `orders/paid` tạo sự kiện `purchase` có `recValue`.
- [ ] **A/B live:**
  - Bật A/B trên trang Insights.
  - Mở store ở 2–3 trình duyệt / cửa sổ ẩn danh, kiểm tra có khách rơi vào nhóm "control" (chỉ thấy sản phẩm bán chạy).
- [ ] **Song ngữ:** đổi ngôn ngữ admin sang Tiếng Việt, xem lại các trang.
- [ ] **Giảm giá khi mua cùng (Discount Function):**
  - Bước 1: ở trang Rules, đặt "Discount %" cho 1 luật (ví dụ 10%).
  - Bước 2: kiểm tra Shopify admin → Discounts có discount tự động "SmartCart bundle discount".
  - Bước 3: trên store, thêm sản phẩm điều kiện và sản phẩm gợi ý vào giỏ, kiểm tra giỏ / checkout giảm đúng %.
  - Widget hiện nhãn "-10% khi mua cùng" trên gợi ý đó.
- [ ] **GDPR webhook:** chạy `shopify app webhook trigger` cho `customers/redact` và `shop/redact` (sau khi deploy), kiểm tra dữ liệu bị xóa đúng.

## Cần bạn tự làm

- [ ] **Khởi động lại dev ngay:** dừng `shopify app dev`, chạy `npx prisma generate`, rồi chạy lại dev.
  - Migration ngôn ngữ đã vào DB nhưng Prisma client chưa sinh lại, vì file bị dev server khóa.
  - Nếu chưa làm, trang admin sẽ báo lỗi.
- [ ] **Chấp nhận quyền mới:** app xin thêm quyền `read_discounts` và `write_discounts` (cho mã giảm giá thật). Khi mở app trong admin, Shopify sẽ hỏi cấp quyền: bấm đồng ý.
- [ ] Commit các thay đổi mới (gồm 4 migration mới: csv reference, events, replay summary, admin language).
- [ ] Deploy lên Render: xem `docs/DEPLOY.md`.
- [ ] `shopify app deploy`:
  - Đưa widget mới (sự kiện, A/B) lên store.
  - Áp dụng webhook `orders/paid`, `app/uninstalled` và các webhook GDPR.
- [ ] Dữ liệu VN_Fashion_data: vẫn chờ tác giả duyệt quyền truy cập.

## Tính năng chưa làm

- [ ] **Bản dịch tiếng Việt cho storefront:**
  - Tên sản phẩm (`titleVi` đã có trong catalog) qua Translate & Adapt hoặc Translations API.
  - Chữ của widget (locales `vi.json`).
- [ ] **Deploy 24/7:**
  - Chuyển SQLite sang Postgres.
  - Chọn host rẻ (Fly.io / Render / Railway) và tạo tài khoản.
  - Đặt biến môi trường, cập nhật `application_url`.
  - Cần bạn chọn nhà cung cấp và tạo tài khoản.
- [ ] **Huấn luyện chạy nền:**
  - Hiện tại train chạy trong 1 request (khoảng 30 s với FP-Growth).
  - Khi deploy thật nên chuyển sang job nền và thêm trạng thái "đang train".

## Giới hạn cần ghi trong báo cáo

- Dữ liệu demo là mô phỏng: cấu trúc giỏ hàng thật (UCI), sản phẩm của shop.
- Kết quả A/B hiện tại đến từ replay với mô hình khách giả định (`docs/eval/AB_TEST.md`).
