/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "DÙNG APP CỦA BẠN" — gập lại, nhưng KHÔNG giấu. → SPEC-arms §5h·7h       │
 * │                                                                          │
 * │ ⚠ §5h·7h từng ghi ô này *"là công dân hạng nhất"* trong khi **0 dòng mã** │
 * │ tồn tại (bắt 27/08). Đây là phần thi hành, và nó đứng trong khối đăng     │
 * │ nhập vì nó phải được quyết định TRƯỚC khi bấm Đăng nhập — đổi client sau  │
 * │ khi đã có chìa thì chìa cũ vẫn thuộc client cũ.                           │
 * │                                                                          │
 * │ Gập lại vì 99% người dùng không cần; hiện ra được vì 1% còn lại là khách  │
 * │ doanh nghiệp, và với họ đây là điều kiện để dùng sản phẩm. Đang bật thì   │
 * │ huy hiệu hiện ngay ở nhãn — một chế độ đổi hành vi mà gập kín là cái bẫy. │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';

export function OwnClient({
  name,
  own,
  value,
  onChange,
  onSave,
}: {
  /** Tên hãng — "App của riêng bạn" phải nói rõ app **của hãng nào**. */
  name: string;
  /** Đã LƯU client của khách chưa. Khác `value !== ''` (thứ đang gõ dở). */
  own: boolean;
  value: string;
  onChange(v: string): void;
  onSave(): void;
}) {
  return (
    <details className="mt-2 border-t border-line/60 pt-2" open={own}>
      <summary className="cursor-pointer text-[11px] text-muted">
        Dùng {name} App của riêng bạn {own && <span className="text-accent">· đang bật</span>}
      </summary>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        Mặc định đăng nhập đi qua app của agentco. Muốn đứng tên chính bạn thì tạo một {name} App rồi
        dán <b>Client ID</b> vào đây. Để trống = quay về app của agentco.
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <Input
          className="flex-1 font-mono text-[12px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Iv23li…"
        />
        <Button size="sm" onClick={onSave}>
          Lưu
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Client ID là <b>dữ liệu công khai</b> — đừng dán client secret hay private key.
      </p>
    </details>
  );
}
