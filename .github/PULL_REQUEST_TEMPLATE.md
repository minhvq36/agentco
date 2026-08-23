<!--
  Cảm ơn bạn đã bỏ công. Vài ô dưới đây không phải thủ tục cho vui — mỗi ô
  tương ứng với một lớp lỗi đã từng lọt trong dự án này.
-->

## Thay đổi gì

<!-- Một hai câu. Nếu sửa bug: bug đó biểu hiện ra sao với người dùng? -->

## CLA — chỉ cần ở PR ĐẦU TIÊN của bạn

- [ ] Đây không phải PR đầu tiên của tôi (đã ký trước đó)
- [ ] Tôi ký CLA — dán dòng dưới đây vào và điền:

```
I have read the CLA at CLA.md and I hereby sign it.
Name: <họ tên>   GitHub: @<tài khoản>   Date: <YYYY-MM-DD>
```

> Bạn **giữ nguyên bản quyền** phần mình viết ([CLA.md](../CLA.md) §4). Giấy phép bạn cấp là thứ
> làm cho lời hứa *"mỗi bản tự thành Apache 2.0 sau 2 năm"* thi hành được — xem
> [LICENSE-SCHEDULE.md](../LICENSE-SCHEDULE.md).

## Trước khi gửi

- [ ] `npm test` xanh
- [ ] Có test cho phần **hàm thuần** đã thêm/sửa (chạy <1 giây, 0 token)
- [ ] Nếu động tới chi phí token: **có số đo**, và đã **cắm nonce** phá cache
      *(không có nonce thì lần đo thứ hai ăn cache lần một và ra chênh lệch 0 — bẫy này đã bắt hụt hai lần)*
- [ ] Nếu sửa một luật đã ghi trong `docs/`: **đã sửa tài liệu trong cùng PR này**
      *(tài liệu lệch mã là một bug, và là loại sống lâu nhất vì nó không gây triệu chứng)*
