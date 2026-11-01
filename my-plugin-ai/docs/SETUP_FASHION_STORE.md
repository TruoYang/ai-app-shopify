# Tạo shop thời trang demo (Aurelia)

Tài liệu này hướng dẫn tạo một development store mới và đổ vào đó 233 sản phẩm thời trang có ảnh thật, size, giá và collection, thay cho các sản phẩm mẫu (snowboard, gift card…).

## Shop sẽ có gì

| Hạng mục | Số lượng |
| --- | --- |
| Sản phẩm | 233 (Nam 101, Nữ 121, Unisex 11) |
| Biến thể (SKU) | 931 (size áo S–XXL / XS–XL, size quần theo vòng eo, size giày US) |
| Nhóm | Tops 60, Bottoms 41, Shoes 42, Accessories 34, Bags 21, Hats & Caps 16, Dresses 10, Outerwear 9 |
| Collection tự động | Women, Men, Tops, Outerwear, Bottoms, Dresses, Shoes, Bags, Hats & Caps, Accessories, Sale |

55 sản phẩm (khoảng 24%) đang giảm giá (có giá gạch ngang) và gắn tag `Sale`.

- **Dữ liệu gốc:** [Marqo/KAGL](https://huggingface.co/datasets/Marqo/KAGL), bản Hugging Face của bộ *Fashion Product Images* trên Kaggle (44.434 sản phẩm, ảnh 1800×2400). Script lấy ảnh, màu, giới tính, loại sản phẩm, mùa và mục đích sử dụng từ bộ này.
- **Phần script tự sinh:** tên sản phẩm (đã bỏ tên thương hiệu), giá USD theo từng loại, size, chất liệu, form dáng, hướng dẫn giặt. Kết quả sinh ra luôn giống nhau mỗi lần chạy.
- **Lọc thương hiệu:** đã bỏ các sản phẩm của thương hiệu thể thao/bản quyền lớn (Nike, Adidas, Puma, các CLB bóng đá, Disney…) để ảnh ít logo. Ảnh vẫn là ảnh sản phẩm của Myntra, chỉ phù hợp cho demo hoặc đồ án. Nếu bán hàng thật thì phải thay ảnh.

**Quy tắc đặt SKU:**

```text
AUR-<NHÓM>-<itemId>-<SIZE>    ví dụ AUR-TOP-8558-M
AUR-<NHÓM>-<itemId>           sản phẩm một size (mũ, ví, kính…)
```

`AUR-TOP-8558` là mã gốc của sản phẩm (base SKU). Danh sách đầy đủ nằm ở `data/catalog/fashion-catalog-skus.csv`, dùng ở bước khớp SKU với file CSV lịch sử đơn hàng.

## Các bước

Tất cả lệnh đều chạy trong thư mục `my-plugin-ai`.

### 1. Tạo development store mới

1. Vào Shopify Dev Dashboard / Partner Dashboard, chọn **Stores**, rồi **Add store / Create store**, chọn **Development store**.
2. Đặt tên, ví dụ `aurelia-fashion`. **Không** tick ô tạo dữ liệu mẫu (test data).
3. Ghi lại domain, ví dụ `aurelia-fashion.myshopify.com`.

### 2. Cài app vào store mới (đã thêm quyền ghi sản phẩm)

`shopify.app.toml` đã được thêm các scope `write_products`, `read_publications`, `write_publications`.

```powershell
shopify.cmd app dev --store aurelia-fashion.myshopify.com
```

Sau đó:

- Mở **App Preview URL** mà CLI in ra, rồi cài app và chấp nhận các quyền mới. Bước này lưu offline token của store vào `prisma/dev.sqlite`.
- Giữ terminal này chạy.

Nếu CLI vẫn chọn store cũ, chạy `shopify.cmd app dev --reset` rồi chọn lại store.

### 3. Tải ảnh sản phẩm (chỉ cần một lần trên mỗi máy)

```powershell
npm.cmd run catalog:images
```

Lệnh này tải khoảng 0,5 GB dữ liệu parquet và lưu 233 ảnh (khoảng 77 MB) vào `data/catalog/images/`. Thư mục này đã được gitignore.

### 4. Đổ sản phẩm vào shop

Mở một terminal khác:

```powershell
npm.cmd run catalog:seed -- --shop aurelia-fashion.myshopify.com --dry-run
npm.cmd run catalog:seed -- --shop aurelia-fashion.myshopify.com
```

- Mất khoảng 5–10 phút.
- Mỗi sản phẩm sẽ được upload ảnh, tạo đủ biến thể, đặt trạng thái Active và publish lên Online Store. Sau đó script tạo 11 collection tự động.
- Chạy lại lệnh sẽ bỏ qua các sản phẩm đã có (so theo handle). Thêm `--update` nếu muốn ghi đè, hoặc `--limit 5` để thử với vài sản phẩm.
- Kết quả (product ID, variant ID theo SKU) được ghi vào `data/catalog/seed-result-<shop>.json`.

### 5. Giao diện shop (theme Horizon)

Bản sao theme đang chạy nằm ở thư mục `store-theme/` (ngoài `my-plugin-ai`). Những gì đã chỉnh so với Horizon gốc:

| File | Thay đổi |
| --- | --- |
| `templates/index.json` | Hero 2 ảnh, widget **AI recommendations** ngay dưới hero, 3 danh sách sản phẩm Women / Men / Sale (8 sản phẩm mỗi danh sách) |
| `templates/cart.json` | Widget **AI recommendations** ngay dưới giỏ hàng |
| `snippets/cart-summary.liquid` | Thêm nút **View cart** (mở trang `/cart`) dưới nút Check out, chỉ hiện trong cart drawer |

Đẩy lại theme sau khi sửa (lệnh này ghi đè các file được chỉ định trên theme live):

```powershell
cd C:\Users\giang\ai-app-shopify\store-theme
shopify.cmd theme push --store my-favsion.myshopify.com --theme 195754328358 --only templates/index.json --only templates/cart.json --only snippets/cart-summary.liquid --allow-live
```

Nếu sau này bạn chỉnh trong theme editor trên admin, chạy `shopify.cmd theme pull --store my-favsion.myshopify.com --live` trước khi sửa file, để không ghi đè mất các chỉnh sửa đó.

Lưu ý: dev store luôn có mật khẩu storefront (Online Store, Preferences, Password protection). CLI cần mật khẩu này khi chạy `shopify app dev`.

## Chạy lại từ đầu (tuỳ chọn)

```powershell
npm.cmd run catalog:fetch    # tải metadata 44k sản phẩm (~11 MB) vào data/catalog/kagl-metadata.json
npm.cmd run catalog:build    # sinh data/catalog/fashion-catalog.json và fashion-catalog-skus.csv
npm.cmd run catalog:images   # tải ảnh
```

Có thể chỉnh số lượng sản phẩm theo từng loại (`SELECTION`), khoảng giá (`TYPES`) và tên thương hiệu (`STORE_BRAND`) ở đầu file `scripts/catalog/build-fashion-catalog.mjs`.
