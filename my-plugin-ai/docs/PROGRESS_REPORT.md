# Báo cáo tiến độ: SmartCart RCM (ứng dụng gợi ý sản phẩm cho Shopify)

Cập nhật: 05/11/2026

## 1. Tóm tắt

| Hạng mục | Trạng thái |
| --- | --- |
| Shop demo thực tế (thời trang, 452 sản phẩm, 300 đơn hàng, 274 khách hàng) | Xong |
| Lõi gợi ý mới + widget trên trang chủ / sản phẩm / giỏ hàng | Xong |
| Import CSV linh hoạt + khớp sản phẩm CSV với sản phẩm shop | Xong |
| Trang quản lý luật dạng thẻ sản phẩm, có bộ lọc | Xong |
| Thuật toán mới (FP-Growth, item-kNN, DEC, Hybrid) + đánh giá offline | Xong |
| Tự động train lại theo tuần/tháng, ưu tiên xếp hạng cho chủ shop | Xong |
| Đo lường online (sự kiện, dashboard, A/B test) | Chưa làm (Phase 5) |
| Song ngữ, mã giảm giá thật, deploy 24/7 | Chưa làm (Phase 6) |
| Sơ đồ quy trình cho báo cáo | Chưa làm (Phase 7) |

## 2. Shop demo (`my-favsion.myshopify.com`)

- **452 sản phẩm, 1.854 SKU, ảnh thật**:
  - 233 sản phẩm thời trang từ bộ Fashion Product Images (Kaggle / Marqo KAGL).
  - **219 sản phẩm phong cách châu Á** từ bộ Tstars-VTON của Taobao/Tmall: áo, áo khoác, quần, chân váy, đầm, sườn xám, giày, túi, mũ.
- Có size, giá, giá giảm và mô tả chi tiết (thông số, bảng size, cách phối, giao hàng). Mỗi sản phẩm có 9 metafield thuộc tính.
- 12 collection tự động (Women, Men, **Asia Edit**, Tops, Shoes, Sale…) và menu điều hướng.
- Theme Horizon:
  - Widget gợi ý ở trang chủ, trang sản phẩm và trang giỏ hàng.
  - Cart drawer có thêm nút "View cart".
- **300 đơn hàng và 274 khách hàng trên Shopify** (admin → Orders, Customers), tạo từ lịch sử CSV:
  - Mỗi mã khách hàng trong CSV thành một khách hàng Shopify, có tag `uci-<mã gốc>`. Tên là dữ liệu mô phỏng, khoảng một nửa tên Việt, một nửa tên nước ngoài. Email dùng tên miền `example.com`.
  - Đơn giữ ngày đặt gốc, đã thanh toán, có tag `csv-demo` và ghi chú nguồn, không gửi email.
  - Khi train, app bỏ qua đơn `csv-demo` để không đếm trùng (các đơn này đã có trong dữ liệu CSV). Đơn của khách thật được đồng bộ bình thường.
  - App đã khai báo quyền truy cập dữ liệu khách hàng (Protected customer data) với Shopify.
- Giao diện:
  - Mọi danh sách sản phẩm dùng ảnh tỉ lệ 3:4 để tên và giá thẳng hàng.
  - "You may also like" hiện 10–12 sản phẩm.
- Mọi thứ được tạo bằng script nên dựng lại được từ đầu (`scripts/catalog`, `scripts/demo`, `docs/SETUP_FASHION_STORE.md`).

## 3. Lõi gợi ý và widget

- **Gợi ý theo từng món trong giỏ**: 1 món được 5 gợi ý, 2 món mỗi món 3 gợi ý, 3–4 món mỗi món 2, từ 5 món mỗi món 1. Luật kết hợp (A + B → C) được ưu tiên.
- **Gom theo sản phẩm gốc**: các size của cùng một sản phẩm được tính là một sản phẩm.
- **Giữ 1–2 gợi ý cũ** khi giỏ hàng thay đổi. Cache trên trình duyệt nên hiện ngay, cập nhật ngầm.
- **Gợi ý dự phòng** để widget không bao giờ trống: cùng loại sản phẩm, rồi đơn hàng gần nhất, bán chạy, hàng mới.
- Nút **Add to cart** ngay trong widget, cập nhật cart drawer.
- **Giao diện widget**:
  - Thẻ sản phẩm có nhãn giảm giá (-25%) và giá khuyến mãi màu đỏ.
  - **Nhãn lý do gợi ý** trên ảnh cho gợi ý dự phòng: "Best seller", "Trending", "New in", "Similar style".
  - Thanh **"Complete the look"**: thêm 3 gợi ý đầu vào giỏ chỉ bằng một lần bấm.
  - Khách tự chọn kích thước thẻ (lớn / vừa / nhỏ).
  - Sản phẩm xếp ngang hết chiều rộng trang.
- Widget gọi app qua **Shopify App Proxy** (`/apps/ai/recommend`), không phụ thuộc URL tunnel.
- Train **không còn xóa luật do chủ shop tạo**, và giữ các chỉnh sửa (tắt luật, discount) trên luật của mô hình.

## 4. Dữ liệu lịch sử đơn hàng

- **Trang Data**:
  - Upload CSV bất kỳ, xem trước 10 dòng, chọn vai trò từng cột.
  - Vai trò được đoán sẵn theo tên cột tiếng Anh, tiếng Việt và file export của Shopify.
  - Tự nhận dấu phân cách và định dạng ngày.
  - Chọn ghi đè hoặc cộng dồn với dữ liệu cũ.
- **Trang "Match products in shop"**: khớp từng sản phẩm CSV với một sản phẩm shop (1–1), có tìm kiếm và lọc.
- **Khoảng thời gian train**: tất cả, N tháng gần nhất, hoặc từ ngày đến ngày, để loại đơn quá cũ.
- Hiệu năng: 541.909 dòng CSV ra 20.728 đơn trong khoảng 4 giây.

**Dữ liệu demo hiện tại** (mô phỏng): đơn hàng thật của bộ UCI Online Retail (cửa hàng quà tặng UK). 452 sản phẩm CSV bán chạy nhất được khớp tự động với 452 sản phẩm shop. Cấu trúc mua kèm là thật, còn sản phẩm được gán là sản phẩm thời trang của shop. Khi khớp, các món hay mua cùng nhau được giữ cùng giới tính và rơi vào các nhóm hàng bổ trợ nhau. Sau khi train bằng FP-Growth được 50.000 luật, ví dụ:

| Giỏ hàng | Gợi ý (tỉ lệ đơn mua kèm) |
| --- | --- |
| Áo nữ | Chân váy hồng (66%), đầm trắng (38%), giày cao gót xám (36%), túi xách xám (31%) |
| Túi xách nữ | Áo xanh lá (75%), đầm sát nách (63%), giày cao gót (49%) |

**Lưu khách hàng**: bảng `OrderHistory` có thêm `customerId` và `lines` (sản phẩm, số lượng, giá). Import CSV và đồng bộ đơn Shopify đều lưu các trường này, để làm nền cho gợi ý theo khách hàng và thống kê doanh thu.

**Trang Rules** (thay cho popup "Choose rules" cũ):
- Mỗi luật hiển thị dạng *sản phẩm trong giỏ → sản phẩm gợi ý*, với thẻ có ảnh, tên, SKU, giá. Bấm vào thẻ thì mở trang sản phẩm.
- Bộ lọc: kiểu luật (1 → 1, 2 → 1), loại (combo khác nhóm hàng, hoặc gợi ý áo / quần / giày…), giới tính, nguồn, trạng thái. Bấm **Execute** để áp dụng tất cả bộ lọc cùng lúc.
- Sắp xếp theo priority, độ tin cậy, số đơn.
- Chỉnh discount và priority, bật/tắt, xóa luật. Thêm luật thủ công.

## 5. Thuật toán và đánh giá (đóng góp nghiên cứu)

Baseline cũ là luật kết hợp kiểu Apriori. Thêm 4 hướng mới: **FP-Growth**, **Item-kNN**, **DEC (Deep Embedded Clustering, học sâu)** và **Hybrid** (Reciprocal Rank Fusion của FP-Growth + kNN + DEC).

**Phương pháp ("thử hệ thống 1000 lần")**:
1. Chia đơn theo thời gian: 80% cũ để train, 20% mới để test.
2. Mỗi đơn test: một nửa số món (tối đa 5) làm giỏ hàng, nửa còn lại là món khách thật sự mua thêm.
3. Đo xem gợi ý tìm ra được bao nhiêu món đó.
4. Lấy 1.000 giỏ × 3 lần lặp, báo trung bình ± độ lệch chuẩn.

| Thuật toán | HitRate@10 | Precision@10 | NDCG@10 | MRR@10 | Độ phủ catalog |
|---|---|---|---|---|---|
| Popularity | 0.322 | 0.052 | 0.064 | 0.147 | 0.3% |
| Apriori (baseline) | 0.745 | 0.184 | 0.259 | 0.472 | 28.4% |
| **FP-Growth** | **0.782** | **0.208** | **0.288** | 0.508 | 36.2% |
| Item-kNN | 0.726 | 0.176 | 0.253 | 0.471 | 37.6% |
| DEC | 0.679 | 0.157 | 0.230 | 0.446 | 34.6% |
| Hybrid | 0.774 | 0.202 | 0.284 | **0.518** | 37.3% |

**Kết luận**:
- **FP-Growth tốt hơn baseline** ở mọi chỉ số độ chính xác: HitRate +5%, Precision +13%, NDCG +11%. Độ phủ catalog tăng từ 28% lên 36%. Chênh lệch lớn hơn nhiều lần độ lệch chuẩn.
- **DEC đứng riêng thì kém baseline.** Phân cụm sâu gom các sản phẩm *giống nhau*, còn bài toán là tìm sản phẩm *mua cùng nhau*. DEC hợp với gợi ý "sản phẩm tương tự" và sản phẩm mới. Trong Hybrid, DEC giúp tăng độ đa dạng mà không giảm độ chính xác.
- Hybrid có MRR cao nhất (gợi ý đúng xuất hiện sớm nhất) và luôn có gợi ý.

Chi tiết, biểu đồ và các giới hạn của đánh giá: `docs/eval/README.md`, `docs/eval/metrics_at_10.png`.

**Trong app**: chủ shop chọn thuật toán ngay trên trang Data. App gọi tiến trình Python để train; nếu Python lỗi thì tự quay về Apriori bằng JS. Ngoài ra chủ shop chọn được:
- **Ưu tiên xếp hạng**: doanh thu, số lượng bán hoặc tương tác.
- **Tự động train lại**: hàng tuần hoặc hàng tháng.

## 6. Việc tiếp theo

1. **Phase 5**: ghi nhận sự kiện widget (xem, bấm, thêm giỏ, mua) để đánh giá online. Dashboard cho chủ shop. A/B test giữa hai thuật toán.
2. **Phase 6**: admin song ngữ Việt/Anh và bản dịch tiếng Việt cho storefront; mã giảm giá thật ở checkout (Discount Function); bảo mật, webhook GDPR; deploy 24/7.
3. **Phase 7**: sơ đồ kiến trúc và các luồng (train, gợi ý, import CSV, tự động train), bản tiếng Anh và tiếng Việt.
4. Dữ liệu thương hiệu Việt Nam (YODY, Aristino, Canifa): đang chờ tác giả bộ dữ liệu VN_Fashion_data duyệt quyền truy cập.

## 7. Cách demo

```powershell
cd C:\Users\giang\ai-app-shopify\my-plugin-ai
shopify.cmd app dev --store my-favsion.myshopify.com --store-password stylise
```

- Storefront: https://my-favsion.myshopify.com (mật khẩu `stylise`). Mở một sản phẩm, thêm vào giỏ và xem widget.
- Admin app: Apps → SmartCart RCM, gồm 3 trang:
  - **Trang chủ:** Train.
  - **Rules:** xem và lọc luật.
  - **Data:** import CSV, khớp sản phẩm, cài đặt train.
- Admin shop: **Orders** (300 đơn) và **Customers** (274 khách).
- Kịch bản gợi ý cho storefront:
  1. Mở một áo nữ trong *Asia Edit*.
  2. Add to cart.
  3. Vào /cart, xem "Complete your look" và nút "Add all".
  4. So sánh với luật tương ứng trên trang Rules.
