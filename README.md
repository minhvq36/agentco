# AgentCo

> **Trạng thái: thiết kế xong, chưa có code.** Repo hiện chỉ chứa spec và kết quả đo. Tên `agentco` là **tên mã tạm**.

Một **công ty ảo chạy trên máy bạn**. Claude làm giám đốc, điều phối một đội agent chuyên môn chạy song song, tích luỹ kinh nghiệm vào kho tri thức dạng đồ thị. Bạn ra lệnh bằng tiếng người — qua web UI hoặc qua Telegram.

Chạy bằng **subscription Claude Code của chính bạn**. Không có server của chúng tôi ở giữa. Không có dữ liệu nào rời máy bạn.

---

## Vì sao có cái này

Agent AI đã giải xong "làm thế nào". Cái chưa ai giải: **tôi đang ở đâu, ai đang làm gì, còn bao xa, có đúng hướng không.**

Các công cụ orchestration hiện có đều nhắm dân code. AgentCo nhắm người **không code nhưng cho phép đi sâu**: mặc định thấy một công ty đang làm việc với kế hoạch 4 bước dễ hiểu; muốn xem transcript thô và bảng chi phí từng token thì cách một cú click.

Và điểm khác biệt lớn nhất: **nhân viên biết dùng hệ thống của chính bạn.** Muốn agent gọi API của bạn, các công cụ khác bắt bạn viết một MCP server. Ở đây bạn **mô tả cái API** — dán link OpenAPI, dán một lệnh cURL, hoặc điền form — rồi bấm Test. Xem [`docs/SPEC-connectors.md`](docs/SPEC-connectors.md).

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
| [`docs/SPEC-connectors.md`](docs/SPEC-connectors.md) | **Đặc sản** — nhân viên biết CRUD vào REST API / MCP của chính bạn |
| [`docs/SPEC-canvas.md`](docs/SPEC-canvas.md) | Canvas dạng node — văn phòng kéo thả được (bản UI kế tiếp) |
| [`docs/SPEC-ui.md`](docs/SPEC-ui.md) | Giao diện v0 (danh sách), sự kiện SSE |
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

[**FSL-1.1-ALv2**](LICENSE.md) — source-available. Đây **không** phải open source theo định nghĩa
OSI, và tôi không gọi nó như vậy.

**Bạn được làm ngay hôm nay:** đọc toàn bộ mã · chạy cho bất kỳ mục đích gì, gồm cả thương mại và
dùng trong công ty · sửa · fork · phát hành bản sửa · dựng sản phẩm nội bộ trên nền nó.

**Đúng một điều bị cấm:** bán một sản phẩm/dịch vụ **cạnh tranh với agentco**. Và lệnh cấm đó có
hạn dùng — xem dưới.

### Mỗi bản phát hành TỰ trở thành Apache 2.0 sau đúng 2 năm

> *"We hereby **irrevocably** grant you an additional license … under the Apache License, Version
> 2.0 … effective on the **second anniversary of the date we make the Software available**."*

- **Không huỷ ngang được.** Chữ `irrevocably` nằm trong chính giấy phép. Tôi không có quyền rút lại
  — kể cả khi đổi ý, kể cả khi dự án được mua lại, kể cả khi tôi biến mất.
- **Đồng hồ chạy theo TỪNG BẢN.** Phát hành bản mới **không** đẩy lùi bản cũ một ngày nào.
- **Hệ quả:** một cửa sổ trượt rộng đúng hai năm — mọi thứ già hơn thế **đã là Apache 2.0 hoàn
  toàn**, không cần ai bấm nút.

📅 Mỗi bản phát hành trên GitHub Releases sẽ ghi **ngày cụ thể** nó thành Apache 2.0 — ghi rõ,
không nói chung chung. Mập mờ không cản được người muốn copy (họ tự tính ra được từ giấy phép), nó
chỉ cản người đang phân vân có nên tin dự án này không.

## Đóng góp

PR được hoan nghênh — đọc [**CONTRIBUTING.md**](CONTRIBUTING.md) trước.

PR đầu tiên cần ký [CLA](CLA.md) bằng **một dòng** dán vào mô tả PR. Bạn **giữ nguyên bản quyền**
phần mình viết; giấy phép bạn cấp chính là thứ làm cho lời hứa "tự thành Apache 2.0" ở trên thi
hành được.

Mọi PR phải trả lời được checklist cuối [`docs/SPEC-token-economy.md`](docs/SPEC-token-economy.md)
— thay đổi làm xấu chi phí quá 10% ở bất kỳ golden scenario nào sẽ không được merge.
