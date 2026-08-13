# SPEC — CLI & Process model

Đọc kèm `SPEC-2026-08-14-agentco.md`. File này định nghĩa cách phần mềm **chạy**: tiến trình, lệnh, cấu hình, và đường lên container.

---

## 1. Mô hình tiến trình

**Một daemon duy nhất** sở hữu mọi thứ. Không có process phụ trợ nào giữ state.

```
┌──────────────────── agentcod (daemon) ─────────────────────┐
│                                                            │
│  Claude Agent SDK runtime  ── master session                │
│                            └─ worker runs (song song)       │
│  Scheduler + warmSet cache                                  │
│  Knowledge index (in-memory, watch file)                    │
│  HTTP + SSE server        :7317   ← web UI                  │
│  Control socket           local   ← CLI subcommands         │
│  Chat bridges (tuỳ chọn)          ← telegram long-poll      │
└────────────────────────────────────────────────────────────┘
                     ▲
                     │ đọc/ghi
              ┌──────┴───────┐
              │  company/    │  toàn bộ state nằm ở đây, không DB
              └──────────────┘
```

**Vì sao một daemon:** `warmSet` (bản đồ cache nào đang ấm) và master session **phải sống trong bộ nhớ**. Mỗi lệnh CLI spawn một process riêng là quay lại đúng cái bẫy `claude -p` — mất warmSet, mất session, mất cache.

**CLI = client mỏng.** Mọi lệnh (trừ `start`/`init`) kết nối tới daemon qua control socket. Không có daemon → CLI hỏi "chạy `agentco start` chứ?".

Control socket:
- Linux/macOS: unix socket `company/.state/agentco.sock`
- Windows: named pipe `\\.\pipe\agentco-<hash(companyPath)>`

Trạng thái tiến trình ghi ở `company/.state/daemon.json` (`pid`, `port`, `started_at`, `version`). Stale pid → tự dọn.

---

## 2. Lệnh

### Khởi tạo & vòng đời

```bash
agentco init [dir]              # dựng company/ từ template, hỏi vài câu về công ty
agentco start [--port 7317] [--no-ui] [--daemon]
agentco stop
agentco status                  # daemon, agent đang chạy, ca hiện tại, cache ấm
agentco doctor                  # kiểm tra: node version, auth Claude, quyền ghi, port, bridge
```

`agentco start` mặc định **foreground + tự mở trình duyệt**. `--daemon` để chạy nền (dùng cho VPS).

### Giao việc

```bash
agentco run "viết 3 bài fanpage về sản phẩm X"
agentco run --file brief.md
agentco run --plan-only        # chỉ ra kế hoạch, không thực thi — xem trước rồi duyệt
agentco tasks                  # danh sách task ca này + trạng thái
agentco task T-0007            # brief + receipt + artifact
agentco task T-0007 --log      # log advanced (transcript thô)
agentco replay T-0007          # chạy lại T-0007 và toàn bộ nhánh con phụ thuộc nó
agentco cancel T-0007
```

`agentco run` không kèm gì → vào **chế độ hội thoại** với master ngay trong terminal (giống chat, cho người quen CLI).

### Đội ngũ

```bash
agentco agents                 # bảng role: id, pitch, skill level, tier, số task đã làm
agentco agents add <template>  # copy role mẫu vào roles/ để sửa
agentco agents test <role>     # chạy role đó với 1 task mẫu, in chi phí
```

### Tri thức

```bash
agentco knowledge              # thống kê: số node, tổng token, theo scope
agentco knowledge search "..." # tìm bằng index, 0 token
agentco knowledge show <id>
agentco knowledge tidy         # chạy Librarian ngay (thay vì đợi đủ lô)
agentco knowledge bump         # bump knowledge_version → tính lại HOT set
```

### Chi phí — dùng thường xuyên

```bash
agentco cost                   # bảng ca hiện tại (xem SPEC-token-economy §5)
agentco cost --since 7d
agentco bench --baseline       # chạy 5 golden scenario, ghi mốc
agentco bench --compare        # chạy lại, in chênh lệch so với mốc
```

### Cầu nối chat

```bash
agentco bridge telegram setup  # nhập bot token, in mã ghép đôi
agentco bridge list
agentco bridge allow <chat_id>
agentco bridge off telegram
```

**Ghép đôi bắt buộc:** sau `setup`, bot in ra một mã 6 số. Người dùng nhắn mã đó cho bot từ tài khoản của mình → `chat_id` được thêm vào whitelist. Trước khi ghép đôi, bot **im lặng tuyệt đối** với mọi người. Mã hết hạn sau 10 phút.

---

## 3. Cấu hình

Thứ tự ưu tiên: **cờ dòng lệnh > biến môi trường > `company.yaml` > mặc định**.

```yaml
# company/company.yaml
name: "Xưởng Nội Dung"
charter_file: knowledge/shared/_charter.md   # pinned, ≤500 token

runtime:
  port: 7317
  concurrency: 4
  concurrency_by_tier: { cheap: 6, standard: 4, deep: 1 }
  cache_ttl: auto            # auto | 5m | 1h

budgets:                     # override SPEC-token-economy §4
  receipt_tokens: 800
  cold_knowledge_tokens: 3000
  master_compact_at: 60000

models:
  cheap:    claude-haiku-4-5-20251001
  standard: claude-sonnet-5
  deep:     claude-opus-5
  master:   standard
  master_deep_steps: [plan, arbitrate]

librarian:
  every_n_tasks: 20
  auto_bump_knowledge: daily

bridges:
  telegram:
    enabled: false
    token_env: AGENTCO_TELEGRAM_TOKEN
    allow: []
```

**Bí mật không bao giờ nằm trong yaml.** Token bridge, API key → biến môi trường hoặc `company/.state/secrets.json` (chmod 600, có trong `.gitignore` của template). `company/` được thiết kế để commit lên git được — trừ `.state/`.

Biến môi trường: mọi khoá map thành `AGENTCO_<PATH_UPPER>`, ví dụ `AGENTCO_RUNTIME_CONCURRENCY=8`.

---

## 4. Sẵn sàng container (chưa làm, nhưng không được chặn đường)

Chưa cần Docker ở v1. Nhưng **năm ràng buộc này phải giữ ngay từ đầu**, vì vi phạm rồi sửa sau rất đắt:

1. **Không đường dẫn tuyệt đối.** Mọi thứ tương đối với `COMPANY_DIR`, đọc từ env, mặc định `./company`.
2. **Không giả định có màn hình.** `start` phải chạy được với `--no-ui` và không tự mở trình duyệt khi `AGENTCO_HEADLESS=1`.
3. **Toàn bộ state trong đúng một thư mục** (`company/`) → mount một volume là đủ.
4. **Không native module bắt buộc.** Nếu cần (ví dụ better-sqlite3), phải có đường lùi thuần JS.
5. **Có endpoint `/healthz`** trả `{ok, version, master_session, tasks_running}`.

Cộng thêm: log ra stdout dạng JSON lines khi `AGENTCO_LOG_FORMAT=json`, và bắt `SIGTERM` để đóng session sạch (ghi state, không mất task đang chạy).

Khi làm Docker (v2), Dockerfile sẽ chỉ là node-slim + `COPY` + `VOLUME /company` + `EXPOSE 7317`. Không cần thiết kế lại gì.

**Xác thực trong container:** đây là chỗ vướng thật, phải ghi nhận sớm — Claude Code auth theo máy. Chạy trong container/VPS cần đưa credential vào (mount thư mục auth, hoặc dùng API key). `agentco doctor` phải chẩn đoán và nói rõ cho người dùng, không để họ đoán.

---

## 5. Mã thoát & lỗi

```
0   ok
1   lỗi chung
2   sai cấu hình / thiếu tham số
3   không có daemon
4   chưa xác thực Claude
5   task fail
6   chạm trần ngân sách (blocked, không phải lỗi)
7   rate limit sau khi đã backoff hết
```

Nguyên tắc thông báo lỗi: mỗi lỗi in **chuyện gì xảy ra + làm gì tiếp theo**, một câu mỗi phần. Khách hàng là người non-code — stack trace mặc định giấu, hiện khi `--verbose`.

---

## 6. Cài đặt

```bash
npx agentco init            # dùng thử, không cài
npm i -g agentco            # cài thật
```

V2 cho người sợ terminal: đóng gói Tauri (~5MB) bọc chính daemon + UI này. Double-click là chạy. **Không viết lại gì** — đây là lý do UI phải là web ngay từ đầu.
