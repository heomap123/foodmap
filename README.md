# LocaFood

Ứng dụng tìm quán chay trên bản đồ và danh sách quán được LocaFood trải nghiệm, được xây dựng bằng React, TypeScript, Vite và React-Leaflet. Bản đồ mặc định dùng OpenStreetMap.

## Chạy trên máy

Cần Node.js 22.12 trở lên và npm.

```powershell
npm install
npm run dev
```

Mở địa chỉ Vite in ra trong terminal, thường là `http://localhost:5173`. Vite tự tải lại trang khi bạn lưu thay đổi trong `src/` hoặc `style.css`.

```powershell
npm test
npm run build
npm run preview
```

## Cấu hình nhà cung cấp

Các endpoint công khai mặc định nằm trong `src/config/providers.ts`. Có thể ghi đè chúng bằng biến môi trường Vite; xem [.env.example](./.env.example). Sau khi sửa biến `VITE_*`, khởi động lại máy chủ dev. Những giá trị này được đưa vào mã phía trình duyệt, vì vậy **không đặt secret/API key riêng tư** vào đó.

## Cấu hình danh sách gợi ý

Danh sách, thông tin chi tiết và ảnh dùng Supabase để mọi khách xem cùng dữ liệu. Chỉnh sửa được kiểm soát bằng Row Level Security (RLS), không dựa vào việc ẩn nút trong giao diện.

1. Tạo project Supabase và bật đăng nhập Email/Password. Tạo tài khoản của chủ sở hữu trong Authentication.
2. Mở SQL Editor và chạy một lần migration [202610250001_recommended_places.sql](./supabase/migrations/202610250001_recommended_places.sql).
3. Trong Authentication, sao chép UUID của tài khoản chủ sở hữu. Chạy lệnh sau trong SQL Editor, thay giá trị mẫu bằng UUID đó:

	```sql
	insert into public.recommendation_admins (user_id)
	values ('<OWNER_AUTH_USER_UUID>');
	```

4. Sao chép [.env.example](./.env.example) thành `.env`, rồi điền Project URL và publishable/anon key từ Project Settings → API Keys:

	```env
	VITE_SUPABASE_URL=https://your-project.supabase.co
	VITE_SUPABASE_ANON_KEY=your-publishable-or-anon-key
	```

5. Khởi động lại `npm run dev`. Khách có thể xem danh sách; chỉ UUID được thêm vào `recommendation_admins` mới có thể đăng nhập để tạo, sửa hoặc xóa quán và ảnh.

Không bao giờ đặt `service_role` key trong `.env` phía frontend hoặc commit thông tin đăng nhập. Bucket ảnh cho phép đọc công khai; upload/xóa bị giới hạn bởi RLS cho admin. Danh sách ban đầu để trống, chủ sở hữu tự nhập những quán đã trải nghiệm.

Ứng dụng dùng:

- Tile OpenStreetMap để hiển thị nền bản đồ (giữ attribution của OpenStreetMap).
- Photon để gợi ý/tìm quán gần tâm bản đồ nhằm hiển thị nhanh; Overpass là nguồn dự phòng khi Photon lỗi hoặc không có quán trong bán kính.
- Nominatim chỉ làm nguồn dự phòng tìm địa chỉ và được giới hạn tần suất.
- OSRM public demo để tạo tuyến đường lái xe; tuyến được vẽ trong bản đồ LocaFood.

Các endpoint công khai có giới hạn sử dụng, có thể chậm hoặc tạm thời không khả dụng và không có cam kết SLA. Chúng phù hợp để phát triển/thử nghiệm; trước khi mở rộng lượng người dùng hoặc dùng trong sản phẩm thương mại, hãy chọn nhà cung cấp phù hợp, xem điều khoản/attribution/quota hoặc tự triển khai dịch vụ. Nếu thay tile provider, cập nhật attribution tương ứng trong `src/config/providers.ts`.

## Chức năng

- Tìm quán chay/địa chỉ với gợi ý có debounce; chỉ hiển thị kết quả khớp thay vì ghim nhầm địa danh.
- Xem danh sách quán chay do LocaFood trải nghiệm, chi tiết giá cả, đánh giá thực tế, món đặc sản, vệ sinh, không gian, giờ phù hợp và ảnh.
- Chủ sở hữu quản trị danh sách sau khi đăng nhập Supabase; khách chỉ có quyền xem.
- Dùng vị trí hiện tại, nhập điểm đi/đến, đổi hai điểm và xem tuyến/ước tính khoảng cách-thời gian.
- Mở Google Maps tùy chọn cho truy vấn địa điểm; bản đồ chính vẫn ở trong trang.

`src/services/geo.ts` là ranh giới chuyển đổi tọa độ: Leaflet dùng `[latitude, longitude]`, GeoJSON/OSRM dùng `[longitude, latitude]`. Các chuyển đổi và xếp hạng tìm kiếm có unit test.
