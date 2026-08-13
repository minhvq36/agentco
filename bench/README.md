# bench — đo chi phí token

Hai script đo hành vi prompt cache của Claude Agent SDK. Đây là **hạt giống của `agentco bench`** (`docs/SPEC-token-economy.md` §6), giữ lại vì mọi con số trong `docs/FINDINGS-sdk-2026-08-14.md` đến từ đây và phải tái lập được.

## Chạy

```bash
cd bench
npm install
node probe-cache.mjs     # hành vi cache qua nhiều call cùng/khác prefix
node probe-prefix.mjs    # kích thước prefix theo từng cấu hình
```

Cần đã đăng nhập Claude Code trên máy (`claude` chạy được). **Không cần API key.**

## Lưu ý khi đọc kết quả

- **Mỗi lần chạy tốn tiền thật.** Dùng `model: "haiku"` và `maxTurns: 1` để giữ ở mức vài cent.
- `probe-prefix.mjs` dùng **salt theo timestamp** để ép cache miss — đó là chủ ý, để `cache_creation_input_tokens` phản ánh đúng kích thước prefix.
- `maxTurns: 1` là **trường hợp xấu nhất** cho khoản `cache_write` lặp lại. Task nhiều lượt khấu hao khoản đó, nên số ở đây là cận trên.
- Kết quả phụ thuộc version SDK/CLI. Ghi lại version khi so sánh — nâng cấp SDK làm đổi prefix và ép cache write một lần.

## Cần thêm

- Đo với task nhiều lượt (`maxTurns: 10+`) để có số khấu hao thật
- Đo `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` với khối tri thức HOT ~2K đặt trước marker, chạy từ hai process riêng biệt — kiểm chứng trực tiếp cho `docs/SPEC-token-economy.md` §2
- Đo ngưỡng 429 khi chạy song song
