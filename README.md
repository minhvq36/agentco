# AgentCo

> **Trạng thái: thiết kế xong, chưa có code.** Repo hiện chỉ chứa spec và kết quả đo. Tên `agentco` là **tên mã tạm**.

Một **công ty ảo chạy trên máy bạn**. Claude làm giám đốc, điều phối một đội agent chuyên môn chạy song song, tích luỹ kinh nghiệm vào kho tri thức dạng đồ thị. Bạn ra lệnh bằng tiếng người — qua web UI hoặc qua Telegram.

Chạy bằng **subscription Claude Code của chính bạn**. Không có server của chúng tôi ở giữa. Không có dữ liệu nào rời máy bạn.

---

## Vì sao có cái này

Agent AI đã giải xong "làm thế nào". Cái chưa ai giải: **tôi đang ở đâu, ai đang làm gì, còn bao xa, có đúng hướng không.**

Các công cụ orchestration hiện có đều nhắm dân code. AgentCo nhắm người **không code nhưng cho phép đi sâu**: mặc định thấy một công ty đang làm việc với kế hoạch 4 bước dễ hiểu; muốn xem transcript thô và bảng chi phí từng token thì cách một cú click.

## Nguyên tắc thiết kế

1. **Sở hữu artifact, không sở hữu prompt.** Giá trị nằm ở file trong thư mục công ty của bạn. Chúng sống độc lập với mọi thay đổi của Claude Code.
2. **Agent là hàm stateless.** Đến, làm, ghi file, chết. Trí nhớ nằm ở đồ thị tri thức, không nằm trong context window.
3. **Mỗi token phải có lý do tồn tại.** Hiệu năng và tiết kiệm là mục tiêu tối thượng, không phải tính năng phụ.

## Tài liệu

| File | Nội dung |
|---|---|
| [`docs/SPEC-2026-08-14-agentco.md`](docs/SPEC-2026-08-14-agentco.md) | Spec hệ thống — tổ chức, role, giao thức Task/Receipt, đồ thị tri thức, scheduler |
| [`docs/SPEC-token-economy.md`](docs/SPEC-token-economy.md) | **Đọc cái này trước nếu chỉ đọc một file.** Luật chi phí token, kiến trúc prefix cache |
| [`docs/SPEC-cli.md`](docs/SPEC-cli.md) | Process model, bộ lệnh, cấu hình, đường lên container |
| [`docs/SPEC-ui.md`](docs/SPEC-ui.md) | Giao diện, sự kiện SSE |
| [`docs/FINDINGS-sdk-2026-08-14.md`](docs/FINDINGS-sdk-2026-08-14.md) | Kết quả đo thật trên Claude Agent SDK — số liệu, cái bẫy, quyết định phát sinh |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Mốc phát triển |
| [`bench/`](bench/) | Script đo, tái lập được mọi con số trong FINDINGS |

## Kiến trúc, một hình

```
   Human ──► MASTER (session dài, lập kế hoạch, không tự làm tay chân)
                │ TaskBrief (DAG)
      ┌─────────┼─────────┬─────────┐
      ▼         ▼         ▼         ▼
   Worker    Worker    Worker    Worker      stateless, song song
      │ Receipt (≤800 token, có trường `say` tiếng người)
      └─────────┴─────────┴─────────┘
                │
        KNOWLEDGE GRAPH (markdown + frontmatter, người đọc được)
```

Worker không nói chuyện trực tiếp với nhau — mọi trao đổi qua master hoặc qua artifact. Lý do là kinh tế, không phải thẩm mỹ: agent-to-agent chat là nguồn đốt token lớn nhất và khó kiểm soát nhất trong mọi hệ multi-agent.

## Yêu cầu

- Node.js ≥ 22
- Claude Code CLI đã đăng nhập (`claude` chạy được). **Không cần API key.**

## License

[FSL-1.1-ALv2](LICENSE.md) — source-available, tự chuyển sang Apache 2.0 sau 2 năm.

Cá nhân, học tập, nghiên cứu phi thương mại, dùng nội bộ: **miễn phí**. Fork cá nhân và PR: **được**. Cấm: đóng gói thành sản phẩm/dịch vụ cạnh tranh trực tiếp.

Đây **không** phải open source theo định nghĩa OSI, và chúng tôi không gọi nó như vậy.

## Đóng góp

Chưa mở nhận PR (chưa có code). Khi mở, mọi PR phải trả lời được checklist ở cuối [`docs/SPEC-token-economy.md`](docs/SPEC-token-economy.md) — thay đổi làm xấu chi phí quá 10% ở bất kỳ golden scenario nào sẽ không được merge.
