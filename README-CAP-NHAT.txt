NEON FOOTBALL - BẢN ĐÃ CHỈNH SỬA

Cấu trúc dự án:
- public/index.html
- public/client.js
- public/style.css
- server.js
- package.json
- render.yaml

Đã thêm:
1. Hộp nhắc mở khóa xoay màn hình và xoay ngang điện thoại, có nút đóng; dòng credit "cre: Ng Duc Minh" nằm ngay dưới thông báo.
2. Nút "VÀO TRẬN LUYỆN TẬP" ở menu.
3. Chế độ luyện tập dùng sân hiện tại, chỉ có người chơi, không giới hạn thời gian và không tính điểm trận chính thức.
4. Nút "THOÁT LUYỆN TẬP" để rời sân và trở về menu.

Cách dùng: thay các file theo đúng đường dẫn trong dự án hiện tại bằng các file tương ứng trong gói này. Giữ public/client.js, public/index.html và public/style.css nằm trong thư mục public. Sau đó khởi động/deploy lại dịch vụ Node.js như trước.

5. Tối ưu đồ họa cho thiết bị yếu: tự nhận biết thiết bị di động/máy có ít tài nguyên, hạ độ phân giải nội bộ của canvas, giới hạn nhịp vẽ theo tốc độ snapshot máy chủ và tắt blur/đổ bóng nặng. Không thay đổi bố cục, kích thước CSS hoặc vị trí nút điều khiển.
