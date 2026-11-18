# Deploy lên Render (gói free)

App chạy trên Render bằng Docker (Node + Python) với Postgres. Máy local vẫn dùng SQLite như cũ.

## Đã chuẩn bị sẵn trong code

| File | Vai trò |
|---|---|
| `../render.yaml` (gốc repo) | Blueprint: tạo web service `smartcart-rcm` và database `smartcart-db`, gói free, vùng Singapore |
| `Dockerfile` | Build app, cài Python (không có PyTorch), chạy migration Postgres khi khởi động |
| `prisma/postgres/` | Schema và migration cho Postgres (sinh từ `prisma/schema.prisma`) |
| `scripts/db/copy-to-postgres.mjs` | Chép dữ liệu của shop từ SQLite local lên Postgres |
| `ml/requirements-server.txt` | Thư viện Python cho server |

## Các bước

### 1. Đưa code lên GitHub

Commit toàn bộ thay đổi và push lên `origin` (repo `ai-app-shopify`). Render lấy code từ GitHub.

### 2. Tạo tài khoản Render

Vào https://render.com và đăng ký bằng GitHub. Gói free không cần thẻ.

### 3. Tạo app từ Blueprint

1. Vào Dashboard, chọn **New** → **Blueprint**.
2. Chọn repo `ai-app-shopify`, nhánh `main`. Render đọc file `render.yaml`.
3. Render hỏi 2 giá trị:
   - `SHOPIFY_API_KEY`: chính là `client_id` trong `my-plugin-ai/shopify.app.toml`.
   - `SHOPIFY_API_SECRET`: lấy ở Shopify Partner Dashboard (Dev Dashboard) → app **SmartCart RCM** → **Client credentials** → Client secret. Không dán giá trị này vào chat hay commit lên git.
4. Bấm **Apply**.
5. Chờ build lần đầu, khoảng 10–15 phút.
6. Khi log có dòng `[react-router-serve] http://localhost:3000` là app đã chạy.
7. Ghi lại URL dạng `https://smartcart-rcm-xxxx.onrender.com`.

### 4. Trỏ Shopify sang Render

1. Sửa 3 chỗ trong `shopify.app.toml` thành URL Render (hoặc gửi URL để AI sửa):
   - `application_url = "https://<url-render>"`
   - `redirect_urls = [ "https://<url-render>/api/auth" ]`
   - Trong `[app_proxy]`: `url = "https://<url-render>/apps/ai"`
2. Chạy `shopify app deploy`. Lệnh này đưa lên Shopify:
   - URL mới.
   - Widget mới và Discount Function.
   - Webhooks (orders/paid, GDPR).
   - Quyền mới (discounts).
3. Mở app trong Shopify admin. Nếu Shopify hỏi cấp quyền mới thì đồng ý.

### 5. Chép dữ liệu lên Postgres

1. Vào Render → `smartcart-db` → **Connections** → copy **External Database URL**.
2. Chạy trong PowerShell, thư mục `my-plugin-ai`:

```powershell
$env:PG_URL = "<External Database URL>"
npm run db:copy-to-postgres -- --shop my-favsion.myshopify.com
Remove-Item Env:PG_URL
```

Script chép các bảng sau (khoảng 80.000 dòng):
- phiên đăng nhập;
- cài đặt;
- dữ liệu CSV và bảng khớp sản phẩm;
- đơn hàng;
- 50.000 luật;
- dữ liệu replay.

Có thể chạy lại script nhiều lần: dữ liệu cũ của shop trên Postgres sẽ bị xóa trước khi chép.

### 6. Kiểm tra

- **Admin:** mở app. Kiểm tra các trang Gợi ý / Luật / Dữ liệu / Hiệu quả có dữ liệu.
- **Store:** mở một sản phẩm và giỏ hàng, xem widget.

## Lưu ý khi dùng gói free

- **App ngủ** sau 15 phút không có truy cập. Lần mở đầu tiên mất khoảng 1 phút, widget có thể không hiện ở lượt đó.
  - Trước khi demo, mở URL Render một lần để đánh thức app.
- **Postgres free hết hạn sau 30 ngày** kể từ ngày tạo (còn 14 ngày gia hạn), và không có backup.
  - Khi hết hạn: nâng cấp lên gói trả phí (khoảng 6 $/tháng), hoặc tạo database mới rồi chạy lại bước 5.
- **Train trên server:**
  - Máy free có ít RAM và không có PyTorch.
  - FP-Growth và Item-kNN có thể chạy. DEC/Hybrid, hoặc khi thiếu RAM, sẽ tự chuyển sang Apriori (JS).
  - Cách chắc chắn nhất: train ở máy local, rồi chạy lại bước 5 để chép luật lên.
- **Lịch train tự động** chỉ chạy khi app đang thức.
- **Không chạy `shopify app dev`** khi đang dùng bản deploy: lệnh đó đổi URL của app sang tunnel local. Nếu đã chạy dev, chạy lại `shopify app deploy` để trả URL về Render.

## Khi đổi schema database

1. Sửa `prisma/schema.prisma` và tạo migration SQLite như bình thường (`npx prisma migrate dev`).
2. Chạy `npm run db:pg-schema` để sinh lại `prisma/postgres/schema.prisma`.
3. Tạo migration Postgres. Ví dụ đặt tên thư mục `0002_ten`:

```bash
npx prisma migrate diff --from-migrations prisma/postgres/migrations --to-schema-datamodel prisma/postgres/schema.prisma --shadow-database-url "<một Postgres trống>" --script > prisma/postgres/migrations/0002_ten/migration.sql
```

Server tự chạy migration mới khi khởi động.
