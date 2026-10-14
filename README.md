# NEON FOOTBALL — authoritative multiplayer starter

Bản khởi đầu game bóng đá 2D trên trình duyệt: HTML/CSS/JavaScript + Node.js + WebSocket. Máy chủ Node.js là nguồn sự thật duy nhất cho vị trí, va chạm, bóng, tỉ số và thời gian trận đấu.

## Có trong bản này

- Menu tạo phòng và danh sách phòng; mã phòng ngắn.
- Tên Guest; tối đa 14 người/phòng.
- Tự động chia đội cân bằng và luân phiên khi hai đội bằng người.
- Lobby hiển thị Đỏ/Xanh, Host và trạng thái sẵn sàng.
- Chỉ Host được bắt đầu; tối thiểu 1 người mỗi đội, số lượng hai đội bằng nhau và tất cả sẵn sàng.
- Đếm ngược 3–2–1; hủy nếu điều kiện không còn đúng.
- Canvas 2D, điều khiển bàn phím và joystick cảm ứng.
- Tăng tốc + stamina, giữ bóng, sút gồng lực, va chạm cơ bản, tỉ số và tổng kết.
- SQL schema tùy chọn cho Supabase. Bản starter hiện dùng bộ nhớ của Node.js cho phòng; phòng sẽ mất khi server khởi động lại.

## Chạy local

Yêu cầu Node.js 20 trở lên.

```bash
npm install
npm start
```

Mở `http://localhost:3000` ở nhiều tab hoặc thiết bị trong cùng mạng. Để thử trên điện thoại, cần deploy lên một host hỗ trợ WebSocket qua HTTPS/WSS; `localhost` trên điện thoại là chính điện thoại, không phải máy tính.

## Deploy

Có thể deploy lên dịch vụ Node.js hỗ trợ WebSocket như Render, Railway hoặc Fly.io. Dùng lệnh start `npm start`; nền tảng thường cấp `PORT` qua biến môi trường. GitHub Pages chỉ host file tĩnh, không chạy được authoritative Node.js server.

## Lưu ý kiến trúc

- WebSocket gửi input từ client khoảng 30 lần/giây; server mô phỏng ở 60 tick/giây.
- Phòng đang lưu trong RAM, chưa có persistence/scale nhiều instance.
- Starter chưa có xác thực tài khoản, reconnect/resume, rate limiting, chống bot, chống gian lận hoàn chỉnh, TURN/WebRTC, hoặc lưu thống kê vào database.
- Bản này dùng WebSocket trực tiếp thay vì P2P vì bạn đã chọn máy chủ game riêng làm authoritative server. Điều này giúp server kiểm soát trạng thái trận đấu.
- Physics, quy tắc sút, ghi bàn và xử lý thoát trận là bản nền để mở rộng; cần kiểm thử tải và tinh chỉnh gameplay trước khi public.

## Supabase

`supabase/schema.sql` tạo bảng phòng/người chơi và chính sách đọc lobby mẫu. Hiện server chưa gọi Supabase. Để tích hợp persistence an toàn, thêm Supabase client ở backend, dùng biến môi trường `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`; tuyệt đối không đưa service role key vào `public/` hay client JavaScript. Với nhiều server instance, cần database/Redis và cơ chế khóa/đồng bộ phòng để tránh hai tiến trình xử lý cùng một phòng.
