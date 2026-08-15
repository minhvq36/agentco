import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, Input } from '@/components/ui/misc';
import { actions, useApp } from '@/lib/store';

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
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id} className={m.role === 'user' ? 'text-right' : ''}>
                <div
                  className={
                    m.role === 'user'
                      ? 'ml-auto inline-block max-w-[85%] rounded-xl rounded-br-sm bg-accent-soft px-3 py-2 text-left text-[13.5px] text-ink'
                      : 'inline-block max-w-[92%] rounded-xl rounded-bl-sm border border-line bg-paper px-3 py-2 text-[13.5px] text-ink'
                  }
                >
                  {m.text}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {activity && <Activity text={activity} />}

      <form
        className="flex flex-none gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || sending) return;
          setText('');
          void actions.say(t);
        }}
      >
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Giao việc, hoặc hỏi Trợ lý…"
          aria-label="Tin nhắn"
          disabled={sending}
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
