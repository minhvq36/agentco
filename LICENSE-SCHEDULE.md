# Lịch mở nguồn — mỗi bản phát hành thành Apache 2.0 vào ngày nào

agentco phát hành dưới [FSL-1.1-ALv2](LICENSE.md). Giấy phép đó chứa một lời hứa **không huỷ ngang
được**:

> *"We hereby **irrevocably** grant you an additional license to use the Software under the Apache
> License, Version 2.0 that is effective on the **second anniversary of the date we make the
> Software available**."*

Trang này chỉ làm một việc: **tính sẵn cái ngày đó ra**, để không ai phải hỏi.

## Bảng

| Bản | Ngày phát hành | Thành Apache 2.0 |
|---|---|---|
| *(chưa phát hành bản công khai nào)* | — | — |

<!--
  THÊM MỘT DÒNG MỖI LẦN PHÁT HÀNH. Không được để trống — xem "Vì sao ghi ngày
  cụ thể" ở dưới.

  Ngày phát hành = ngày bản đó được công bố ra công chúng lần đầu (tag + GitHub
  Release). Không phải ngày commit, không phải ngày merge.
-->

## Ba điều hay bị hiểu nhầm

### ① Phát hành bản mới **không** đẩy lùi bản cũ

Đồng hồ chạy **theo từng bản**, tính từ ngày chính bản đó ra mắt. `v0.1` ra 15/09/2026 thì thành
Apache 2.0 vào 15/09/2028 — kể cả khi giữa hai mốc đó có ba mươi bản mới.

Không có "reset". Không có chuyện lùi hạn.

### ② Hệ quả: một **cửa sổ trượt rộng đúng hai năm**

Ở bất kỳ thời điểm nào, **mọi thứ già hơn hai năm đều đã là Apache 2.0 hoàn toàn** — không cần ai
bấm nút, không cần chủ dự án còn sống, không cần thiện chí của ai.

```
                 hôm nay
                    │
  ├──── Apache 2.0 ────────┤├──── FSL ────┤
        (mọi bản > 2 năm)      (2 năm gần nhất)
```

### ③ Đây là lời hứa của **giấy phép**, không phải của người viết

Chữ `irrevocably` nằm trong chính văn bản bạn nhận cùng mã nguồn. Chủ dự án **không có quyền** rút
lại: không phải khi đổi ý, không phải khi dự án được bán, không phải khi tác giả biến mất.

Bạn không cần tin ai. Bạn đọc dòng đó.

## Vì sao ghi NGÀY CỤ THỂ chứ không nói chung chung "hai năm"

Từng cân nhắc để mập mờ cho "an toàn". **Sai, và sai ngược chiều:**

| | Mập mờ | Ngày cụ thể |
|---|---|---|
| Phòng pháp chế bên mua | không tính được ⇒ mặc định **"không duyệt"** | tra một dòng, xong |
| Người định fork | tưởng rủi ro dài hơn thực tế | biết chính xác mình chờ gì |
| Người định copy để bán | **không đổi gì cả** — họ vẫn tính ra được ngày đó từ giấy phép | như bên trái |

Mập mờ **không** cản được người ta copy — ngày đó suy ra được từ chính giấy phép. Nó chỉ cản người
đang phân vân có nên tin dự án này không.

⇒ Ghi rõ. Nó **miễn phí**, và nó là thứ duy nhất trong cả câu chuyện giấy phép biến một hạn chế
thành một lời cam kết.
