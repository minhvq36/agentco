/**
 * KIỂU DÙNG CHUNG CỦA CÁC KHỐI RIÊNG-CỦA-HÃNG. → `../ArmDialog.tsx`
 *
 * Đặt ở đây thay vì khai lại trong từng file: mỗi khối là một mảnh của **cùng
 * một hộp thoại**, và ba bản của cùng một hình dạng là ba chỗ để lệch — lớp lỗi
 * đã đốt dự án này nhiều lần (`agentSlot` vs `arrange`).
 *
 * ⚠ Hình dạng phải khớp `lib/api.ts` — đây là dữ liệu **về đường dây**, không
 * phải mô hình của giao diện. Đổi API mà quên đổi ở đây thì TypeScript kêu ngay
 * tại chỗ gọi, chứ không im lặng.
 */

/** Một lượt đăng nhập bằng mã thiết bị đang chạy. → `api.oauthDeviceStart` */
export interface DeviceLogin {
  state: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
}

/**
 * Kết quả tra bản cài app. → `api.armRepos` · SPEC-arms §5h·7o
 *
 * ⚠ BA trạng thái, không phải hai. `null` = chưa tra; `{ failed }` = **không tra
 * được**; `installed: []` = tra được và câu trả lời là **chưa cài**. Gộp hai ca
 * cuối là hoặc chặn oan người đã cài, hoặc thả người chưa cài.
 */
export type RepoScanState =
  | { login: string; installed: string[]; seen: number }
  | { failed: true }
  | null;

/** Cửa sang màn hình phạm vi của hãng. → `catalog.ts §scope` */
export interface ArmScope {
  say: string;
  url: string;
}
