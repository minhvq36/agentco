/**
 * Hòm thư của Trợ lý. → docs/SPEC-tools-approval.md §11
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TRỢ LÝ LÀ MỘT NGƯỜI. Một người làm được một việc tại một thời điểm.      │
 * │                                                                          │
 * │ Đây không phải một lựa chọn thiết kế cho đẹp — nó là BẮT BUỘC KỸ THUẬT.  │
 * │ `askSession()` chạy `resume: sessionId` rồi ghi đè `sessionId` bằng id    │
 * │ mới. Hai lượt gọi chồng nhau thì cả hai cùng resume một id, cả hai cùng   │
 * │ ghi đè — và MỘT LƯỢT BỊ MẤT TRẮNG khỏi trí nhớ hội thoại. Người dùng      │
 * │ thấy Trợ lý "quên" câu vừa nói mà không hiểu vì sao.                      │
 * │                                                                          │
 * │ Nhưng NHÂN VIÊN thì chạy song song thoải mái — họ là hàm stateless,      │
 * │ mỗi người một phiên riêng. Hai trạng thái này ĐỘC LẬP, và giao diện phải  │
 * │ nói được cả hai: "Trợ lý đang nghĩ" và "2 nhân viên đang làm".            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** Tối đa bao nhiêu tin chờ trước khi ta bảo người dùng chậm lại. */
export const MAX_QUEUED = 12;

export type MailItem =
  /** Người dùng nhắn trong lúc Trợ lý bận. */
  | { kind: 'user'; text: string; at: number }
  /** Một ca vừa chạy xong, cần Trợ lý tổng kết. */
  | { kind: 'report'; planId: string; at: number };

export class Mailbox {
  private items: MailItem[] = [];
  private busy = false;

  get size(): number {
    return this.items.length;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** true nếu nhận được; false nếu hàng đợi đã đầy. */
  push(item: MailItem): boolean {
    if (this.items.length >= MAX_QUEUED) return false;
    this.items.push(item);
    return true;
  }

  /** Bỏ hết — dùng khi người dùng `/stop`. Việc đã huỷ thì tin chờ cũng vô nghĩa. */
  clear(): number {
    const n = this.items.length;
    this.items = [];
    return n;
  }

  /**
   * Lấy lô tiếp theo. GOM các tin người dùng liên tiếp làm MỘT.
   *
   * Người dùng gõ ba câu trong lúc Trợ lý bận thì ba câu đó là **một ý** —
   * xử lý riêng lẻ vừa tốn ba lượt gọi, vừa khiến Trợ lý trả lời câu 1 khi đã
   * có ngữ cảnh của câu 3. Gom lại: rẻ hơn và đúng hơn.
   *
   * Tin `report` KHÔNG gom — mỗi ca một bản tổng kết.
   */
  take(): MailItem[] | undefined {
    const first = this.items.shift();
    if (!first) return undefined;
    if (first.kind !== 'user') return [first];

    const batch: MailItem[] = [first];
    while (this.items[0]?.kind === 'user') batch.push(this.items.shift()!);
    return batch;
  }

  private chain: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /**
   * Khoá Trợ lý — MUTEX THẬT, xếp hàng chứ không phải chỉ một lá cờ.
   *
   * Một lá cờ `busy = true/false` không đủ: `run()` gọi `plan()` rồi `report()`
   * từ một nhánh khác với vòng bơm, hai bên cùng đặt cờ, và bên nào xong trước
   * cũng gỡ cờ của bên kia — đúng lại cái lỗi hai lượt gọi chồng nhau mà cả
   * module này sinh ra để tránh.
   */
  lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      this.depth++;
      this.busy = true;
      try {
        return await fn();
      } finally {
        this.depth--;
        if (this.depth === 0) this.busy = false;
      }
    });
    // Giữ chuỗi sống kể cả khi một mắt xích ném lỗi.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  }
}

/**
 * Gộp nhiều tin của người dùng thành một câu cho Trợ lý.
 *
 * Dựng bằng CODE, không phải một lượt gọi LLM để "tóm tắt" — chuyện đó sẽ đúng
 * là mua sự mượt mà bằng token, thứ mà bốn tiêu chí cấm.
 */
export function mergeUserText(items: readonly MailItem[]): string {
  const texts = items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text);
  if (texts.length === 1) return texts[0]!;
  return (
    `Bạn vừa nhắn ${texts.length} tin liên tiếp trong lúc mình đang bận. ` +
    `Đọc cả ${texts.length} rồi trả lời như một yêu cầu duy nhất:\n` +
    texts.map((t, i) => `${i + 1}. ${t}`).join('\n')
  );
}
