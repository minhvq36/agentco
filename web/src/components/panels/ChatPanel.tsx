import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, Textarea } from '@/components/ui/misc';
import { Markdown } from '@/lib/markdown';
import { hasTable } from '@/lib/markdown-core';
import { actions, labelFor, useApp } from '@/lib/store';

/**
 * Ô chat với Trợ lý. Cửa vào DUY NHẤT cho mọi thứ người dùng gõ — Trợ lý tự
 * quyết định đây là trò chuyện, cần hỏi lại, hay là việc phải giao cho đội.
 *
 * Gõ "Chào" mà khởi động cả một kế hoạch DAG là lỗi người dùng gặp ngay thao
 * tác đầu tiên; `/say` ở backend tồn tại để chuyện đó không xảy ra nữa.
 */
export function ChatPanel() {
  const messages = useApp((s) => s.messages);
  const sending = useApp((s) => s.sending);
  const activity = useApp((s) => s.activity);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activity]);

  function submit(): void {
    const t = text.trim();
    if (!t || sending) return;
    setText('');
    void actions.say(t);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <Empty
            icon={<MessageSquare className="h-7 w-7" />}
            title="Chưa nói gì với Trợ lý"
            hint="Giao việc, hoặc hỏi han bình thường. Trợ lý tự phân biệt — chào hỏi không tốn token của nhân viên nào."
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id} className={`min-w-0 ${m.role === 'user' ? 'text-right' : ''}`}>
                {/*
                  TÊN NGƯỜI TRẢ LỜI — chỉ khi KHÔNG phải Trợ lý.

                  Từ 19/08, task `deliver: reply` gửi câu trả lời THẲNG từ nhân
                  viên tới người dùng (SPEC-offices.md §6). Không gắn nhãn thì
                  người dùng tưởng Trợ lý tự trả lời — mà cả điểm của sản phẩm
                  là họ thấy được đội mình đang làm việc.

                  Tên tra từ `role`, KHÔNG lấy từ `text`: luật giao thức nói
                  `say` không bao giờ chứa tên người nói, vì nướng sẵn vào chuỗi
                  thì tên hiện hai lần và mọi client tương lai mất quyền tự chọn
                  cách gắn nhãn.
                */}
                {m.role !== 'user' && m.role !== 'assistant' && (
                  <div className="mb-0.5 text-[11px] font-medium text-muted">{labelFor(m.role)}</div>
                )}
                {/*
                  `whitespace-pre-wrap` là BẮT BUỘC, không phải trang trí.
                  Backend dựng sẵn bằng code những câu trả lời nhiều dòng —
                  `/help`, danh sách bước của kế hoạch, báo cáo cuối ca — và
                  chúng dùng ký tự xuống dòng thật. HTML gộp mọi khoảng trắng
                  thành một dấu cách, nên nếu không giữ thì `/help` hiện ra
                  thành một khối chữ liền không đọc nổi.

                  `break-words`: đường dẫn file và URL dài không có khoảng trắng
                  để ngắt — thiếu nó thì bong bóng chat tự nong ra và đẩy cả
                  panel sinh thanh cuộn ngang.
                */}
                {/*
                  BỀ RỘNG BONG BÓNG — ba dạng, và dạng thứ ba là vì cái bảng.

                  Tin thường co theo nội dung (`inline-block`) vì một bong bóng
                  chiếm trọn bề ngang cho câu "Đã xong." trông như lỗi bố cục.

                  Tin CÓ BẢNG thì ngược lại: bảng là thứ duy nhất trong markdown
                  mà bề rộng mang thông tin, nên nó lấy trọn bề ngang panel. Và
                  `block w-full` ở đây không chỉ để đẹp — nó cho khối bọc bảng
                  một BỀ RỘNG XÁC ĐỊNH để bám vào, thứ `inline-block` không có.
                  Thiếu nó thì `max-w-full` + `overflow-x-auto` bên trong mất
                  mốc, bảng tự nong bong bóng ra và panel sinh thanh cuộn ngang.
                  → `Table` trong lib/markdown.tsx
                */}
                <div
                  className={
                    m.role === 'user'
                      ? 'ml-auto inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-accent-soft px-3 py-2 text-left text-[13.5px] text-ink'
                      : `break-words rounded-xl rounded-bl-sm border border-line bg-paper px-3 py-2 text-[13.5px] leading-relaxed text-ink ${
                          hasTable(m.text) ? 'block w-full' : 'inline-block max-w-[92%]'
                        }`
                  }
                >
                  {/*
                    Chỉ VẼ markdown cho tin của hệ thống. Tin của NGƯỜI DÙNG giữ
                    nguyên văn — họ gõ gì thì thấy đúng thứ đó, không bị giao
                    diện diễn giải lại. Gõ `**` để nhấn giọng mà nó biến mất là
                    một cách âm thầm để nói với người dùng rằng họ gõ sai.

                    `whitespace-pre-wrap` chuyển vào TRONG `Markdown` (từng khối
                    tự giữ), vì khối code phải cuộn ngang riêng — để ở ngoài thì
                    một dòng code dài nong rộng cả bong bóng.
                  */}
                  {m.role === 'user' ? m.text : <Markdown text={m.text} />}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {activity && <Activity text={activity} />}

      <form
        className="flex flex-none items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {/*
          Textarea, KHÔNG phải input: Enter gửi, Shift+Enter xuống dòng.

          Cố ý KHÔNG có dòng hướng dẫn nào trên giao diện, và không có setting.
          Đây là tổ hợp phím ai cũng đã biết từ mọi ứng dụng chat khác — viết ra
          là chiếm chỗ vĩnh viễn để dạy một thứ người dùng vốn đã biết.

          Cao tự nong theo nội dung, trần ~5 dòng rồi mới cuộn: một yêu cầu dài
          gõ vào ô cao 36px thì người ta không đọc lại được thứ mình vừa viết,
          và đó là lúc họ gửi đi một câu thiếu mất nửa cuối.
        */}
        <Textarea
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            // ⚠ `isComposing` là BẮT BUỘC với tiếng Việt. Bộ gõ (Telex/VNI, và
            // mọi IME) dùng Enter để chốt ký tự đang dựng — nuốt phím đó là gửi
            // tin nhắn giữa lúc người dùng mới gõ được nửa chữ.
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            submit();
          }}
          placeholder="Giao việc, hoặc hỏi Trợ lý…"
          aria-label="Tin nhắn"
          disabled={sending}
          className="max-h-[7.5rem] min-h-[2.25rem] resize-none py-1.5 leading-relaxed"
          style={{ height: 'auto' }}
          ref={(el) => {
            if (!el) return;
            // Nong theo nội dung: reset về auto trước khi đo, nếu không
            // `scrollHeight` chỉ tăng được chứ không co lại khi xoá bớt chữ.
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
        />
        <Button type="submit" variant="primary" size="icon" disabled={sending || !text.trim()} aria-label="Gửi">
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

/**
 * Dòng "đang làm gì". Không có nó thì từ lúc bấm Gửi tới lúc Trợ lý trả lời là
 * 5–15 giây im lặng hoàn toàn, và người dùng không biết hệ thống có nhận được
 * hay không — khoảng trống đó là chỗ người ta bấm Gửi lần thứ hai.
 *
 * Ba chấm là CSS thuần, không phải một lượt gọi LLM nào. Ràng buộc chéo của bốn
 * tiêu chí: "mượt" không bao giờ được mua bằng token.
 */
function Activity({ text }: { text: string }) {
  return (
    <div
      className="flex flex-none items-center gap-2 border-t border-line px-4 py-2 text-[13px] text-muted"
      role="status"
      aria-live="polite"
    >
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="soft-pulse h-1.5 w-1.5 rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.22}s` }}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </div>
  );
}
