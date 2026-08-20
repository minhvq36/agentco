/**
 * Markdown TỐI GIẢN — dựng React node, KHÔNG dựng chuỗi HTML.
 *
 * Dùng chung cho ô chat và cửa sổ xem trước `.md` ở ngăn Kết quả.
 * Phân tích nằm ở `markdown-core.ts` (thuần, có bộ test); file này chỉ ánh xạ
 * kết quả đã chốt sang thẻ.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO TỰ VIẾT, VÀ VÌ SAO KHÔNG BAO GIỜ `dangerouslySetInnerHTML`.       │
 * │                                                                          │
 * │ Văn bản ở đây do MODEL sinh ra. Một câu trả lời cho khách hoàn toàn có   │
 * │ thể chứa `<img src=x onerror=…>` — vô tình, hoặc vì tài liệu người dùng  │
 * │ tải lên có đoạn đó. Đổ nó vào `innerHTML` là mở một lỗ XSS ngay trên     │
 * │ giao diện điều khiển công ty, thứ không có xác thực nào ngoài "cùng máy" │
 * │ (đúng lập luận đã ép `.svg` sang `octet-stream`, SPEC-artifacts §3).     │
 * │                                                                          │
 * │ Dựng React node thì mọi thứ mặc định là VĂN BẢN — không có đường nào để  │
 * │ một chuỗi biến thành thẻ. Đó cũng là lý do không kéo thư viện             │
 * │ markdown→HTML về: chúng trả CHUỖI, mà chuỗi thì phải đi qua innerHTML.   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ NĂM LUẬT, KHÔNG HƠN — và hai thứ CỐ Ý BỎ.                               │
 * │                                                                          │
 * │   ✅ ```khối code```   ✅ `code trong dòng`   ✅ **đậm**   ✅ # tiêu đề   │
 * │   ✅ | bảng |                                                            │
 * │                                                                          │
 * │ Bảng thêm vào 20/08 vì nó là dạng kết quả nhân viên SINH RA THẬT: bảng    │
 * │ thuật ngữ, bảng chi tiêu, bảng so sánh giá. Hiện nguyên văn dấu `|` là    │
 * │ bắt người dùng tự dựng cái bảng đó trong đầu — và họ mở file `.md` ra để  │
 * │ DUYỆT trước khi gửi cho khách, nên nhìn sai là gửi sai.                   │
 * │                                                                          │
 * │   ⛔ `_nghiêng_` — sản phẩm này nói `plan_id`, `hot_knowledge_tokens`,   │
 * │      `max_turns`, `default_deliver` suốt ngày. Biến gạch dưới thành      │
 * │      nghiêng là băm nát chính văn bản của mình.                          │
 * │                                                                          │
 * │   ⛔ danh sách + thụt lề 4 dấu cách — xem `blocksOf`.                    │
 * │                                                                          │
 * │ Bề mặt nhỏ nhất = ít vỡ nhất. Mỗi luật thêm vào là một cách mới để làm   │
 * │ hỏng những câu backend đã dựng sẵn bằng code.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Fragment } from 'react';

import { blocksOf, spansOf, type Align } from './markdown-core';

/**
 * Cỡ tiêu đề — CỐ Ý SÁT CỠ CHỮ THƯỜNG.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `#` và `##` theo mặc định trình duyệt là 2em và 1.5em. Trong một bong    │
 * │ bóng chat rộng ~330px, một dòng 27px chiếm gần trọn bề ngang và đẩy mọi  │
 * │ thứ khác xuống — người đọc mất mạch, và cảm giác là giao diện đang HÉT.  │
 * │                                                                          │
 * │ Nên phân cấp bằng ĐỘ ĐẬM và MÀU, không bằng kích cỡ: chênh 1–1.5px là đủ │
 * │ để mắt thấy thứ bậc mà bố cục không nhảy. Cửa sổ xem trước rộng 56rem    │
 * │ nên được nới thêm đúng một nấc — không hơn.                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const SIZES = {
  chat: ['text-[15px]', 'text-[14px]', 'text-[13.5px]'],
  preview: ['text-[17px]', 'text-[15px]', 'text-[14px]'],
} as const;

function Inline({ text }: { text: string }) {
  return (
    <>
      {spansOf(text).map((s, i) => {
        const body = s.code ? (
          <code className="rounded bg-line/60 px-1 py-px font-mono text-[0.9em] text-ink">{s.text}</code>
        ) : (
          s.text
        );
        return (
          <Fragment key={i}>
            {s.bold ? <strong className="font-semibold">{body}</strong> : body}
          </Fragment>
        );
      })}
    </>
  );
}

const ALIGN: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/**
 * Bảng markdown. Dùng chung ngôn ngữ hình với `CsvTable` ở ngăn Kết quả — hai
 * cái bảng cạnh nhau trong cùng một sản phẩm mà trông khác nhau thì người dùng
 * đi tìm ý nghĩa của sự khác nhau đó.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HAI LỚP CHỐNG VỠ, VÀ CẢ HAI ĐỀU BẮT BUỘC.                               │
 * │                                                                          │
 * │  1. `overflow-x-auto` + `max-w-full` ở khối BỌC NGOÀI — cùng luật đã áp   │
 * │     cho khối code: nội dung rộng cuộn TRONG khối của nó. Thiếu nó thì     │
 * │     bảng nong bong bóng chat ra và cả panel sinh thanh cuộn ngang.        │
 * │                                                                          │
 * │  2. Bong bóng chứa bảng phải là khối có BỀ RỘNG XÁC ĐỊNH (`block w-full`, │
 * │     xem `ChatPanel`), không phải `inline-block` co theo nội dung. Với     │
 * │     `inline-block`, bề rộng bọc ngoài lại phụ thuộc vào nội dung bên      │
 * │     trong — `max-w-full` không còn mốc nào để bám, và lớp 1 mất tác dụng. │
 * │                                                                          │
 * │ Nhờ vậy panel thu hẹp tới mức nào (MIN_W = 300px) bảng vẫn chỉ cuộn ngang │
 * │ bên trong, không bao giờ đẩy được sidebar rộng ra.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `min-w-max` trên `<table>`: để bảng giữ bề rộng tự nhiên của nó rồi mới cuộn,
 * thay vì bị bóp cho vừa khung và mỗi ô xuống dòng thành một cột chữ dọc.
 */
function Table({ head, rows, align }: { head: string[]; rows: string[][]; align: Align[] }) {
  return (
    <div className="my-1.5 max-w-full overflow-x-auto rounded-lg border border-line">
      <table className="min-w-max border-collapse text-[12.5px]">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th
                key={i}
                className={`border-b border-line bg-line/30 px-2.5 py-1.5 font-semibold text-ink ${
                  ALIGN[align[i] ?? 'left']
                }`}
              >
                <Inline text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="even:bg-line/15">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={`border-b border-line/60 px-2.5 py-1 align-top text-ink last:border-r-0 ${
                    ALIGN[align[j] ?? 'left']
                  }`}
                >
                  <Inline text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ text, variant = 'chat' }: { text: string; variant?: 'chat' | 'preview' }) {
  const sizes = SIZES[variant];

  return (
    <>
      {blocksOf(text).map((b, i) => {
        if (b.kind === 'code') {
          return (
            <div key={i} className="my-1.5 overflow-hidden rounded-lg border border-line bg-line/25">
              {/*
                Nhãn ngôn ngữ, KHÔNG tô màu cú pháp — quyết định có chủ ý.

                Tô màu là một LỜI KHẲNG ĐỊNH về cú pháp: tô nhầm một chuỗi thành
                comment thì người đọc tin theo, và màu sai tệ hơn không màu hẳn.
                Tự viết tokenizer cho py/TS/C/C++/Java là 5 bộ ngữ pháp sai theo
                5 kiểu khác nhau.

                Và đo được (SPEC-artifacts §3): 14/14 kết quả trên máy người dùng
                là `.md` — nhân viên chỉ có `Write`/`Edit`, chưa vai trò nào sinh
                ra code. Đây là tính năng cho một người dùng CHƯA TỒN TẠI. Khi có
                phòng Kỹ thuật thật thì gắn `highlight.js` vào đúng chỗ này.
              */}
              {b.lang && (
                <div className="border-b border-line px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wide text-muted">
                  {b.lang}
                </div>
              )}
              {/*
                `overflow-x-auto` nằm ở ĐÂY, không ở khối cha: một dòng code dài
                phải cuộn TRONG khối của nó. Thiếu nó thì cả panel sinh thanh
                cuộn ngang và bong bóng chat bị nong rộng ra.
              */}
              <pre className="overflow-x-auto px-2.5 py-2">
                <code className="font-mono text-[12px] leading-relaxed text-ink">{b.text}</code>
              </pre>
            </div>
          );
        }

        if (b.kind === 'table') {
          return <Table key={i} head={b.head} rows={b.rows} align={b.align} />;
        }

        if (b.kind === 'heading') {
          const size = sizes[Math.min(b.level, 3) - 1] ?? sizes[2];
          return (
            <div key={i} className={`mt-2 mb-1 font-semibold text-ink first:mt-0 ${size}`}>
              <Inline text={b.text} />
            </div>
          );
        }

        /**
         * DANH SÁCH VIỆC CẦN LÀM. → markdown-core.ts `TASK`
         *
         * Ô vuông vẽ bằng CSS, không phải `<input type="checkbox">`:
         *
         *  · `<input>` mặc định của trình duyệt không nghe theo bảng màu, nên nó
         *    hiện xanh hệ điều hành giữa một giao diện đã chọn màu cẩn thận.
         *  · Nó BẤM ĐƯỢC theo mặc định, và bấm được ở đây là nói dối: không có
         *    đường nào ghi ngược lại vào file. `disabled` thì lại hiện xám mờ
         *    như một ô đang hỏng.
         *
         * `aria-hidden` trên ô vuông + chữ "đã xong/chưa xong" cho trình đọc màn
         * hình: người khiếm thị phải nghe được trạng thái, không chỉ thấy dấu ✓.
         */
        if (b.kind === 'tasks') {
          return (
            <ul key={i} className="my-1.5 flex flex-col gap-1">
              {b.items.map((it, k) => (
                <li key={k} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-[0.15em] flex h-[1em] w-[1em] flex-none items-center justify-center rounded-[3px] border text-[0.7em] leading-none ${
                      it.done
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line bg-transparent text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span className="sr-only">{it.done ? 'đã xong: ' : 'chưa xong: '}</span>
                  {/* Gạch ngang việc đã xong, nhưng KHÔNG làm mờ chữ: người ta
                      vẫn phải đọc lại được thứ mình đã làm. */}
                  <span className={`min-w-0 break-words ${it.done ? 'text-muted line-through' : 'text-ink'}`}>
                    <Inline text={it.text} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        // Dòng trắng ở HAI ĐẦU bị cắt, bên TRONG giữ nguyên: backend dựng sẵn
        // nhiều câu nhiều dòng (`/help`, dải bước kế hoạch, khối "kết quả đã lưu
        // tại") và chúng dựa vào đúng những ký tự xuống dòng đó.
        const body = b.text.replace(/^\n+|\n+$/g, '');
        if (!body) return null;
        return (
          <span key={i} className="block whitespace-pre-wrap break-words">
            <Inline text={body} />
          </span>
        );
      })}
    </>
  );
}
