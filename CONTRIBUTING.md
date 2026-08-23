# Đóng góp cho agentco

## Giấy phép: nói thẳng, vì bạn xứng đáng biết trước khi bỏ công

agentco dùng **[FSL-1.1-ALv2](LICENSE.md)** — *Functional Source License*. Nó **không** phải giấy
phép được OSI công nhận, và tôi nói ra ngay ở đây thay vì để bạn tự phát hiện sau khi đã viết code.

Nhưng nó cũng **không phải mã nguồn đóng**, và khoảng cách giữa hai điều đó lớn hơn vẻ ngoài:

| Bạn được làm ngay hôm nay | |
|---|---|
| Đọc toàn bộ mã nguồn | ✅ |
| Chạy cho bất kỳ mục đích gì — cá nhân, nội bộ công ty, thương mại | ✅ |
| Sửa, fork, phát hành bản sửa của bạn | ✅ |
| Dựng một sản phẩm nội bộ trên nền nó | ✅ |
| **Bán một sản phẩm/dịch vụ CẠNH TRANH với agentco** | ❌ — trong 2 năm, rồi hết |

Đúng **một** hạn chế, và nó có hạn dùng.

## Điều khoản quan trọng nhất, và nó tự chạy

> **Mỗi bản phát hành TỰ TRỞ THÀNH Apache 2.0 vào đúng ngày kỷ niệm 2 năm của chính nó.**
>
> *"We hereby irrevocably grant you an additional license to use the Software under the Apache
> License, Version 2.0 that is effective on the second anniversary of the date we make the Software
> available."* — [LICENSE.md](LICENSE.md), §Grant of Future License

Ba tính chất đáng đọc kỹ:

**① Không huỷ ngang được.** Chữ `irrevocably` nằm ngay trong giấy phép. Tôi **không có quyền** rút
lại lời hứa đó — kể cả khi đổi ý, kể cả khi dự án được mua lại, kể cả khi tôi biến mất. Bạn không
cần tin tôi; bạn chỉ cần đọc dòng đó.

**② Đồng hồ chạy theo TỪNG BẢN, và không có gì bị đẩy lùi.** Bản `v0.1` phát hành 15/09/2026 thành
Apache 2.0 vào **15/09/2028** — bất kể sau đó có bao nhiêu bản mới. Phát hành thêm **không** làm bản
cũ chậm lại một ngày nào. Hệ quả: dự án luôn có một **cửa sổ trượt rộng đúng 2 năm** — mọi thứ già
hơn thế đều đã là Apache 2.0 hoàn toàn.

**③ Ngày cụ thể, không mập mờ.** Mỗi bản phát hành trên GitHub Releases ghi rõ ngày nó thành
Apache 2.0. Xem [LICENSE-SCHEDULE.md](LICENSE-SCHEDULE.md). Đây là chuyện có thể tra được, không
phải chuyện phải hỏi.

> Nếu bạn theo trường phái "chỉ đóng góp cho OSS thuần" — tôi hiểu, và không tranh cãi. Đóng góp
> của bạn sẽ là Apache 2.0 sau hai năm, nhưng *hôm nay* nó chưa phải, và đó là một lý do chính đáng
> để đứng ngoài. Không có gì phải giải thích thêm.

## Trước PR đầu tiên: ký CLA

Một dòng, một lần duy nhất, dán vào mô tả PR đầu tiên của bạn:

```
I have read the CLA at CLA.md and I hereby sign it.
Name: <họ tên>   GitHub: @<tài khoản>   Date: <YYYY-MM-DD>
```

**Bạn không mất bản quyền** — xem [CLA.md](CLA.md) §4. Bạn cấp một giấy phép đủ rộng để lời hứa
"tự thành Apache 2.0" ở trên thi hành được. Không có nó thì mỗi lần đổi giấy phép phải đi xin chữ
ký từng người, và một người không liên lạc được là cả dự án kẹt.

## Bắt tay vào việc

```bash
npm install
npm run build:all     # biên dịch server + giao diện
npm test              # 323 test, ~6 giây, 0 token, không gọi LLM
npm run dev           # chạy CLI từ mã nguồn
```

### Bốn tiêu chí, và chúng định nghĩa "xong"

Một thay đổi chỉ xong khi qua cả bốn: **ổn định** · **xử lý lỗi tử tế** · **hiệu năng** · **mượt**.
Chi tiết: `docs/SPEC-2026-08-14-agentco.md` §1.

### Ba luật nhắc lại nhiều lần trong repo này, vì cả ba đều đã trả giá

1. **Một bất biến chỉ có thật khi có mã nguồn thi hành nó.** Chú thích không phải cơ chế; một hàm
   có thật nhưng bảo vệ thứ khác thì còn nguy hơn một lời hứa suông.
2. **Đo được N lần hỏng chứng minh một CƠ CHẾ, không chứng minh một KẾT LUẬN.** Trước khi tuyên bố
   một đường là chết, hỏi: *thứ tương đương đang chạy được ở đâu, và nó khác ta chỗ nào?*
3. **Token là ràng buộc thiết kế, không phải chuyện tối ưu sau.** Mọi thứ vào prefix là trả ở **mọi
   lượt**, vĩnh viễn. `docs/SPEC-token-economy.md` là luật cao nhất.

### Trước khi gửi PR

- `npm test` xanh. Thêm test cho **hàm thuần** — chúng chạy dưới 1 giây và 0 token.
- Nếu thay đổi động tới chi phí token: kèm **số đo**, và nhớ **cắm nonce** để phá cache (không có
  nonce thì lần đo thứ hai ăn cache lần một và cho ra chênh lệch 0).
- Nếu sửa một luật đã ghi trong `docs/`: sửa luôn tài liệu trong cùng PR. Tài liệu lệch mã là một bug.
