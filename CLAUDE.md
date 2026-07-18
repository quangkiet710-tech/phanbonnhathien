Luôn trả lời bằng tiếng Việt. Viết commit message bằng tiếng Việt. Dự án: app POS cho cửa hàng phân bón Phân Bón Nhật Hiền, toàn bộ nằm trong một file index.html, deploy tự động lên Vercel qua GitHub.

TUYỆT ĐỐI KHÔNG được ghi, sửa, xóa hay khôi phục dữ liệu trên Supabase và localStorage của người dùng trong bất kỳ tình huống nào, kể cả khi thấy kho trống — kho trống có thể là chủ ý của người dùng. Khi test tính năng chỉ được dùng dữ liệu giả trong môi trường test, không đụng database thật. Nếu nghi ngờ về trạng thái dữ liệu thì HỎI, không tự hành động.

---

## 5 PRIORITY PHÁT TRIỂN APP

### P1: Sổ bán hàng hàng ngày (Daily Sales Entry)
**Mục đích:** Backup dữ liệu bán từ sổ tay, không nhập qua POS ngay. Dùng để đối chiếu tồn kho sau.

**Database:**
- Table `dailySales`: `[{id, date, items:[{productId, name, qty, unit, price}], totalAmount, note}]`

**Giao diện:**
- Page admin: "Bán hàng" > "Sổ bán hàng" (sidebar)
- Form nhập:
  - Chọn ngày (default: hôm nay)
  - Thêm sản phẩm:
    - Dropdown autocomplete sản phẩm (gõ tên → suggestion)
    - Chọn unit (Bao/Kg/...)
    - Input số lượng
    - Input giá bán (có thể khác giá niêm yết)
    - Button xóa dòng
  - Button "Thêm dòng"
  - Tính tổng tiền realtime
  - Input ghi chú (optional)
  - Button "Lưu sổ bán"

- Table hiển thị lịch sử:
  - Ngày | Sản phẩm (list) | Số lượng | Tổng tiền | Ghi chú
  - Có thể xóa/sửa dòng

**Quy tắc:**
- KHÔNG chọn khách (vì bán khách lẻ, không ghi lại được ai)
- KHÔNG trừ tồn kho (chỉ ghi nhận "đã bán")
- Lưu vào localStorage + Supabase

---

### P2: Công nợ nhà cung cấp (Supplier Debt)
**Mục đích:** Track tiền mua hàng từ NCC chưa trả.

**Database:**
- Mở rộng `stockImports`: thêm field `paid` (tiền đã trả), `debt` (còn nợ)

**Giao diện:**
- Page admin: "Nợ NCC" (sidebar mới trong section "Khách hàng" hoặc "Kho & Hàng hóa")
- Hiển thị:
  - Danh sách NCC (từ tất cả phiếu nhập)
  - Tổng tiền nhập (all time)
  - Tổng đã trả
  - Còn nợ
  - Button "Thu nợ"
  
- Modal "Thu nợ":
  - Hiển thị: NCC | Tổng nợ
  - Input số tiền thu
  - Button "Xác nhận"
  - Update `paid += số tiền`, `debt -= số tiền`

- Table lịch sử phiếu nhập chưa trả hết

**Quy tắc:**
- Mỗi phiếu nhập (stockImports) mặc định: `paid=0, debt=total`
- Khi save phiếu nhập mới → auto tính

---

### P3: Giá nhập & giá bán theo ngày (Price History)
**Mục đích:** Track biến động giá → tính lãi/lỗ chính xác.

**Database:**
- Table `priceHistory`: `[{id, date, productId, productName, costPrice, salePrice}]`

**Auto ghi khi:**
- Nhập kho (stockImports): `{date, productId, costPrice: item.cost, salePrice: 0}`
- Bán hàng (dailySales): `{date, productId, costPrice: product.cost, salePrice: item.price}`
- Bán qua POS: `{date, productId, costPrice: product.cost, salePrice: item.price}`

**Giao diện:**
- Page admin: "Lịch sử giá" (sidebar)
- Form:
  - Chọn sản phẩm (dropdown)
  - Chọn ngày range (from-to)
  - Button "Xem"
  
- Table kết quả:
  - Ngày | Giá vốn | Giá bán | Lệch giá
  - Sắp xếp theo ngày mới nhất

- (Optional) Chart giá theo timeline

---

### P4: Đối chiếu tồn kho (Inventory Reconciliation)
**Mục đích:** So sánh tồn lý thuyết (app tính) vs tồn thực tế (sư huynh đếm).

**Tính tồn lý thuyết:**
- Nhập = tổng từ `stockImports`
- Bán = tổng từ `invoices` + `dailySales` + `custOrders`
- Tồn lý thuyết = Nhập - Bán

**Giao diện:**
- Page admin: "Đối chiếu tồn kho" (sidebar)
- Table:
  - Sản phẩm | Tồn lý thuyết | Tồn thực tế | Chênh lệch | Status
  
- Form nhập tồn thực tế:
  - Chọn sản phẩm (dropdown)
  - Input số lượng đếm được
  - Button "Lưu"
  - Auto tính chênh lệch

- Status badge:
  - ✅ Xanh: chênh <5%
  - ⚠️ Cam: chênh 5-20%
  - ❌ Đỏ: chênh >20%

- Alert nếu chênh lệch quá lớn → cần kiểm tra lại

- Sau khi xác nhận → update `products[x].stock` = tồn thực tế

---

### P5: Tối ưu form nhập bán hàng (Quick Entry)
**Mục đích:** Làm form dailySales dễ nhập, nhanh chóng.

**Improvements:**
- Autocomplete sản phẩm: gõ tên → hiển thị suggestion (tối đa 6 kết quả)
- Quick unit button: hiển thị unit đã dùng của SP (Bao/Kg/...)
- Stock warning: nếu nhập vượt tồn kho → badge ⚠️ "Vượt tồn X bao"
- Realtime total: tính tổng tiền khi nhập

- Keyboard shortcut:
  - Enter trên qty → focus lên dòng tiếp
  - Tab ở qty cuối → auto thêm dòng mới

---

## Nguyên tắc thực hiện

1. ✅ Giữ toàn bộ feature cũ (POS, hóa đơn, khách hàng, công nợ khách, sản phẩm, nhập kho, nhập batch, dashboard, đơn online) - không xóa/sửa
2. ✅ Single HTML file - không tách component
3. ✅ localStorage + Supabase sync (dùng js/supabase-sync.js hiện tại)
4. ✅ Không động dữ liệu cũ của sư huynh
5. ✅ Thêm menu sidebar mới cho P1, P2, P4 (giữ layout hiện tại)
6. ✅ Dark theme giống app hiện tại

## Lộ trình code

1. P1: Sổ bán hàng (phức tạp nhất)
2. P2: Công nợ NCC (nhỏ, mở rộng stockImports)
3. P3: Giá theo ngày (auto ghi, không UI phức tạp)
4. P4: Đối chiếu tồn kho (moderate)
5. P5: Tối ưu form (small improvements)
