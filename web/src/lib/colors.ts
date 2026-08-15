/**
 * Màu đại diện của agent. → docs/SPEC-offices.md §6
 *
 * BĂM từ id chứ không lưu — bản sao của `agentHue` trong `src/core/plans.ts`.
 * Thêm/bớt người không làm đổi màu người khác, và không sinh thêm một file
 * cấu hình nữa để lệch.
 *
 * Backend cũng gửi `hue` xuống trong canvas; hàm này để dùng cho log, nơi ta chỉ
 * có id vai trò mà không có node.
 */
export function agentHue(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const raw = Math.abs(h) % 335;
  // Tránh dải 45–70°: vàng trên nền giấy sáng đọc không ra.
  return raw < 45 ? raw : raw + 25;
}

/**
 * Màu chữ và nền chip.
 *
 * `light-dark()` chứ không phải một giá trị cố định: một màu đủ tương phản trên
 * giấy sáng sẽ chìm trên nền tối, và ngược lại. Cần `color-scheme: light dark`
 * trên `:root` thì hàm này mới hoạt động (đã đặt trong index.css).
 */
export function agentInk(hue: number): string {
  return `light-dark(oklch(0.5 0.15 ${hue}), oklch(0.78 0.12 ${hue}))`;
}

export function agentWash(hue: number): string {
  return `light-dark(oklch(0.62 0.15 ${hue} / 0.13), oklch(0.72 0.14 ${hue} / 0.16))`;
}
