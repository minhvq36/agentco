/**
 * Assistant — trợ lý của MỘT văn phòng. Session dài, đối thoại với người, chia việc.
 *
 * → docs/SPEC-offices.md §4
 *
 * Assistant KHÔNG tự làm việc tay chân, KHÔNG đọc file lớn, KHÔNG đọc transcript
 * thô của worker. Nó chỉ thấy: pitch của các vai trò ĐANG TRỰC, và receipt.
 *
 * Assistant KHÔNG gắn MCP: nó resume liên tục, mà MCP phá prompt cache khi resume
 * (issue #247) → mất ~36.000 token quy đổi mỗi lượt. Việc vặt cần MCP đi qua
 * worker ẩn `concierge` (M1) — người dùng chỉ thấy "Trợ lý dùng được tool này".
 */

import fs from 'node:fs';
import path from 'node:path';

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { activeOptions, findArm, folderRoots } from './catalog.js';
import { companyPaths } from './paths.js';
import { readOAuth } from './secrets.js';
import type { LoadedOffice } from './config.js';
import { noteRateLimit } from './energy.js';
import { LOOKUP_PROMPT, buildAssistantPrompt } from './prompt.js';
import { delivered } from './scheduler.js';
import { addUsage, classifyError, sayError } from './worker.js';
import {
  DeliverSchema,
  EMPTY_USAGE,
  LessonSchema,
  RunError,
  TaskBriefSchema,
  hasShell,
  type Deliver,
  type Lesson,
  type Plan,
  type PlanStep,
  type Receipt,
  type Role,
  type Tier,
  type Usage,
} from './types.js';
import { truncateToTokens } from './tokens.js';

/**
 * Khâu lập kế hoạch KHÔNG chia được việc, và muốn HỎI LẠI. → SPEC-offices.md §6
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TRƯỚC 20/08, KHÂU NÀY CÓ ĐÚNG MỘT CỬA RA — và đó là cả vấn đề.          │
 * │                                                                          │
 * │ `route()` có `intent: 'ask'`: Trợ lý ĐƯỢC PHÉP hỏi lại khi trò chuyện.   │
 * │ `plan()` thì không có gì cả — hình dạng hợp lệ duy nhất là một kế hoạch  │
 * │ hoàn chỉnh. Nên khi planner thật sự cần một thông tin, nó KHÔNG CÓ CÁCH  │
 * │ HỢP LỆ để nói ra: nó rơi khỏi giao thức, trả về văn xuôi, và ta gọi cái  │
 * │ rơi đó là "lỗi parse" rồi đổ cho cách người dùng diễn đạt.               │
 * │                                                                          │
 * │ Nguyên văn đo được 20/08 (`.state/plan-failure.log`):                     │
 * │   *"Bạn cho mình biết bản dịch tiếng Việt đã có trước đó của doc-2.md và │
 * │   doc-3.md đang nằm ở đường dẫn nào không?"*                             │
 * │ Một câu hỏi hoàn toàn hợp lý, bị hệ thống biến thành một lỗi.            │
 * │                                                                          │
 * │ Bảng kê kết quả (§2.4) chữa ĐÚNG ca đó. Cửa này chữa CẢ LỚP: sẽ luôn có  │
 * │ lúc planner cần hỏi, và ta không đoán trước được là lúc nào.             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `discriminatedUnion` KHÔNG dùng được ở đây — hai nhánh không có khoá chung để
 * phân biệt, và bắt model điền một trường `kind` là thêm một chỗ để nó quên.
 * `union` thử `ask` TRƯỚC: nhánh kế hoạch đòi `tasks` tối thiểu 1 phần tử nên
 * hai nhánh không thể cùng khớp.
 */
const PlanAskSchema = z.object({ ask: z.string().min(1) });

const PlanTasksSchema = z.object({
  steps: z.array(z.string()).min(1).max(6),
  tasks: z
    .array(
      z.object({
        task_id: z.string(),
        role: z.string(),
        goal: z.string(),
        inputs: z.array(z.object({ path: z.string() })).default([]),
        outputs: z.array(z.object({ path: z.string() })).default([]),
        constraints: z.array(z.string()).default([]),
        deps: z.array(z.string()).default([]),
        step: z.number().int().nonnegative().default(0),
        // Model quên khai thì KHÔNG mặc định cứng ở đây — `plan()` điền bằng
        // mặc định của văn phòng. Đóng đinh 'file' tại chỗ này là làm cho
        // `default_deliver: reply` im lặng vô tác dụng đúng lúc model quên.
        deliver: DeliverSchema.optional(),
      }),
    )
    .min(1),
});

const PlanOutputSchema = z.union([PlanAskSchema, PlanTasksSchema]);

/**
 * Cửa cứu hộ: một object chỉ có `say`, thiếu mỗi `intent`. → `decideRoute` cửa 4
 *
 * ⚠ CỐ Ý KHÔNG `.strict()`. Ca thật gồm cả `{"intent":"answer","say":"…"}` —
 * model bịa một tên cửa không có trong danh sách. Bắt chặt ở đây là vứt đi đúng
 * những ca ta dựng cửa này để cứu.
 */
const BareSaySchema = z.object({ say: z.string().min(1) });

/**
 * Kế hoạch model vừa viết ra, CHƯA đóng khung đường dẫn và chưa gắn `plan_id`.
 *
 * Tách tên riêng vì nó đi qua HAI cửa: khâu `plan()` bình thường, và cửa cứu hộ
 * ở `route()` khi model trả về một kế hoạch trong lúc lẽ ra phải định tuyến.
 */
export type PlanDraft = z.infer<typeof PlanTasksSchema>;

/** Kế hoạch đã chia xong, hoặc một câu hỏi ngược lại cho người dùng. */
export type PlanOrAsk = { kind: 'plan'; plan: Plan } | { kind: 'ask'; say: string };

/**
 * Bốn kết quả định tuyến. → SPEC-offices.md §6
 *
 * `scope` trên intent `task` là thứ quyết định log đọc được hay không: `new`
 * sinh một Plan độc lập, `refine` gắn vào Plan đang chạy. Assistant quyết trên
 * session của nó (nó có cả lịch sử hội thoại) chứ không suy ra bằng heuristic
 * ở client — client không biết hai câu có cùng một việc hay không.
 */
const RouteSchema = z.discriminatedUnion('intent', [
  z.object({ intent: z.literal('chat'), say: z.string().min(1) }),
  z.object({ intent: z.literal('ask'), say: z.string().min(1) }),
  /**
   * `lookup` — WORKER ẨN. Đọc để TRẢ LỜI, không tạo ra gì. → SPEC-offices.md §6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO CÓ CỬA THỨ TƯ, VÀ VÌ SAO NÓ KHÔNG PHẢI MỘT TOOL CỦA TRỢ LÝ.      │
   * │                                                                          │
   * │ Ca đo được 20/08: *"nội dung chính của doc-2.md là gì"* → một lượt lập   │
   * │ kế hoạch + một worker đủ prefix (**sàn ~13 200 token**) để đọc một file   │
   * │ rồi thuật lại. Người dùng gọi đúng tên: *"Trợ lý khá ngơ"*.               │
   * │                                                                          │
   * │ Ba đường, và chỉ đường thứ ba rẻ ở CẢ HAI cột:                            │
   * │                                                                          │
   * │              tốn NGAY                          tốn MÃI                    │
   * │   DAG        plan + sàn 13 200                 0                          │
   * │   Trợ lý grep ~0                               nội dung file × MỌI lượt   │
   * │   lookup     1 one-shot, prefix tí xíu         0                          │
   * │                                                                          │
   * │ Cột thứ hai là lý do KHÔNG trao `Grep` cho Trợ lý: ngữ cảnh Trợ lý là     │
   * │ thứ DUY NHẤT không bao giờ bị vứt đi. Một PDF 34 trang bóc ra text rơi    │
   * │ vào đó là 10–20K token bị `cache_read` lại ở mọi lượt cho tới `/clear`.   │
   * │                                                                          │
   * │ Và KHÔNG làm nó thành MCP tool như bản phác thảo `concierge` ban đầu:     │
   * │ MCP phá prompt cache khi resume (~36K/lượt) mà `route()` resume ở MỌI     │
   * │ tin nhắn. Là một INTENT thì cùng ý tưởng, 0 đồng cache.                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `paths` TỪNG BẮT BUỘC ≥1. NỚI RA 24/08 (user chốt) — và lý do là SẢN     │
   * │ PHẨM, không phải kiến trúc.                                              │
   * │                                                                          │
   * │ Luật cũ: *"không nêu được tên file thì dùng `ask`, đừng thả agent đi mò"* │
   * │ — đúng khi thế giới của văn phòng chỉ có tủ tài liệu. Hậu quả thật ở một  │
   * │ văn phòng mới tinh: người dùng hỏi *"thời tiết hôm nay"*, *"quán ăn"*,    │
   * │ *"tin tức"* và nhận về *"văn phòng mình chưa có nhân viên phụ trách"*.    │
   * │                                                                          │
   * │ User bác bằng một câu không cãi được: *"một người non-code bán hoa có     │
   * │ vào tạo nhân viên chuyên nghiệp không, hay họ sẽ hỏi vu vơ kiểu quán ăn,  │
   * │ thời tiết, tin tức?"*. Và sổ đã ghi sẵn thứ tự lo: rủi ro thật là **không │
   * │ có người dùng (~90%)**, không phải kiến trúc chưa sạch (~1%). Lượt tiếp   │
   * │ xúc đầu tiên không có lần thứ hai.                                        │
   * │                                                                          │
   * │ Vì sao KHÔNG đẻ intent thứ năm: `route()` chạy ở MỌI tin nhắn, nên mỗi    │
   * │ intent là token vĩnh viễn trong prefix hội thoại. `lookup` vốn đã là làn  │
   * │ *"trả lời một câu hỏi, không bàn giao gì"* — cho nó tra web là NỚI một    │
   * │ làn đã có, không mở làn mới. Ba hàng rào giữ nguyên: tool chỉ-đọc ·       │
   * │ không ghi được file · session chết cùng lượt gọi.                         │
   * │                                                                          │
   * │ ⚠ RANH GIỚI PHẢI SẮC, và đây là rủi ro thật của bản nới này: **`lookup`   │
   * │ TRẢ LỜI, không BÀN GIAO.** Thứ người dùng giữ lại (file, báo cáo, bảng)   │
   * │ luôn là `task` + nhân viên. Định tuyến quá tay sang đây thì họ nhận một   │
   * │ câu trong ô chat và **không có artifact nào để mở**.                      │
   * │                                                                          │
   * │ Số đo trước khi nới: prefix worker ẩn 2 828 → 3 820 (**+992 token**, chỉ  │
   * │ trả khi lookup chạy). Một câu hỏi web thật: 29,8 s · $0,0827, so với      │
   * │ $0,13–0,14 của đường plan→worker.                                         │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * `paths` rỗng = câu hỏi phải tra web. Có `paths` = đọc đúng những file đó
   * (chúng vẫn được đối chiếu với đĩa ở `Office` trước khi ai đọc gì).
   */
  z.object({
    intent: z.literal('lookup'),
    paths: z.array(z.string()).default([]),
    question: z.string().min(1),
  }),
  z.object({
    intent: z.literal('task'),
    request: z.string().min(1),
    scope: z.enum(['new', 'refine']).default('new'),
  }),
]);
export type RouteDecision = z.infer<typeof RouteSchema>;

/**
 * Năm kết cục của một lượt định tuyến — ba cửa hợp lệ, hai cửa cứu hộ.
 *
 * `plan` và `garbled` KHÔNG phải thứ model được phép trả về; chúng là những gì
 * ta làm khi nó trả về thứ khác. Giữ chúng trong cùng một union để không chỗ nào
 * quên xử lý — xem `decideRoute`.
 */
export type RouteOutcome =
  /**
   * `salvaged` = đi qua một CỬA CỨU HỘ, không phải cửa chính. Không đổi hành vi
   * một chút nào — nó chỉ để ghi nhật ký. Một cửa cứu hộ không để lại dấu vết là
   * một cái phễu êm ái: model quên `intent` mãi mãi mà không ai biết, và ta mất
   * luôn tín hiệu để đi sửa ở chỗ đúng (prompt), không phải sửa mãi ở đây.
   */
  | (RouteDecision & { salvaged?: true })
  /** Model trả nguyên một KẾ HOẠCH thay vì một quyết định định tuyến. */
  | { intent: 'plan'; draft: PlanDraft }
  /** Trả về thứ không dùng được, VÀ không được cho người dùng nhìn thấy. */
  | { intent: 'garbled'; say: string; raw: string };

/**
 * Model vừa nói gì? Hàm THUẦN — 0 token, và đây là chỗ một bug đã lọt.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG ĐÃ SỬA (20/08): KẾ HOẠCH RÒ RA Ô CHAT.                              │
 * │                                                                          │
 * │ Bản trước, khi `RouteSchema` không khớp:                                 │
 * │     `parsed ?? { intent: 'chat', say: text.trim() }`                     │
 * │ — tức là **văn bản thô của model đi thẳng lên mặt người dùng**.           │
 * │                                                                          │
 * │ Ca đo được trên máy người dùng: họ hỏi *"nêu cho tôi 10 thuật ngữ"*, Trợ  │
 * │ lý hỏi lại *"lấy từ tài liệu nào"*, họ đáp *"bất kỳ, random cũng được"* — │
 * │ và ô chat nhả ra nguyên một khối `json` với `steps`/`tasks`/`deps`. Model │
 * │ đã trả lời ĐÚNG NỘI DUNG (giao `nguoi-dich`, trỏ đúng file, `deliver:     │
 * │ reply`) nhưng qua SAI CỬA, nên `run()` không bao giờ được gọi và **không  │
 * │ ai làm việc đó cả**. Người dùng trả tiền một lượt để nhận về một đoạn mã. │
 * │                                                                          │
 * │ Vì sao model làm thế: `ASSISTANT_CORE` mang mục "Planning output" trong   │
 * │ prefix của MỌI lượt — `route()` và `plan()` cố ý dùng chung một prefix để │
 * │ chung một cache entry. Ngay sau một câu `ask`, "bất kỳ cũng được" đọc lên │
 * │ giống hệt tín hiệu *"chia việc đi"*. Đây là hệ quả của một đánh đổi đã    │
 * │ chốt, không phải một model tồi.                                          │
 * │                                                                          │
 * │ Nên chữa bằng CƠ CHẾ, không bằng lời dặn thêm trong prompt: dặn thì tốn   │
 * │ token vĩnh viễn, chỉ là gợi ý, và luật 19/08 đã nói *đừng dặn model đừng  │
 * │ làm*. Ở đây ta không ngăn được nó viết ra — nhưng ta ĐANG CẦM một kế      │
 * │ hoạch hợp lệ đã trả tiền, nên việc đúng là DÙNG NÓ.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Thứ tự thử có chủ ý:
 *
 *  1. `RouteSchema`   — cửa chính, ca thường.
 *  2. `PlanTasksSchema` — nó lập kế hoạch mất rồi → nhặt về, đừng gọi lại.
 *  3. `PlanAskSchema`  — `{"ask":"…"}` là một CÂU HỎI hợp lệ ở khâu lập kế
 *     hoạch; hình dạng khác nhưng ý nghĩa trùng khít `intent: 'ask'`.
 *  4. Còn lại: **có JSON hay không** mới là câu hỏi quyết định.
 *
 * Bước 4 là luật mới, và nó hẹp có chủ ý: **văn xuôi vẫn hiện như cũ**. Model
 * đáp "Chào bạn!" mà lỡ quên bọc JSON thì hiện câu đó vẫn đúng hơn là nuốt đi.
 * Thứ bị chặn chỉ là JSON — một khối JSON KHÔNG BAO GIỜ là câu nói cho người
 * dùng, nó là tin nhắn giao thức đi lạc cửa. Phân biệt được bằng `JSON.parse`,
 * tức là bằng sự việc, không bằng phỏng đoán trên câu chữ.
 */
export function decideRoute(text: string): RouteOutcome {
  const routed = extractJson(text, RouteSchema);
  if (routed) return routed;

  const draft = extractJson(text, PlanTasksSchema);
  if (draft) return { intent: 'plan', draft };

  const asked = extractJson(text, PlanAskSchema);
  if (asked) return { intent: 'ask', say: asked.ask.trim() };

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CỬA 4 — `{"say": "…"}` THIẾU MỖI CHỮ `intent`. (bug user bắt 28/08)   │
   * │                                                                          │
   * │ Đây KHÔNG phải giả thuyết. Nguyên văn trong `route-failure.log`, hai lượt │
   * │ cách nhau 29 giây, sau khi user rút dây cánh tay GitHub:                  │
   * │                                                                          │
   * │   {"say":"Kết nối GitHub hiện không còn nữa, nên mình không đọc được      │
   * │    README của repo toeic-learning lúc này. Bạn cần kết nối lại GitHub…"}  │
   * │                                                                          │
   * │ Model trả lời **đúng, đủ, và bằng tiếng người**. Ta vứt nó đi rồi thay    │
   * │ bằng một câu xin lỗi bảo người dùng gõ lại — và họ gõ lại thì ra y hệt,   │
   * │ vì model có sai đâu mà đổi. User nói đúng cả ba vế: *"đâu phải lỗi của    │
   * │ LLM"* · *"rất nguy hiểm cho multilanguage"* · *"có nhắn lại thì kết quả   │
   * │ cũng ra vậy"*.                                                            │
   * │                                                                          │
   * │ `say` là trường của `chat` **và** của `ask`, nên thiếu `intent` là thật   │
   * │ sự không biết nó muốn cửa nào. Chọn `chat` vì bất đối xứng: `ask` hứa     │
   * │ *"mình đang chờ bạn trả lời"* — hứa nhầm điều đó tệ hơn là không hứa.     │
   * │ Cả hai cửa đều chỉ in câu đó ra, nên người dùng không mất gì.             │
   * │                                                                          │
   * │ ⚠ Cùng khuôn với hai cửa cứu hộ ngay trên: ta ĐANG CẦM một câu trả lời    │
   * │ đã trả tiền và đọc được — việc đúng là DÙNG NÓ, không phải bắt người dùng │
   * │ mua lại lượt nữa.                                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const bare = extractJson(text, BareSaySchema);
  if (bare) return { intent: 'chat', say: bare.say.trim(), salvaged: true };

  const raw = text.trim();
  if (!raw) {
    return {
      intent: 'garbled',
      // Ca này `route()` cũng thử lại một lượt trước khi câu dưới tới được mặt
      // người dùng — rỗng thường là chập nhất thời, tức đúng ca một lượt nữa
      // giải quyết được mà không cần phiền ai.
      say: 'Mình gọi được model nhưng nó không trả về gì cả — lỗi đường truyền, không phải cách bạn nói. Nhắn lại giúp mình nhé.',
      raw: '',
    };
  }
  if (hasJsonObject(raw)) {
    return {
      intent: 'garbled',
      // Không trích lời model ở đây, khác hẳn `planFailed`. Ở đó thứ model nói
      // là VĂN XUÔI — đọc được, và chính nó là thông tin. Ở đây nó là JSON: dán
      // một đoạn mã trước mặt người mở tiệm hoa không thêm được gì ngoài hoang
      // mang. Bản nguyên văn đi vào `.state/route-failure.log` cho người sửa lỗi.
      /**
       * ⚠ PHAO CUỐI — chỉ tới đây khi **lượt sửa ở `route()` cũng hỏng**.
       *
       * Câu cũ ghim ở đây có ba tật, cả ba đã cắn thật (28/08): nó đoán nguyên
       * nhân (*"lỗi của mình"* trong khi thật ra kết nối đã bị rút), nó ghim
       * tiếng Việt giữa một dòng chat đáng lẽ theo tiếng người dùng, và nó bảo
       * *"nhắn lại y nguyên"* — một lời khuyên **tất định sai**: model có sai
       * đâu mà đổi, gõ lại là ra y hệt.
       *
       * Câu mới không đoán gì cả và không đổ lỗi cho ai. Nó nói đúng hai điều ta
       * BIẾT — chưa làm được, và có một đường đi tiếp khác — vì đó là toàn bộ
       * thứ có thật ở nhánh này.
       */
      say:
        'Lượt vừa rồi chưa ra được câu trả lời dùng được. Bạn thử nói lại theo cách khác, ' +
        'hoặc chia nhỏ yêu cầu ra giúp mình.',
      raw,
    };
  }
  return { intent: 'chat', say: raw };
}

/**
 * Phần CHỮ do model viết ra trong một kết cục định tuyến. Hàm THUẦN, 0 token.
 *
 * Dùng cho cổng hậu kiểm `staleArmMentions`. Ba cửa hợp lệ đều có một trường
 * chữ, và cả ba đều đi tới mặt người dùng hoặc vào `request` của kế hoạch — nên
 * cả ba đều phải soi.
 *
 * `garbled` trả rỗng CÓ CHỦ Ý: câu của nó là câu cứu hộ do TA viết, không phải
 * lời model. Soi nó là tự kiểm tra chính mình. `plan` cũng rỗng — draft là cấu
 * trúc, và vai trò trong đó đã được scheduler đối chiếu với `assignableRoles()`.
 */
export function routeText(r: RouteOutcome): string {
  if (r.intent === 'chat' || r.intent === 'ask') return r.say;
  if (r.intent === 'task') return r.request;
  if (r.intent === 'lookup') return r.question;
  return '';
}

/** Có ít nhất một object JSON parse được trong chuỗi? Sự việc, không phải phỏng đoán. */
function hasJsonObject(text: string): boolean {
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last <= first) return false;
  try {
    return typeof JSON.parse(text.slice(first, last + 1)) === 'object';
  } catch {
    return false;
  }
}

const ReportSchema = z.object({
  say: z.string().min(1),
  lessons: z.array(LessonSchema).max(2).default([]),
});

export interface AssistantResult<T> {
  value: T;
  usage: Usage;
}

/**
 * Bọc một lượt hỏi thành streaming input. Xem khối chú thích ở `run()`.
 *
 * Yield đúng MỘT tin rồi kết thúc: SDK nhận đủ đầu vào và đóng stream ngay, nên
 * không có ca treo nào. `session_id` để rỗng — SDK tự điền; con trỏ session
 * thật đi qua `options.resume`.
 */
async function* oneShot(text: string): AsyncGenerator<SDKUserMessage> {
  yield {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  } as SDKUserMessage;
}

/**
 * Ca này có gì để học không? Quyết bằng CODE, trước khi hỏi model.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ĐỪNG DẶN MODEL ĐỪNG LÀM — ĐỪNG CHO NÓ CƠ HỘI LÀM.                        │
 * │                                                                          │
 * │ Bản trước LUÔN kèm trường `lessons` vào mọi báo cáo, kèm câu dặn "Việc    │
 * │ chạy trơn tru không phải bài học". Hỏi một model "bạn học được gì?" thì   │
 * │ nó gần như luôn nặn ra một câu, và lời dặn không cản được.                │
 * │                                                                          │
 * │ Ca thật, 19/08: một ca chạy trơn tru hoàn toàn (1 việc, done, không       │
 * │ blocked, không sửa receipt) đẻ ra node `k/shared/san-pham-giam-gia-60-…`. │
 * │ Nội dung của nó là bản diễn giải LỆCH của một câu trong tài liệu người    │
 * │ dùng: chính sách viết "trên 50% không đổi trả", node ghi "giảm 60%        │
 * │ THƯỜNG không được đổi trả". Sai ngưỡng, thêm chữ "thường" mà chính sách   │
 * │ không có, và nằm trong prefix của mọi nhân viên cho tới khi hết hạn.      │
 * │                                                                          │
 * │ Trợ lý viết được câu đó mà chưa từng đọc tài liệu nào — nó chỉ nhìn thấy  │
 * │ MỘT dòng `say` của nhân viên. Đó là nghe kể lại, không phải bài học.      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ngưỡng: chỉ hỏi khi ca **đi đến đích** VÀ có DẤU VẾT trục trặc trên đường —
 * cả hai đều quan sát được, không phải thứ suy đoán. Vế "đi đến đích" là vế mới
 * (29/08) và là vế quan trọng hơn; lý do đầy đủ ở `learnable` ngay dưới.
 * Ca êm đẹp thì kinh nghiệm thật của người dùng vẫn có đường vào kho, và là
 * đường tốt hơn: nói với Trợ lý rồi `/clear` → node GHI NHỚ 0.9.
 *
 * ⚠ CỐ Ý KHÔNG dùng SỐ LƯỢT làm dấu hiệu, dù rất cám dỗ.
 *
 * Bản nháp đầu của hàm này có thêm `usage.turns >= 8`, và bộ test đã bác bỏ nó
 * ngay: ca 19/08 chạy đúng **9 lượt** — tức là điều kiện đó cho qua đúng cái ca
 * nó sinh ra để chặn. Lý do sâu hơn nằm ở §7: *số lượt là thuộc tính của MODEL
 * và độ khó việc*, đo được là haiku 10 lượt vs sonnet 4 lượt cho cùng một việc.
 * Lấy nó làm tín hiệu "có trục trặc" nghĩa là mọi văn phòng chạy `eco` đều bị
 * coi là đang trục trặc, còn `deep` thì không bao giờ.
 *
 * Bốn dấu hiệu đều KHÔNG phụ thuộc model: việc hỏng, việc bị chặn, receipt phải
 * sửa lại, hoặc nhân viên LẶP THAO TÁC.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `looped` LÀ CÁCH ĐÚNG ĐỂ BẮT "FLOW BỊ LOOP" — và nó KHÔNG phải số lượt.  │
 * │                                                                          │
 * │ Đo bằng LẶP THAO TÁC (đọc lại file đã đọc, đọc lại file vừa ghi, gọi lại │
 * │ y nguyên một tool), suy từ luồng `tool_use` mà worker vốn đã bóc sẵn.    │
 * │ Cả ba đều là vi phạm một luật `CORE_PROMPT` đã viết thành lời, nên đây   │
 * │ không phải heuristic mới — chỉ là đo xem kỷ luật đã tuyên bố có được     │
 * │ tuân thủ không. Và nó model-independent: haiku hay sonnet thì đọc hai    │
 * │ lần vẫn là đọc hai lần. → `worker.ts → observeCall`                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Đánh đổi đã biết và chấp nhận: kho tri thức lớn chậm hẳn lại.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TÍN HIỆU THỨ NĂM: MA SÁT CỦA CON NGƯỜI (20/08).                         │
 * │                                                                          │
 * │ Bốn tín hiệu đầu đều đọc từ `receipts` — tức là chúng đo **ĐỘ KHÓ CỦA CỖ │
 * │ MÁY**. Có một hạng ca mà cả bốn đều im: cỗ máy chạy hoàn hảo, còn con     │
 * │ người thì vật lộn.                                                       │
 * │                                                                          │
 * │ Ca thật 20/08. Người dùng: *"doc-2, doc-3 thiếu file thuật ngữ"*. Bốn    │
 * │ lượt qua lại — Trợ lý bảo họ đi kiểm đường dẫn, rồi hỏi họ file cũ nằm ở │
 * │ đâu, rồi một lượt lập kế hoạch chết hẳn — cho tới khi người dùng phải tự │
 * │ nghĩ ra giải pháp: *"thì bạn phải kêu người dịch tạo bổ sung đi chứ"*.   │
 * │ Ca chạy sau đó: 2 task, cả hai `done`, receipt sạch bong. **0 bài học.** │
 * │                                                                          │
 * │ Văn phòng vừa học được một điều rất giá trị — *"ở đây, muốn làm tiếp     │
 * │ trên một kết quả cũ thì phải nói thẳng là giao cho ai làm lại"* — và vứt │
 * │ nó đi, vì nó không nằm trong bất kỳ biên nhận nào.                       │
 * │                                                                          │
 * │ `friction` = số lượt lập kế hoạch HỎNG hoặc PHẢI HỎI LẠI kể từ ca chạy   │
 * │ được gần nhất. Vẫn là **sự việc quan sát được**, đếm bằng code, 0 token, │
 * │ không phụ thuộc model — đúng cùng một luật đã bác bỏ `usage.turns`.      │
 * │                                                                          │
 * │ Và nó mở ra một LỚP bài học mới: kinh nghiệm về **cách giao việc trong   │
 * │ văn phòng này**, không phải về nội dung công việc. Đây là lớp duy nhất   │
 * │ học được từ chính người dùng mà không phải hỏi họ một câu nào.           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ Vì sao KHÔNG đếm số tin nhắn người dùng gõ, dù nghe tự nhiên hơn: người ta
 * nhắn nhiều vì nhiều lý do — nghĩ ra thêm ý, đổi ý, hay chỉ là gõ thành hai
 * dòng. Chỉ **lượt lập kế hoạch không ra được kế hoạch** mới là bằng chứng
 * chắc chắn rằng hệ thống đã bắt người dùng nói lại.
 */
export function worthLearning(
  receipts: readonly Receipt[],
  friction = 0,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CA CÒN CẢNH BÁO THÌ CHƯA PHẢI KINH NGHIỆM. (user chốt 29/08)          │
   * │ > *"nếu 1 công việc còn warning có nghĩa là còn leak, không thể coi đó   │
   * │ >  là kinh nghiệm được"*                                                 │
   * │                                                                          │
   * │ Đây là cảnh báo **cấp CA**, thứ `learnable` không nhìn thấy được vì nó    │
   * │ chỉ đọc MỘT biên nhận: file đã hứa mà không có trên đĩa (`missingOutputs`)│
   * │ · kết quả rơi ra ngoài văn phòng (`strays`) · đường dẫn bị kéo về khung   │
   * │ (`redirected`). Cả ba đều là *"chạy xong rồi nhưng còn rò"* — và một cách │
   * │ làm còn rò thì chưa phải một cách làm.                                   │
   * │                                                                          │
   * │ ⚠ Thứ tự tính TỪNG LÀ CHỖ HỎNG: `missingOutputs` vốn được tính SAU lượt   │
   * │ `report()` đã hỏi bài học xong, nên nó cảnh báo cho người dùng mà không   │
   * │ bao giờ chặn được một node nào. → `office.ts` chỗ dựng `leaked`           │
   * │                                                                          │
   * │ ⚠ KHÔNG áp cho nhánh `friction`: lớp đó học về **cách con người giao      │
   * │ việc**, và một cái file rơi sai chỗ không làm câu đó sai đi.              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  leaked = false,
): boolean {
  if (friction > 0) return true;
  if (leaked) return false;
  return receipts.some(learnable);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 RECEIPT NÀY CÓ ĐƯỢC LÀM **NGUỒN** BÀI HỌC KHÔNG. (user chốt 29/08)    │
 * │                                                                          │
 * │ HAI VẾ, và vế ① là vế MỚI — nó lật ngược cổng cũ:                        │
 * │   ① `delivered`   — **GIAO ĐƯỢC HÀNG**. Điều kiện CẦN, không thương lượng│
 * │   ② `agentFault`  — **CÓ VẤP**. Ngưỡng cũ, giữ nguyên: đường đi dễ quá   │
 * │                     thì cũng chưa chắc đáng lưu (user tái xác nhận).     │
 * │                                                                          │
 * │ ⚠ Vế ① là `delivered()`, KHÔNG phải `status === 'done'`. (user chốt:     │
 * │ *"done dựa trên đánh giá neo vào mục tiêu của user đã hoàn thành chưa"*) │
 * │ `status` là **lời khai của nhân viên**; `delivered` hỏi thêm một câu     │
 * │ QUAN SÁT ĐƯỢC: *có gì đáp xuống không* (`artifacts` · `landed`). Chính   │
 * │ kho này đã ghi lại khoảng cách ấy bằng tiếng Việt: *"hai task báo cáo    │
 * │ 'xong việc' (Facebook, YouTube) nhưng hệ thống đánh dấu failed"*. Học    │
 * │ từ một lời khai chưa ai kiểm là nhân bản đúng cái nói dối đó vào prefix. │
 * │ → [[agentco-deterministic-vs-signal]] · `scheduler.ts §delivered`        │
 * │                                                                          │
 * │ Cổng cũ chỉ có vế ②, nên nó bắn **đúng lúc ca vừa hỏng** — tức đúng lúc  │
 * │ bằng chứng yếu nhất. Hậu quả là một **BÁNH CÓC**: ca hỏng đẻ bài học →   │
 * │ `cold()` kéo đúng nó về ở task cùng chủ đề lần sau → nó **gây ra** lại   │
 * │ chính triệu chứng đã sinh ra nó → đẻ tiếp.                              │
 * │                                                                          │
 * │ ĐO ĐƯỢC 29/08, văn phòng `canh-tay`, 21 bài học của Trợ lý xếp theo      │
 * │ trạng thái ca đã đẻ ra chúng:                                           │
 * │                                                                          │
 * │   blocked  12 mẩu  ← **cả 10 mẩu đã chặn cánh tay trình duyệt nằm đây**  │
 * │   failed    3 mẩu  ← "đã thất bại 3 lần liên tiếp" — cùng hình dạng      │
 * │   done      6 mẩu  ← toàn cách-làm-chạy-được                            │
 * │                                                                          │
 * │ Ca thật đắt nhất, hai mẩu về cùng một chuyện:                           │
 * │   từ ca `blocked` 28/08: *"GitHub không merge được nhánh qua PR"*        │
 * │   từ ca `done`    28/08: *"đã có create_pull_request và merge_pull_..."* │
 * │ ⇒ Bài học từ ca hỏng không chỉ vô dụng — **nó SAI**. Ca hỏng chứng minh  │
 * │ *"lần này không xong"*; nó **không bao giờ** chứng minh *"không làm      │
 * │ được"*. Hai câu đó cách nhau rất xa, và model không phân biệt nổi.       │
 * │                                                                          │
 * │ ⚠ THỨ MẤT ĐI, ghi ra để cân lại được: ca hỏng **hẳn** không còn để lại   │
 * │ gì trong kho. Đó là CỐ Ý — một trục trặc chưa gỡ được là **tin báo cho   │
 * │ NGƯỜI DÙNG** (câu `blocked_on`, ô chat), không phải kinh nghiệm cho      │
 * │ nhân viên. Gửi nó vào prefix là gửi sai người đọc, đúng lỗi ① mà         │
 * │ `agentFault` đã mất công phân loại để tránh.                            │
 * │                                                                          │
 * │ ⚠ KHÔNG áp cho GHI NHỚ của Trợ lý (`isMemory`): thẩm quyền của nó đến    │
 * │ từ **người dùng**, không từ kết quả một ca. Gate nó theo ca chạy nghĩa   │
 * │ là vứt một quyết định của con người vì một task hỏng.                    │
 * │ ⚠ KHÔNG áp cho nhánh `friction`: đó là bài học về **cách giao việc**,    │
 * │ sinh ra từ ca chạy SẠCH, nên nó không dính bánh cóc này.                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function learnable(r: Receipt): boolean {
  return delivered(r) && agentFault(r);
}

/**
 * TRỤC TRẶC NÀY CÓ PHẢI DO MỘT AGENT TRONG VĂN PHÒNG GÂY RA KHÔNG?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CÂU HỎI *"CỦA AI"* PHẢI ĐƯỢC TRẢ LỜI TRƯỚC CÂU HỎI *"HỌC ĐƯỢC GÌ"*.      │
 * │ (user chốt 21/08)                                                        │
 * │                                                                          │
 * │ Bản trước bắn khi `status !== 'done'` — BẤT KỂ vì sao. Chạm trần chi phí │
 * │ là `failed`, nên mọi lượt chạm trần đều bị hỏi *"học được gì"*. Model bị  │
 * │ hỏi thì phải trả lời, và nó chỉ có đúng một thứ để kể: cái trần. Sản      │
 * │ phẩm đo được ngày 21/08 — hai node gần như y hệt nhau:                   │
 * │                                                                          │
 * │   "Phan-tich-standard liên tục chạm trần chi phí … nên nới max_usd"      │
 * │   "Việc nhóm+tổng hợp CSV có thể chạm trần … cân nhắc nới max_usd"       │
 * │                                                                          │
 * │ Ba thứ hỏng cùng lúc, và cái thứ hai là cái đắt:                         │
 * │                                                                          │
 * │  1. SAI NGƯỜI ĐỌC. Kinh nghiệm nằm trong prefix của MỌI worker. Worker   │
 * │     không sửa được `max_usd` — nó không có tay để làm việc đó. Lời khuyên│
 * │     ấy gửi cho CON NGƯỜI, mà con người không đọc kho tri thức; họ đọc ô  │
 * │     chat, nơi câu đó đã được nói rồi. Ta trả tiền vĩnh viễn để nhắc lại  │
 * │     một câu đã giao đúng cửa.                                            │
 * │  2. TỰ CHUỐC LẤY. Node vào prefix → prefix dài ra → mỗi lượt đắt lên →   │
 * │     **chạm trần dễ hơn**. Một bài học cảnh báo về chạm trần, mà cơ chế   │
 * │     tồn tại của nó là làm tăng chi phí. Nó sản xuất ra chính vấn đề nó   │
 * │     cảnh báo.                                                            │
 * │  3. SẼ SAI. Ngày người dùng nới trần, node vẫn nói "hay chạm trần" — và  │
 * │     node THẮNG, vì nó nằm sẵn trong đầu mọi nhân viên. Đúng lớp lỗi mà   │
 * │     luật *"ghi CÁCH LÀM, không ghi KIẾN THỨC"* sinh ra để chặn.          │
 * │                                                                          │
 * │ ⚠ VÌ SAO KHÔNG LỌC BẰNG PROMPT: prompt ĐÃ cấm, bằng hai dòng riêng biệt  │
 * │   (*"Không ghi con số, ngưỡng, giá"* và *"ghi CÁCH LÀM"*), và model vẫn  │
 * │   ghi ra hai node về ngưỡng chi phí. Một luật chỉ sống trong prompt là    │
 * │   một LỜI HỨA. Và LLM đặc biệt yếu ở đúng chỗ này — nó không phân biệt   │
 * │   nổi *"tôi làm sai"* với *"môi trường quanh tôi chặn tôi lại"*, vì cả    │
 * │   hai đều hiện ra trong ngữ cảnh của nó y hệt nhau: một lượt không xong. │
 * │   Nên đừng hỏi model câu đó. **Ta biết chắc, bằng dữ liệu.**             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `FailureKind` phân hoạch sạch theo *ai sửa được*:
 *
 * | kiểu | ai gây ra | agent làm gì được |
 * |---|---|---|
 * | `budget` · `max_turns` | trần NGƯỜI DÙNG đặt | không — nó không sửa cấu hình |
 * | `rate_limit` · `usage_limit` | hạ tầng / gói cước | không |
 * | `auth` | cấu hình máy | không |
 * | `stopped` | người dùng bấm Dừng | không, và đó không phải trục trặc |
 * | `other` | có thể là chính nó | có |
 *
 * Còn `reasked` (trả sai định dạng) và `looped` (lặp thao tác) thì luôn là việc
 * của chính agent — quan sát được trong luồng, model-independent.
 */
export function agentFault(r: Receipt): boolean {
  // Quan sát được trong luồng `tool_use`, model-independent, luôn là việc của
  // chính agent. Đứng trước vì nó chắc chắn nhất.
  if (r.reasked || r.looped) return true;

  /**
   * Có `failure` ⇒ vòng lặp bị cắt TỪ BÊN ngoài, và `blocked_on` lúc đó là câu
   * của HỆ THỐNG chứ không phải lời khai của nhân viên. Đây chính là chỗ bản
   * vá đầu của tôi sai: tôi bỏ luôn `blocked_on` khỏi tín hiệu, và làm mất một
   * ca có thật — nhân viên `done` nhưng tự ghi *"thiếu file thuật ngữ"* thì đó
   * là bài học đắt nhất trong kho. Hai `blocked_on` khác nguồn, và `failure`
   * chính là thứ phân biệt được chúng.
   */
  if (r.failure) return r.failure === 'other';

  // Không có `failure` ⇒ vòng lặp chạy hết, mọi thứ dưới đây là NHÂN VIÊN TỰ
  // KHAI. Lời khai của người trong cuộc, và nó đáng học.
  return r.status !== 'done' || !!r.blocked_on;
}

/**
 * Đóng khung mọi đường dẫn artifact của kế hoạch này vào thư mục RIÊNG của nó.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `T-01` LÀ SỐ THỨ TỰ TRONG MỘT KẾ HOẠCH, VÀ MỌI KẾ HOẠCH ĐỀU BẮT ĐẦU TỪ 1.│
 * │                                                                          │
 * │ Nên `artifacts/T-01/` là thư mục dùng CHUNG cho mọi lần chạy. Đo được    │
 * │ trên máy người dùng: văn phòng `noi-dung` có TÁM kế hoạch, cả tám cùng   │
 * │ đổ vào `artifacts/T-01/` — chín file lẫn lộn một chỗ, không có gì cho    │
 * │ biết file nào của lần chạy nào.                                          │
 * │                                                                          │
 * │ Hôm nay chưa mất gì vì tên file tình cờ khác nhau. Chạy lại một yêu cầu  │
 * │ giống lần trước là kết quả cũ bị GHI ĐÈ, không hỏi, không báo — đúng lớp │
 * │ lỗi "mất việc của người dùng, im lặng" ở §8.                             │
 * │                                                                          │
 * │ `Scheduler.validate` chỉ chặn hai task trong CÙNG một kế hoạch ghi đè    │
 * │ nhau; nó không biết gì về các kế hoạch trước.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Làm bằng CODE, không dặn model: `plan_id` được sinh ra ở đây, model không hề
 * biết nó. Hỏi model tự đặt đường dẫn duy nhất là trả tiền để mua lại đúng sự
 * bất định ta vừa loại bỏ.
 *
 * ⚠ CHỈ viết lại đường dẫn trỏ tới task CỦA CHÍNH KẾ HOẠCH NÀY. Người dùng có
 * quyền nói "sửa lại file hôm qua", và lúc đó `inputs` trỏ tới artifact của một
 * kế hoạch cũ — viết lại nó là chỉ nhân viên tới một file không tồn tại.
 */
export function artifactScoper(planId: string, taskIds: readonly string[]): (p: string) => string {
  const mine = new Set(taskIds);
  return (raw: string): string => {
    const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    const parts = p.split('/');
    if (parts[0] !== 'artifacts' || parts.length < 2) return raw;
    // Đã được đóng khung rồi (đường dẫn cũ do người dùng dán lại) — để nguyên.
    if (!mine.has(parts[1] ?? '')) return raw;
    return ['artifacts', planId, ...parts.slice(1)].join('/');
  };
}

/**
 * Đóng khung ĐƯỜNG RA của một task — và GIỮ LẠI phần đuôi người dùng đặt.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO TÁCH KHỎI `artifactScoper` (20/08).                              │
 * │                                                                          │
 * │ Hai bên trả lời hai câu hỏi khác nhau, và gộp chúng lại là lý do một ca   │
 * │ hỏng có thật:                                                            │
 * │                                                                          │
 * │  · `artifactScoper` (đầu VÀO) — "đường dẫn này trỏ tới task của chính kế │
 * │    hoạch này không?" Nếu không thì ĐỂ NGUYÊN, vì người dùng có quyền nói │
 * │    "sửa lại file hôm qua".                                               │
 * │  · `outputScoper` (đầu RA) — "task này ghi ở đâu?" Câu trả lời KHÔNG phụ │
 * │    thuộc vào chuỗi model viết ra: luôn là `artifacts/<plan>/<task>/`.     │
 * │                                                                          │
 * │ CA HỎNG: người dùng nói *"Lưu vào `artifacts/vi/doc-1.md`"*. Planner ghi  │
 * │ đúng chuỗi đó vào `outputs`, `artifactScoper` thấy `vi` không phải task   │
 * │ id nên để nguyên — và file rơi ra ngoài khung theo ca, mất luôn bảo đảm   │
 * │ "lần chạy sau không đè lần này". Ca đo được trên máy người dùng thì đi    │
 * │ nhánh kia: planner tự bỏ `vi/` để tuân luật trong prompt, nên **yêu cầu  │
 * │ tường minh của người dùng biến mất mà không ai nói một câu nào**.        │
 * │                                                                          │
 * │ Cả hai kết cục đều sai, và cả hai đều sinh ra từ việc để MODEL quyết một │
 * │ chuyện thuộc về CODE. Ở đây code quyết phần khung, model giữ phần đuôi:  │
 * │                                                                          │
 * │   artifacts/vi/doc-1.md   →  artifacts/<plan>/<task>/vi/doc-1.md         │
 * │   artifacts/T-01/x.md     →  artifacts/<plan>/T-01/x.md                  │
 * │   bao-cao.md              →  artifacts/<plan>/<task>/bao-cao.md          │
 * │                                                                          │
 * │ Người dùng giữ được cấu trúc thư mục mình muốn, hệ thống giữ được bảo    │
 * │ đảm không ghi đè, và `whereBlock` in ra đường dẫn THẬT nên không ai bị    │
 * │ lừa. → docs/SPEC-artifacts.md                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Idempotent: gọi lại trên kết quả của chính nó không đóng khung thêm lớp nữa.
 */
export function outputScoper(
  planId: string,
  taskId: string,
  /**
   * Gọi khi một đường dẫn ngoài văn phòng bị kéo về khung. Người gọi dùng nó để
   * nói ra chuyện đó với người dùng — xem `Plan.redirected`. Không truyền thì
   * hành vi y hệt bản cũ.
   */
  onRedirect?: (asked: string) => void,
): (p: string) => string {
  const home = `artifacts/${planId}/${taskId}`;
  return (raw: string): string => {
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 ĐƯỜNG DẪN TUYỆT ĐỐI → LẤY BASENAME. Bản trước lồng cả nó vào       │
     * │    trong khung, và đẻ ra một đường dẫn KHÔNG HỢP LỆ.                  │
     * │                                                                      │
     * │ Ca thật 22/08 22:06, in nguyên văn từ `P-260822-2206-ajcd.plan.json`: │
     * │                                                                      │
     * │   outputs: artifacts/P-…/T-01/ban-ke.md                               │
     * │          | artifacts/P-…/T-01/D:/Downloads/Programs Installation/…    │
     * │                                        ↑ chữ `D:` thành một THƯ MỤC   │
     * │                                                                      │
     * │ Trên Windows dấu hai chấm giữa segment là đường dẫn bất hợp lệ, nên   │
     * │ nhân viên đào **7 lượt · $0,3158** để `mkdir` một thứ không thể tồn   │
     * │ tại, rồi chết ở trần lượt. Ta không "từ chối một việc chưa hỗ trợ" —  │
     * │ ta **bịa ra một đường dẫn hỏng rồi giao cho nhân viên như mục tiêu**. │
     * │                                                                      │
     * │ Nhánh POSIX cũng sai, chỉ êm hơn: `/home/an/x.md` bị `^\/+` bóc đầu   │
     * │ rồi thành `artifacts/…/home/an/x.md` — hợp lệ, nhưng sai chỗ và im.   │
     * │                                                                      │
     * │ ⚠ Kiểm CẢ HAI hệ, không dò `process.platform`: một văn phòng zip từ   │
     * │ máy Windows sang máy Linux vẫn phải đọc đúng chuỗi đã ghi trong kế    │
     * │ hoạch cũ. Cùng lý do `SHELL_ALIASES` gửi cả hai tên.                  │
     * │                                                                      │
     * │ Đây KHÔNG phải chỗ cài luật "được ghi ra ngoài hay không" — luật đó   │
     * │ thuộc `officeJail`, và hiện chốt là KHÔNG (→ SPEC §1b, §8). Ở đây chỉ │
     * │ đảm bảo: thứ ta giao cho nhân viên luôn là một đường dẫn DÙNG ĐƯỢC.   │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    if (path.win32.isAbsolute(raw) || path.posix.isAbsolute(raw)) {
      // Ta vừa viết lại thứ người dùng gõ. Đó là một SỰ VIỆC, và giấu nó đi là
      // cách một hệ thống nói dối về chính mình. → `Plan.redirected`
      onRedirect?.(raw);
      const base = raw.replace(/\\/g, '/').split('/').filter(Boolean).pop();
      return base ? `${home}/${base}` : `${home}/ket-qua.md`;
    }

    let rest = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (rest.startsWith('artifacts/')) rest = rest.slice('artifacts/'.length);
    // Bóc các lớp khung ĐÃ CÓ, đúng thứ tự — đây là chỗ giữ tính idempotent.
    if (rest.startsWith(`${planId}/`)) rest = rest.slice(planId.length + 1);
    if (rest.startsWith(`${taskId}/`)) rest = rest.slice(taskId.length + 1);
    // `..` và `.` bị bỏ chứ không phải bị từ chối: đây là chuỗi do model sinh,
    // và một đường dẫn đi ngược ra ngoài `artifacts/` là thứ không được tồn tại
    // dù model có ý gì. Chốt chặn thật vẫn nằm ở `safeJoin`; đây là lớp đầu.
    const tail = rest
      .split('/')
      .filter((s) => s && s !== '.' && s !== '..')
      .join('/');
    return tail ? `${home}/${tail}` : `${home}/ket-qua.md`;
  };
}

/**
 * Kế hoạch model vừa viết ra → kế hoạch CHẠY ĐƯỢC. Hàm THUẦN, 0 token, 0 lượt.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO TÁCH RA KHỎI `Assistant.plan()` (20/08).                          │
 * │                                                                          │
 * │ Hai lý do, và lý do thứ hai mới là lý do thật:                            │
 * │                                                                          │
 * │  1. Nó là hàm thuần và nó đang giữ BỐN luật đã từng có bug — đóng khung   │
 * │     đầu vào, đóng khung đầu ra, bỏ bước không ai làm, mặc định `deliver`  │
 * │     của văn phòng. Nằm trong một method `async` gọi model thì không có bộ │
 * │     test nào chạm tới được. → §4 nợ kỹ thuật, ưu tiên 0                   │
 * │  2. **Nó có HAI người gọi.** `route()` có một cửa cứu hộ: khi model trả   │
 * │     về nguyên một kế hoạch trong lúc lẽ ra phải định tuyến, ta đang cầm   │
 * │     trong tay một kế hoạch ĐÃ TRẢ TIỀN — và luật "ra bản nháp để sửa còn  │
 * │     hơn viết mới từ đầu" cấm vứt nó đi để gọi lại `plan()`.               │
 * │                                                                          │
 * │ Hai bản mã cho cùng một phép biến đổi thì sẽ lệch — luật 19/08, và một    │
 * │ dòng chú thích "⚠ phải khớp bên kia" KHÔNG phải một cơ chế.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function buildPlan(
  draft: PlanDraft,
  request: string,
  planId: string,
  defaultDeliver: Deliver,
): Plan {
  const rawSteps = draft.steps;
  const rawTasks = draft.tasks.map((t) => ({ ...t, step: clampStep(t.step, rawSteps.length) }));

  /**
   * BỎ BƯỚC KHÔNG CÓ TASK NÀO.
   *
   * Model rất hay viết một bước kiểu "Lưu kết quả vào file" rồi không giao
   * task nào cho nó — vì việc đó đã nằm trong task trước. Bước như thế KHÔNG
   * AI TICK ĐƯỢC: nó đứng nguyên ở "chưa làm" kể cả khi mọi việc đã xong, và
   * người dùng nhìn vào tưởng hệ thống bỏ sót.
   *
   * Lọc bằng code chứ không bằng cách bắt model lập lại kế hoạch: rẻ hơn một
   * lượt gọi, và deterministic. Prompt cũng đã dặn thêm, nhưng dặn là gợi ý
   * còn cái này là bảo đảm.
   */
  const used = new Set(rawTasks.map((t) => t.step));
  const kept = rawSteps.map((title, i) => ({ title, i })).filter((s) => used.has(s.i));
  const remap = new Map(kept.map((s, newIndex) => [s.i, newIndex]));

  const steps: PlanStep[] = kept.map((s) => ({ title: s.title, status: 'pending' }));
  // Đầu VÀO và đầu RA đi qua hai luật khác nhau — xem `outputScoper`.
  const scopeIn = artifactScoper(planId, rawTasks.map((t) => t.task_id));

  /** Đường dẫn ngoài văn phòng đã bị kéo về khung — nói ra ở `finish`. */
  const redirected = new Set<string>();

  const tasks = rawTasks.map((t) => {
    const scopeOut = outputScoper(planId, t.task_id, (asked) => redirected.add(asked));
    return TaskBriefSchema.parse({
      ...t,
      inputs: t.inputs.map((i) => ({ kind: 'file' as const, path: scopeIn(i.path) })),
      /**
       * GỘP TRÙNG SAU KHI ĐÓNG KHUNG — hai chuỗi khác nhau có thể quy về một.
       *
       * Ca 22/08 22:06: người dùng nói *"ghi vào `D:\…\ban-ke.md`"*, Trợ lý khai
       * HAI đích (một trong khung, một là đường dẫn người dùng gõ) — đúng phận
       * sự của nó. Sau `outputScoper` cả hai rút về `…/T-01/ban-ke.md`.
       *
       * Không gộp thì nhân viên nhận một danh sách bảo nó ghi cùng một file hai
       * lần, và `validate` cũng không bắt: phép kiểm "hai task cùng ghi một
       * đường dẫn" so GIỮA các task, không so trong lòng một task.
       */
      outputs: [...new Set(t.outputs.map((o) => scopeOut(o.path)))].map((p) => ({
        kind: 'file' as const,
        path: p,
      })),
      step: remap.get(t.step) ?? 0,
      // Mặc định VĂN PHÒNG, không phải mặc định của schema. Đây là chỗ cần
      // gạt tất định thật sự có hiệu lực: model im lặng = đi theo cấu hình
      // người dùng đã đặt, chứ không rơi về 'file' một cách âm thầm.
      deliver: t.deliver ?? defaultDeliver,
    });
  });

  return {
    plan_id: planId,
    request,
    steps,
    tasks,
    ...(redirected.size ? { redirected: [...redirected] } : {}),
  };
}

/**
 * Câu "việc này là việc gì" cho một bản nháp kế hoạch — SUY TỪ DỮ LIỆU, 0 token.
 *
 * `PlanRecord.request` là thứ người dùng đọc trong `/status` và trong nhật ký
 * công việc. Ở ca thường nó do `route()` viết ra ("viết lại yêu cầu thành một
 * câu rõ ràng"). Ở cửa cứu hộ ta không có câu đó — nhưng ta có `goal` của từng
 * task, vốn được yêu cầu đúng cùng một hình dạng: *một câu rõ ràng, tiếng của
 * người dùng*. Dùng lại thứ đang cầm thay vì hỏi thêm một lượt.
 *
 * ⚠ KHÔNG dùng chính câu người dùng vừa gõ: câu đó thường là *"ừ, cái nào cũng
 * được"* — đúng nhưng vô nghĩa khi đọc lại trong nhật ký ba ngày sau.
 */
export function requestOf(draft: PlanDraft): string {
  return truncateToTokens(draft.tasks.map((t) => t.goal.trim()).filter(Boolean).join(' · '), 120);
}

/**
 * Ý NGHĨA của cờ `chạy lệnh`, nói ĐÚNG MỘT LẦN ở đầu danh bạ. → `Assistant.reach`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CÂU NÀY PHẢI HẸP, VÌ MẶT PHỦ ĐỊNH RỘNG LÀ MỘT LỜI NÓI DỐI.               │
 * │                                                                          │
 * │ Ranh giới thật hôm nay (`types.ts §BUILTIN_TOOLS`, đo 22/08):             │
 * │                                                                          │
 * │   ĐỌC   `Read`/`Glob`/`Grep`  → KHÔNG hàng rào, với tới MỌI đường dẫn    │
 * │   GHI   `Write`/`Edit`        → có hàng rào `officeJail`                 │
 * │   LỆNH  `Bash`                → không hàng rào                           │
 * │                                                                          │
 * │ Nên *"không có shell"* KHÔNG đồng nghĩa *"không với tới máy của bạn"*.   │
 * │ Vai trò trần vẫn mở được `D:\Hồ sơ\hopdong.pdf` bằng `Read`. Viết câu    │
 * │ phủ định rộng là dạy Trợ lý từ chối cả việc nó làm được — hỏng ngược     │
 * │ chiều, và im lặng hơn hẳn ca 9.3 vì không ai thấy việc đã bị từ chối.    │
 * │                                                                          │
 * │ Bằng chứng nằm ngay trong 9.3: nhân viên báo *"Glob chỉ trả về đường     │
 * │ dẫn file"* — tức là Glob ĐÃ ra tới `D:\Downloads` thành công. Nó thiếu   │
 * │ cột, không phải thiếu đường.                                             │
 * │                                                                          │
 * │ ⇒ Chỉ nêu đúng thứ shell thêm vào: metadata file, và ghi ra ngoài.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ VÌ SAO KHÔNG VIẾT "shell là thứ DUY NHẤT lấy được kích thước".         │
 * │                                                                          │
 * │ Bản đầu của câu này viết đúng như vậy. Nó ĐÚNG hôm nay — 7 tool mặc      │
 * │ định không có cái nào trả metadata — nhưng nó là một khẳng định về TOÀN  │
 * │ BỘ THẾ GIỚI, nên nó **hết đúng vào đúng ngày MCP có mặt**: một MCP       │
 * │ filesystem trả `size`/`mtime` là câu này thành nói dối, và nói dối theo  │
 * │ chiều làm Trợ lý TỪ CHỐI một việc vốn chạy được.                         │
 * │                                                                          │
 * │ User bắt được lỗ này trước khi MCP kịp tồn tại (22/08): *"worker không   │
 * │ có shell nhưng có nhiều tool khác, mcp khác thì assistant có chủ quan mà │
 * │ chặn không"*. Có. Và nó sẽ chặn IM LẶNG.                                 │
 * │                                                                          │
 * │ ⇒ Thay bằng bất biến TỰ ĐÚNG: *"dòng của mỗi người liệt kê ĐỦ nơi họ với │
 * │   tới"*. Đó là khẳng định về ĐỊNH DẠNG, không phải về thế giới — và      │
 * │   `reach()` thi hành nó theo đúng nghĩa đen (`[...role.mcp]` đi đầu).    │
 * │   Thêm bao nhiêu năng lực về sau, câu vẫn đúng, không phải sửa lại.      │
 * │                                                                          │
 * │ ✅ NỢ NÀY ĐÃ TRẢ 26/08 — sau khi user đâm thẳng vào nó.                  │
 * │                                                                          │
 * │ Nợ cũ: *"dòng đó liệt kê MCP bằng TÊN (`notion`), không bằng NĂNG LỰC.   │
 * │ Trợ lý biết 'với tới Notion', không biết 'ghi được file'."*               │
 * │                                                                          │
 * │ Ca thật: user đổi cánh tay sang toàn quyền, Trợ lý vẫn từ chối bằng       │
 * │ **đúng câu cũ**. Nó không cố chấp — nó không có dữ kiện nào để biết khác. │
 * │                                                                          │
 * │ Giải được vì `arms[].level` mới tồn tại từ 26/08. `armReach` giờ in nấc   │
 * │ ngay trên dòng của nhân viên. Vắng `level` (thư mục · tự cắm) ⇒ không in  │
 * │ gì — bịa một năng lực cho thứ không khai nó là dựng lại đúng lỗi này.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export const SHELL_LEGEND =
  'Mọi nhân viên đều MỞ ĐƯỢC file trên máy người dùng bằng đường dẫn đầy đủ — đọc nội dung, ' +
  'liệt kê tên file. "chạy lệnh: BẬT" thì có thêm: chạy lệnh/script tuỳ ý trên máy, ' +
  'và ghi được ra ngoài thư mục văn phòng.\n' +
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴🔴 CÂU NÀY ĐÃ NÓI DỐI, VÀ NÓ TỰ CẢNH BÁO CHÍNH MÌNH TỪ 22/08.          │
   * │                                                                          │
   * │ Bản trước: *'"chạy lệnh: BẬT" thì có thêm: **kích thước · ngày sửa ·      │
   * │ dung lượng của file**'*. Ca user gặp 24/08, có cánh tay filesystem cắm    │
   * │ đàng hoàng, shell TẮT:                                                   │
   * │                                                                          │
   * │   *"Nhân viên phụ trách thư mục Musics đang tắt chế độ chạy lệnh nên     │
   * │    không lấy được dung lượng file… Bạn có thể bật chế độ chạy lệnh cho   │
   * │    nhân viên này không?"*                                                │
   * │                                                                          │
   * │ **Sai, và đo được là sai.** `spike-arm-e2e` ca A chạy với `role.tools`    │
   * │ ép về `[]` (shell TẮT hoàn toàn) và vẫn ra bảng kích thước đầy đủ:       │
   * │ `Programs Installation 2 · list directory with sizes` → `done`. Cánh tay │
   * │ filesystem có **14 tool**, trong đó `list_directory_with_sizes` và       │
   * │ `get_file_info` trả đúng metadata mà câu trên bảo là độc quyền của shell.│
   * │                                                                          │
   * │ ⚠⚠ VÀ ĐÂY MỚI LÀ PHẦN ĐẮT: khối chú thích ngay TRÊN hằng số này, viết    │
   * │ 22/08, đã nói chính xác chuyện sẽ xảy ra — *"nó hết đúng vào đúng ngày   │
   * │ MCP có mặt… nói dối theo chiều làm Trợ lý TỪ CHỐI một việc vốn chạy      │
   * │ được"*. Bản vá hôm đó chỉ gỡ chữ **"DUY NHẤT"** mà **giữ nguyên vế nhân  │
   * │ quả**. Và có hẳn một test canh chữ "DUY NHẤT" — **test XANH suốt, trong  │
   * │ khi lỗi vẫn sống**. Sửa chữ, không sửa mệnh đề.                          │
   * │                                                                          │
   * │ ⇒ Luật: **đừng liệt kê NĂNG LỰC theo nguồn cấp.** Chỉ nêu thứ shell      │
   * │   thật sự độc quyền (chạy lệnh tuỳ ý · ghi ra ngoài), rồi để dòng cuối   │
   * │   nói một bất biến về ĐỊNH DẠNG, không về thế giới.                      │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  'Một kết nối (🔌) mang thêm khả năng RIÊNG của nó, và nhân viên tự biết mình gọi được gì lúc làm. ' +
  'ĐỪNG đoán hộ rằng nhân viên KHÔNG làm được một việc chỉ vì "chạy lệnh: TẮT" — cứ giao, ' +
  'họ sẽ tự báo nếu thiếu tay. Dòng của mỗi người liệt kê ĐỦ nơi họ với tới — ' +
  'không có gì ngoài danh sách đó.\n' +
  /**
   * Nửa còn lại của bản vá `armLine`, và THIẾU NÓ THÌ NỬA KIA VÔ NGHĨA.
   *
   * Biết đường dẫn mà vẫn hỏi lại là đúng ca user gặp — chỉ khác là lúc đó Trợ
   * lý không biết, còn từ đây nó biết mà có thể vẫn hỏi cho "chắc". Một vòng
   * hỏi-đáp thừa với người non-code là một lần họ nghĩ sản phẩm không hiểu mình.
   *
   * ⚠ Câu này phải HẸP: nó chỉ nói về thư mục ĐÃ IN RA ở dòng nhân viên. Viết
   * rộng thành "đừng hỏi đường dẫn" là dạy Trợ lý đoán bừa một đường dẫn nó
   * chưa từng thấy — hỏng ngược chiều, và im lặng hơn.
   */
  'Thư mục ghi sau "thư mục:" là chỗ nhân viên đó ĐÃ được cấp quyền. Khi người dùng nói ' +
  '"thư mục đã cho phép" hay gọi tên một thư mục trong danh sách đó, DÙNG LUÔN đường dẫn ấy — ' +
  'đừng hỏi lại họ đường dẫn đầy đủ.';

/**
 * Cờ shell của MỘT vai trò. Tách ra để test được mà không phải dựng văn phòng —
 * cùng lý do `resolveInput` từng được rút ra: luật đã sai một lần thì phải gọi
 * được riêng để canh. Xem khối `⚠ ĐÍNH CHÍNH` ở `Assistant.reach`.
 *
 * LUÔN trả về một chuỗi, không bao giờ trả rỗng. Đó chính là chỗ bản trước sai.
 */
export function shellFlag(tools: readonly string[]): string {
  return hasShell(tools) ? 'chạy lệnh: BẬT' : 'chạy lệnh: TẮT';
}

/**
 * Một cánh tay, nói bằng thứ Trợ lý CẦN — không bằng thứ ta lưu.
 *
 * Hàm THUẦN, tách khỏi `Assistant` vì cùng lý do `shellFlag` từng được rút ra:
 * luật này đã sai một lần thì phải gọi được riêng để canh, không phải dựng cả
 * một văn phòng mới test được.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 CA USER GẶP 24/08, BA LƯỢT LIÊN TIẾP, KHÔNG THOÁT RA ĐƯỢC:            │
 * │                                                                          │
 * │   — "Trong thư mục đã cho phép, tìm 5 file lớn nhất…"                    │
 * │   — "Bạn cho mình xin đường dẫn đầy đủ của thư mục cần soi nhé?"         │
 * │   — "thư mục music"                                                      │
 * │   — "Bạn cho mình xin đường dẫn đầy đủ tới thư mục Music đó nhé?"        │
 * │   — "nhân viên của bạn biết thư mục này rồi"                             │
 * │   — "Mình vẫn cần đường dẫn đầy đủ…"                                     │
 * │                                                                          │
 * │ **Trợ lý không cố chấp — nó thật sự KHÔNG BIẾT.** `role.mcp` chỉ là một   │
 * │ mảng BĂM (`a385afc3ab6`), và bản trước đổ thẳng mảng đó vào dòng năng     │
 * │ lực. Băm không nói được nó trỏ vào đâu, nên *"thư mục đã cho phép"* không │
 * │ giải được — trong khi `company.yaml` biết thừa. Người dùng nói đúng:      │
 * │ *"nhân viên của bạn biết thư mục này rồi"*.                               │
 * │                                                                          │
 * │ Đây là món nợ ĐÃ CÓ TÊN từ 22/08 ngay trong file này: *"dòng đó liệt kê   │
 * │ MCP bằng TÊN, không bằng NĂNG LỰC — tên server là LỜI KHAI, danh sách     │
 * │ tool của nó mới là SỰ THẬT"*. Ca này là món nợ đó thu lãi, và may là ở    │
 * │ dạng rẻ nhất để trả: thư mục nằm sẵn trong `args`, `folderRoots` đã có,   │
 * │ 0 lời gọi thêm, ~12 token mỗi cánh tay.                                   │
 * │                                                                          │
 * │ ⚠ Ghi `thư mục:` chứ không dùng mũi tên hay dấu hai chấm trần — dòng này  │
 * │ nằm giữa một khối liệt kê và phải TỰ ĐỌC ĐƯỢC khi đứng một mình, cùng     │
 * │ luật đã áp cho `chạy lệnh: TẮT`.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function armReach(
  arms: Record<string, { label?: string; level?: 'read' | 'add' | 'full'; catalog?: string }>,
  servers: Record<string, unknown>,
  id: string,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CẦU NỐI TỪ TÊN NGƯỜI DÙNG GỌI → TÊN TOOL MODEL THẤY. (user hỏi 26/08)   │
   * │                                                                          │
   * │   *"trong trường hợp đặt tên phi-latin, mà trường tên không ảnh hưởng     │
   * │    tới băm ⇒ hết cách…"*  · *"bạn đã tính tới case đặt tên trùng chưa"*  │
   * │                                                                          │
   * │ Hai câu, một chỗ hỏng: `armKeys` chỉ tạo được khoá đọc được từ nhãn, mà  │
   * │ nhãn **phi-Latin** (文档 · 회계) ra chuỗi rỗng và nhãn **trùng nhau** thì  │
   * │ cả hai phải về băm. Cả hai đường đổ về cùng một chỗ: model lại nhìn thấy │
   * │ `mcp__a46a7e26403__…` và không biết đó là cánh tay nào.                   │
   * │                                                                          │
   * │ ⇒ Đường ra KHÔNG nằm ở cái tên — nó nằm ở **dòng danh bạ**. Một cái tên  │
   * │ không mang được thông tin thì đặt thông tin ngay cạnh nó:                 │
   * │                                                                          │
   * │     文档 — chỉ đọc · gọi bằng mcp__a46a7e26403__*                        │
   * │                                                                          │
   * │ Đây KHÔNG phải "thêm một câu dặn" (thứ đã thua ba lần). Nó là một **ánh   │
   * │ xạ nằm trên chính dòng có cái tên** — đúng khuôn đã thắng ở `chạy lệnh:   │
   * │ TẮT` và `đường tắt tới`. → [[agentco-prompt-rules-lose-to-examples]]      │
   * │                                                                          │
   * │ ⚠ CHỈ nêu khi cần: khoá **suy được từ nhãn** thì model tự bắc cầu, và     │
   * │ dán thêm một chuỗi kỹ thuật vào mọi dòng là trả token cho thứ vô ích —    │
   * │ đồng thời dạy model rằng những chuỗi đó là nhiễu, rồi nó bỏ qua đúng lúc │
   * │ chuỗi đó có nghĩa.                                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  toolKey?: string,
): string {
  // Băm là thứ CUỐI CÙNG dùng tới: nhãn do người dùng đặt là thứ họ nhận ra.
  const label = arms[id]?.label?.trim() || id;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 TRẢ MÓN NỢ ĐÃ GHI TỪ 22/08 — và user vừa đâm thẳng vào nó 26/08.      │
   * │                                                                          │
   * │ Nợ, nguyên văn ở `SHELL_LEGEND`: *"dòng đó liệt kê MCP bằng TÊN           │
   * │ (`notion`), không bằng NĂNG LỰC. Trợ lý biết 'với tới Notion', không biết │
   * │ 'ghi được file'. Chưa giải."*                                            │
   * │                                                                          │
   * │ Ca thật: user đổi cánh tay sang **toàn quyền**, rồi hỏi *"tạo giúp tôi    │
   * │ một trang Notion"* — Trợ lý vẫn trả lời **y hệt câu cũ**: *"chỉ đọc được  │
   * │ Notion, không tạo hay ghi trang mới"*. Nó không cố chấp: **nó không có    │
   * │ dữ kiện nào để biết khác đi.** Dòng danh bạ chỉ ghi một cái tên, và một   │
   * │ cái tên thì không nói gì về quyền.                                       │
   * │                                                                          │
   * │ ⚠ Và đây là chỗ nợ đó đắt gấp đôi: Trợ lý đoán **theo chiều TỪ CHỐI**.   │
   * │ Cùng hình dạng với ca `chạy lệnh: TẮT` (§SHELL_LEGEND) — *nói dối theo    │
   * │ chiều làm Trợ lý từ chối một việc vốn chạy được*, lần thứ hai, thấp hơn   │
   * │ một tầng.                                                                │
   * │                                                                          │
   * │ Giải được BÂY GIỜ vì `arms[].level` mới có thật từ 26/08 — trước đó       │
   * │ không có gì để in ra. Ba chữ, nằm **trên chính dòng của nhân viên** —     │
   * │ đúng luật [[agentco-prompt-rules-lose-to-examples]]: điều kiện phải nằm   │
   * │ ở chỗ thua, không phải thêm một câu dặn ở đầu khối.                       │
   * │                                                                          │
   * │ ⚠ Vắng `level` ⇒ **không in gì**. Cánh tay thư mục và cánh tay tự cắm     │
   * │ không có nấc, và bịa "toàn quyền" cho chúng là dựng lại đúng cái lỗi vừa  │
   * │ vá — đoán hộ một năng lực từ một thứ không khai nó.                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const LEVEL: Record<string, string> = {
    read: 'chỉ đọc',
    add: 'đọc + thêm mới, không sửa/xoá',
    full: 'đọc + ghi + sửa/xoá',
  };
  const level = arms[id]?.level ? LEVEL[arms[id]!.level!] : undefined;
  const roots = folderRoots(servers[id]);
  /**
   * CUỐN DANH BẠ: tên nhà → địa chỉ nhà. Chỉ in khi chỗ gọi đưa `toolKey`, tức
   * khi vai trò có **từ hai cánh tay trở lên** — một cánh tay thì không có gì
   * để nhầm, và dán chuỗi kỹ thuật vào mọi dòng là trả token cho thứ vô ích.
   */
  const bridge = toolKey ? ` · gọi bằng mcp__${toolKey}__*` : '';
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CÁCH CHẠY PHẢI NẰM TRÊN DÒNG NÀY — nếu không Trợ lý tả MẶC ĐỊNH CỦA   │
   * │ DANH MỤC và gọi đó là cấu hình của người dùng. (ca thật 29/08)           │
   * │                                                                          │
   * │ User cắm cánh tay trình duyệt **có tick "nhớ đăng nhập"**, rồi hỏi mở một │
   * │ trang để tự đăng nhập. Trợ lý trả lời, bốn lượt liền, đại ý *"phiên không │
   * │ được giữ lại, không có cách nào lưu"* — trong khi hồ sơ **đang** được lưu │
   * │ (bằng chứng: ô email tự điền sẵn, và 142 MB hồ sơ trên đĩa).             │
   * │                                                                          │
   * │ Nó không bịa: dữ kiện duy nhất nó có là `blurb` của **mục danh mục**, mà  │
   * │ blurb tả **mặc định** — *"trình duyệt sạch, không giữ đăng nhập"*. Đúng   │
   * │ với mục, sai với cánh tay đã cắm.                                        │
   * │                                                                          │
   * │ ⚠ Và nó sai **theo chiều TỪ CHỐI**, lần thứ ba của cùng một hình dạng     │
   * │ (`chạy lệnh: TẮT` · `level` thiếu · và giờ là cách chạy). Cùng bản vá:    │
   * │ đọc từ **cấu hình đã lưu**, in **trên chính dòng của nhân viên**.         │
   * │ → `catalog.ts §activeOptions` · [[agentco-prompt-rules-lose-to-examples]] │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  const entry = arms[id]?.catalog ? findArm(arms[id]!.catalog!) : undefined;
  const opts = entry ? activeOptions(entry, servers[id]).map((o) => o.label.toLowerCase()) : [];
  // Một danh sách, không phải hai câu: nấc quyền và cách chạy cùng trả lời câu
  // *"cánh tay này LÀM ĐƯỢC GÌ"*, nên chúng đứng cạnh nhau hay đứng riêng đều
  // đọc được — nhưng gộp thì không có chỗ nào để quên một vế.
  const bits = [level, ...opts].filter(Boolean) as string[];
  const shortcut = roots.length ? ` (đường tắt tới ${roots.join(' · ')})` : '';
  /**
   * Câu dặn của mục danh mục — ĐỨNG CUỐI, sau cầu nối tên tool.
   *
   * Cuối vì nó là câu dài nhất: mắt (và model) đọc nhãn · quyền · cách chạy trước,
   * rồi mới tới lời dặn. Đặt nó giữa là đẩy `gọi bằng mcp__…__*` — thứ model cần
   * để **gọi đúng tool** — ra sau một đoạn văn.
   */
  const hint = entry?.hint ? ` — ⚠ ${entry.hint}` : '';
  if (bits.length) return `${label} — ${bits.join(' · ')}${shortcut}${bridge}${hint}`;
  if (bridge || hint) return `${label}${shortcut}${bridge}${hint}`;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ "ĐƯỜNG TẮT", KHÔNG PHẢI "THƯ MỤC". Một từ, và nó sửa một ca hỏng thật.   │
   * │ (user chốt 24/08: *"MCP là thư mục được cắm, không phải onlyAllows"*)     │
   * │                                                                          │
   * │ Bản trước ghi `Musics (thư mục: D:\…\Musics)`. Trợ lý đọc danh sách đó    │
   * │ thành **tổng tầm với của nhân viên** rồi TỪ CHỐI việc nằm ngoài — kể cả   │
   * │ khi người đó có `chạy lệnh: BẬT`, kể cả trong một phiên `/clear` sạch     │
   * │ tinh. Đo được 24/08, tái lập nhiều lần. Nhưng nó SAI: `SHELL_LEGEND` ở    │
   * │ ngay đầu danh bạ đã nói *"mọi nhân viên đều MỞ ĐƯỢC file trên máy bằng    │
   * │ đường dẫn đầy đủ"*.                                                      │
   * │                                                                          │
   * │ ⇒ Prompt KHÔNG thiếu sự thật — sự thật ấy **thua vị trí**. Câu chung nằm  │
   * │ ở đầu khối, chuỗi trông-như-phạm-vi nằm trên CHÍNH DÒNG của nhân viên, và │
   * │ dòng thắng. Đúng luật đã trả tiền hai lần rồi:                            │
   * │ [[agentco-prompt-rules-lose-to-examples]] — *điều kiện phải nằm trên chính │
   * │ dòng có ví dụ*, và ca `chạy lệnh: TẮT` (§1310) đã học đúng bài này.        │
   * │                                                                          │
   * │ Nên bản vá KHÔNG thêm một câu dặn nữa (câu dặn đã có và đã thua). Nó đổi  │
   * │ **một từ, tại chỗ thua**: `thư mục` → `đường tắt tới`. Cùng cỡ token,      │
   * │ không có luật mới nào phải nhớ.                                          │
   * │                                                                          │
   * │ ⚠ Từ này phải khớp với thứ hệ thống THẬT SỰ làm. Hôm nay cánh tay là      │
   * │ đường tắt thật: `Read`/`Glob` với tới mọi đường dẫn, `Bash` cũng vậy —    │
   * │ allowlist của MCP server chỉ bó CHÍNH NÓ. Ngày nào §14 #1 đổi (dựng hàng  │
   * │ rào đọc) thì từ này phải đổi lại thành một từ chỉ giới hạn, cùng lượt.    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  return roots.length ? `${label} (đường tắt tới ${roots.join(' · ')})` : label;
}

/**
 * DIFF NĂNG LỰC giữa hai lượt — hàm THUẦN, 0 token. → docs/SPEC-arms.md §15f
 *
 * "Năng lực" gồm **cánh tay** và **công tắc shell** — mọi thứ trong dòng năng lực
 * của `roster()` mà người dùng bấm đổi được. Hai thứ này đi chung một đường vì
 * chúng hỏng chung một kiểu: người dùng đổi, prompt đổi theo đúng ngay lượt sau,
 * và model vẫn trả lời bằng câu cũ của chính nó.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ VÌ SAO DIFF THẮNG MỘT DÒNG NHẮC CHUNG CHUNG — và lý do KHÔNG phải        │
 * │ "session nhớ được".                                                      │
 * │                                                                          │
 * │ Đo 24/08, ba ca độc lập, cùng một hình dạng:                             │
 * │                                                                          │
 * │   một dòng XUẤT HIỆN trong danh bạ  → **thắng** lịch sử, mọi lần         │
 * │     · spike L4: cắm thêm `Hoa Don` → gọi thẳng tên ngay lượt sau         │
 * │     · ca 03:43:01 thật: nối dây `Musics` → model **lật ngược BA lượt     │
 * │       từ chối liên tiếp của chính nó**, không cần `/clear`                │
 * │   một dòng BIẾN MẤT                  → **thua** lịch sử (ca 02:34:13)     │
 * │                                                                          │
 * │ ⇒ Bất đối xứng nằm ở HÌNH DẠNG TÍN HIỆU, không ở cache và không ở tốc độ │
 * │ cập nhật. Đúng nghĩa đen [[agentco-deterministic-vs-signal]]: *vắng mặt   │
 * │ không phải một tín hiệu.*                                                │
 * │                                                                          │
 * │ Nên việc đúng không phải dặn to hơn, mà là **đổi trục**: biến một sự      │
 * │ VẮNG MẶT thành một sự CÓ MẶT. Dòng `− Notion ✗ ho-tro` là một dòng chữ    │
 * │ *xuất hiện* — và thứ xuất hiện thì ta vừa đo được là thắng.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Ba ràng buộc, mỗi cái chặn một cách hỏng khác nhau:
 *
 *  1. **DELTA, không phải changelog.** Chỉ mô tả thay đổi kể từ lượt trước, và
 *     chỉ chèn đúng một lần vào lượt nó xảy ra. Nghịch canvas 20 lần thì 20 dòng
 *     nằm rải trong transcript — chấp nhận được; một khối 20 dòng gửi lại ở MỌI
 *     lượt sau thì không, và đó đúng là kiểu phình vĩnh viễn cả dự án tránh.
 *  2. **`cap`.** Một lần sửa hàng loạt trên sơ đồ không được nhét cả bức tường
 *     vào phiên.
 *  3. **Rút gọn còn NHÃN.** Danh bạ ngay bên trên đã có đủ thư mục; diff chỉ để
 *     TRỎ, không phải để làm nguồn. Dán lại nguyên đường dẫn vừa bị rút là tự
 *     tay tiêm lại đúng chuỗi ta muốn nó thôi nhắc.
 */
export function reachDiff(
  before: Map<string, readonly string[]>,
  after: Map<string, readonly string[]>,
  cap = 4,
): string[] {
  // `armReach` trả `Nhãn (đường tắt tới …)`. Diff chỉ giữ phần nhãn — ràng buộc 3.
  const short = (s: string) => s.replace(/\s*\(đường tắt tới .*$/, '').trim();
  const lines: string[] = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const was = new Set(before.get(id) ?? []);
    const now = new Set(after.get(id) ?? []);
    for (const a of now) if (!was.has(a)) lines.push(`+ ${short(a)} → ${id}`);
    for (const r of was) if (!now.has(r)) lines.push(`− ${short(r)} ✗ ${id}`);
  }
  if (lines.length <= cap) return lines;
  return [...lines.slice(0, cap), `và ${lines.length - cap} thay đổi khác`];
}

/**
 * Phần THUẦN của cổng hậu kiểm — 0 token, tách khỏi class để có test riêng.
 * Luật ba điều kiện và ranh giới của nó nằm ở `Assistant.staleArmMentions`.
 */
export function staleMentions(input: {
  /**
   * Sổ cánh tay của công ty — `label`, và **tên tài khoản** nếu là cánh tay OAuth.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 `via` THÊM 28/08 VÌ CỔNG NÀY VỪA ĐỂ LỌT MỘT CA THẬT.                  │
   * │                                                                          │
   * │ User gỡ tài khoản `minhvuptitd14`, rồi Trợ lý hỏi:                        │
   * │   *"Repo 'focus-flow' nằm trong tài khoản GitHub minhvq36 hay             │
   * │    minhvuptitd14 vậy bạn?"*                                              │
   * │                                                                          │
   * │ Cổng không bắn, và nó **không sai luật** — nó chỉ so với `label`, tức     │
   * │ chuỗi `"GitHub · minhvuptitd14"`. Câu trên không chứa nguyên chuỗi đó.    │
   * │ Cánh tay thư mục không dính lỗ này vì nhãn của chúng THƯỜNG được nhắc     │
   * │ nguyên vẹn (`D:\Downloads\…`); cánh tay OAuth thì tên tài khoản là thứ    │
   * │ người ta nhắc, còn phần `"GitHub · "` thì bỏ.                             │
   * │                                                                          │
   * │ ⇒ Kim thứ ba: **tên tài khoản đứng một mình**. Nó không phải trường mới — │
   * │ `via` đã có sẵn, tra từ `arms[].secrets` ra kho OAuth, và đang được dùng  │
   * │ ở danh sách dùng lại + node trên sơ đồ. Đây là chỗ thứ ba của cùng một    │
   * │ sự thật, không phải một cơ chế thứ hai. → `company.ts §listArms`          │
   * │                                                                          │
   * │ ⚠ RANH GIỚI KHÔNG ĐỔI: vẫn bắt TÊN, không bắt CÁCH NÓI VÒNG. Vẫn hẹp,    │
   * │ vẫn chưa đóng. [[agentco-deterministic-vs-signal]]                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  arms: Record<string, { label?: string; via?: string }>;
  /** Cấu hình từng cánh tay — `folderRoots` đọc `args` từ đây. */
  servers: Record<string, unknown>;
  /** Id cánh tay ĐANG có ít nhất một nhân viên trực nối vào. */
  live: Set<string>;
  say: string;
  userText: string;
}): string[] {
  const { arms, servers, live, say, userText } = input;
  // Tên/thư mục của những cánh tay CÒN nối — điều kiện 3.
  const liveText = [...live]
    .flatMap((id) => [arms[id]?.label, arms[id]?.via, ...folderRoots(servers[id])])
    .filter((s): s is string => !!s)
    .join('\n')
    .toLowerCase();

  const hay = say.toLowerCase();
  const said = userText.toLowerCase();
  const hits: string[] = [];
  for (const id of Object.keys(servers)) {
    if (live.has(id)) continue;
    /**
     * ⚠ Ngưỡng 4 ký tự, và nó là một hàng rào chứ không phải một con số đẹp:
     * người dùng đặt tên cánh tay là `A` hay `Hs` thì mọi câu tiếng Việt đều
     * chứa chuỗi đó, và cổng sẽ bắn ở mọi lượt. Thà bỏ sót một nhãn hai chữ
     * còn hơn biến cổng thành tiếng ồn — nó vốn đã là lớp thứ hai.
     */
    const needles = [arms[id]?.label, arms[id]?.via, ...folderRoots(servers[id])].filter(
      (s): s is string => typeof s === 'string' && s.trim().length >= 4,
    );
    for (const n of needles) {
      const k = n.trim().toLowerCase();
      if (!hay.includes(k)) continue;
      if (said.includes(k)) continue;
      if (liveText.includes(k)) continue;
      hits.push(n.trim());
    }
  }
  return [...new Set(hits)];
}

export class Assistant {
  private sessionId: string | undefined;
  /**
   * Lượt gọi ĐANG BAY — tay cầm để `/stop` ngắt. → SPEC-tools-approval.md §11e
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TRƯỚC 20/08 KHÔNG CÓ TAY CẦM NÀO, và người dùng đo được ngay lượt đầu.  │
   * │                                                                          │
   * │ `Office.stop()` ngắt nhân viên (`Scheduler.interruptAll`), xoá hòm thư,   │
   * │ bỏ việc hoãn — ba thứ, đúng như §11e viết. Nhưng lượt gọi của CHÍNH Trợ   │
   * │ lý (`route`/`plan`/`report`) chạy ở `run()` bên dưới, và ở đó không có gì │
   * │ để ngắt cả. Gõ `/stop` giữa lúc Trợ lý đang nghĩ thì nó vẫn nghĩ nốt, vẫn │
   * │ trả lời, vẫn tính tiền — sau khi màn hình đã nói "Đang dừng tất cả".      │
   * │                                                                          │
   * │ Đây KHÔNG mâu thuẫn với luật *"mặc định để chạy nốt, không giết"* (§11f). │
   * │ Luật đó bảo vệ BẢN NHÁP ĐÃ TRẢ TIỀN của nhân viên: giết ở 80% là mất      │
   * │ trắng 80% tiền đã tiêu. Một lượt `route()` không đẻ ra bản nháp nào —     │
   * │ ngắt nó chỉ mất một câu trả lời, đúng cái người dùng vừa bảo đừng nói.    │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ `abortController`, KHÔNG phải `Query.interrupt()`. Bài học đã trả tiền một
   * lần ở `worker.ts` (§8, hai cách ngắt qua `interrupt()` đều hỏng) — chép lại
   * đúng cơ chế đã đo được thay vì thử lại cái đã biết là không chạy.
   */
  private inflight: AbortController | undefined;
  /** Vai trò có dây nối từ Assistant trên canvas. undefined = chưa cấu hình = tất cả. */
  private assignable: Set<string> | undefined;
  /**
   * Ảnh chụp danh bạ ở lượt `route` TRƯỚC. → `reachMap`, `SPEC-arms.md` §15
   *
   * `undefined` = chưa route lần nào trong phiên này, nên chưa có gì để so.
   */
  private reachPrev: Map<string, string[]> | undefined;
  /** Tri thức HOT nạp sẵn vào prefix. Chỉ đổi khi bump knowledge_version. */
  private hotKnowledge = '';

  constructor(private office: LoadedOffice) {}

  get session(): string | undefined {
    return this.sessionId;
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 ẢNH CHỤP DANH BẠ PHẢI SỐNG SÓT QUA LẦN TẮT DAEMON — bug 26/08.       │
   * │                                                                          │
   * │ `sessionId` được LƯU RA ĐĨA (`.state/assistant-session.json`) nên hội     │
   * │ thoại sống qua restart. `reachPrev` thì **chỉ nằm trong RAM**. Hậu quả:   │
   * │                                                                          │
   * │   restart → lịch sử CÒN NGUYÊN (kèm mọi câu từ chối cũ)                  │
   * │           → `reachPrev === undefined` ⇒ **diff bị tắt**                  │
   * │           → model theo lịch sử, y như §15f đã đo                         │
   * │                                                                          │
   * │ ⇒ Cơ chế dựng ra để chống *"câu cũ thắng lịch sử"* bị vô hiệu **đúng vào │
   * │ lúc nó cần nhất**: sau một lần restart, tức đúng lúc cấu hình hay vừa     │
   * │ đổi nhất. Nó im lặng, vì im lặng chính là hành vi mặc định của nó.       │
   * │                                                                          │
   * │ Hai thứ đi cùng một cặp thì phải bền cùng một mức. Lệch mức bền là một    │
   * │ lớp lỗi, không phải một chi tiết.                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  resumeFrom(sessionId: string | undefined, reach?: Record<string, string[]>): void {
    this.sessionId = sessionId;
    // Không có ảnh chụp ⇒ giữ `undefined` (không có gì để so). Có ⇒ dựng lại
    // đúng hình dạng `reachMap()` trả về, để `reachDiff` so được ngay lượt đầu.
    this.reachPrev = reach ? new Map(Object.entries(reach)) : undefined;
  }

  /** Ảnh chụp danh bạ để ghi kèm con trỏ phiên. → `Office.saveSessionId` */
  get reachSnapshot(): Record<string, string[]> | undefined {
    return this.reachPrev ? Object.fromEntries(this.reachPrev) : undefined;
  }

  /**
   * Ngắt lượt đang bay. Trả về `true` nếu thật sự có cái để ngắt.
   *
   * Giá trị trả về là thứ `Office.stop()` dùng để nói ĐÚNG chuyện vừa xảy ra —
   * "đang dừng" khi có ngắt thật, và không hứa gì khi không có. Đoán ở tầng trên
   * là cách câu trả lời của `/stop` đã sai một lần rồi.
   */
  abort(): boolean {
    if (!this.inflight) return false;
    this.inflight.abort();
    return true;
  }

  /**
   * Ngữ cảnh hiện tại to bao nhiêu — đo được, không phải ước.
   *
   * Ở một lượt cache ẤM, `cache_read` chính là toàn bộ prefix + bản ghi hội
   * thoại mà server vừa đọc lại. Đó là con số thật, miễn phí, và là thứ quyết
   * định khi nào phải nén. Đếm tay số token đã gửi thì vừa sai vừa thừa.
   *
   * ⚠ KHÔNG bao gồm token của nhân viên: worker chạy `persistSession: false` ở
   * một `query()` riêng, và khâu lập kế hoạch cũng vậy. Chỉ `route()`/`report()`
   * làm phình bản ghi này.
   */
  contextTokens = 0;

  /** Quên hội thoại: lượt sau bắt đầu một session mới tinh. */
  forget(): void {
    this.sessionId = undefined;
    this.contextTokens = 0;
    // Phiên mới thì lịch sử rỗng ⇒ không có câu cũ nào để đính chính. Giữ lại
    // ảnh chụp cũ là để lượt đầu của phiên mới bắn một cái diff vô nghĩa.
    this.reachPrev = undefined;
  }

  /**
   * NÉN TRÍ NHỚ: hỏi Trợ lý phần duy nhất chỉ nó biết. → docs/SPEC-offices.md §4.6
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `skeleton` DO CODE DỰNG, KHÔNG HỎI MODEL.                                │
   * │                                                                          │
   * │ Việc đã chạy, kết quả ở đâu, tốn bao nhiêu — tất cả nằm trong            │
   * │ `tasks/index.json` và trong receipt. Bắt model kể lại là trả tiền để     │
   * │ nhận về một bản sao có thể sai. Ta đưa sự thật vào, và chỉ hỏi thứ       │
   * │ KHÔNG có ở đâu khác: người dùng thích gì, đã chốt gì, đang dở gì.        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Chạy TRÊN session cũ — phải thế, vì cả điểm của nó là đọc bản ghi sắp bỏ.
   */
  async compact(skeleton: string): Promise<AssistantResult<string>> {
    const { text, usage } = await this.askSession(
      `Sắp bắt đầu một cuộc trò chuyện mới. Đây là những việc đã chạy (dữ liệu hệ thống, KHÔNG cần kể lại):\n\n` +
        `${skeleton}\n\n` +
        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 GỘP, KHÔNG PHẢI VIẾT MỚI — bug đã sửa 20/08.                  │
         * │                                                                  │
         * │ `addAssistantMemory(..., assistantMemoryIds())` cho bản mới       │
         * │ `supersedes` **TOÀN BỘ** bản ghi nhớ đang sống, rồi `pruneNow()`  │
         * │ → `dropSuperseded()` **XOÁ HẲN** chúng khỏi đĩa.                  │
         * │                                                                  │
         * │ Bản prompt trước chỉ bảo *"viết lại những thứ bạn cần nhớ"* và    │
         * │ không nói một chữ nào về khối GHI NHỚ đang có sẵn trong ngữ cảnh. │
         * │ Nên mỗi `/clear` là một lần **tóm tắt lại bản tóm tắt**: thứ gì    │
         * │ không được nhắc trong phiên vừa rồi thì model không viết lại, và  │
         * │ nó **biến mất vĩnh viễn**. Một quyết định người dùng chốt tháng    │
         * │ trước bị bốc hơi sau ba lần dọn, im lặng, không ai báo.           │
         * │                                                                  │
         * │ Đây đúng lớp lỗi mà `supersedes` sinh ra để tránh, chỉ là nó bị   │
         * │ dùng ngược: `supersedes` để **thay một bản đã cũ**, không phải để │
         * │ **thay cả trí nhớ bằng lát cắt mới nhất**.                        │
         * │                                                                  │
         * │ Model ĐÃ nhìn thấy khối GHI NHỚ (nó nằm trong prefix của chính    │
         * │ lượt này) — thứ thiếu duy nhất là một câu bảo nó giữ lại.         │
         * │                                                                  │
         * │ ⚠ NHƯNG "GIỮ LẠI" MỘT MÌNH LÀ NỬA LUẬT, và nửa còn lại nguy hiểm │
         * │ ngang nửa đầu — user chỉ ra ngay khi đọc bản nháp. Một quyết định │
         * │ cũ ĐÃ SAI, đã được thay bằng quyết định mới, mà vẫn được chép lại │
         * │ "vì nó nằm trong trí nhớ cũ", thì kho có HAI dòng nói ngược nhau  │
         * │ và không ai biết dòng nào thắng. Đó đúng là thứ `supersedes` sinh │
         * │ ra để chặn ở tầng NODE (*"sau ba tháng kho đầy quyết định mâu     │
         * │ thuẫn, tệ hơn không nén"*) — ở đây nó tái diễn ở tầng DÒNG, bên    │
         * │ trong một node.                                                  │
         * │                                                                  │
         * │ Nên luật phải HAI CHIỀU và CÓ THỨ TỰ: giữ là mặc định · cái mới   │
         * │ thắng khi mâu thuẫn · mỗi chủ đề đúng một dòng.                   │
         * └──────────────────────────────────────────────────────────────────┘
         */
        `Trong ngữ cảnh của bạn đã có khối "What the human has decided" — đó là TRÍ NHỚ TỪ TRƯỚC, ` +
        `và bản bạn viết ra bây giờ sẽ THAY THẾ HẲN nó. Bốn luật, theo đúng thứ tự này:\n` +
        `1. CHÉP LẠI mọi mục cũ còn đúng. Bỏ một mục vì "phiên này không nhắc tới" là làm mất ` +
        `một quyết định người dùng đã chốt.\n` +
        `2. Mục cũ nào bị phiên vừa rồi SỬA hoặc HUỶ thì viết ĐÚNG MỘT dòng theo ý MỚI, và bỏ hẳn ý cũ. ` +
        `Tuyệt đối không để hai dòng nói ngược nhau về cùng một chuyện — cái mới thắng, cái cũ biến mất.\n` +
        `3. Mỗi chủ đề một dòng. Nếu phải viết "trước đây X, giờ Y" thì chỉ giữ Y.\n\n` +
        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ 🔴 LUẬT THỨ TƯ — TRÍ NHỚ CŨNG KHÔNG ĐƯỢC GHI KẾT LUẬN TỪ CA HỎNG.│
         * │ (user chốt 29/08, và user bắt đúng chỗ tôi đã khuyên SAI)        │
         * │                                                                  │
         * │ Tôi từng nói khối GHI NHỚ **không** áp luật `learnable` vì *"thẩm │
         * │ quyền của nó đến từ người dùng"*. Đúng một nửa, và nửa sai là nửa │
         * │ đắt: khối này KHÔNG phải thứ người dùng gõ ra — nó là **Trợ lý tự │
         * │ nén hội thoại của chính nó**, kể cả những lượt nó hỏng. Về nguồn  │
         * │ gốc, nó cùng lớp với `lessons`; chỉ cái tên nghe giống thẩm quyền.│
         * │                                                                  │
         * │ Và nó là kênh NGUY HIỂM NHẤT trong ba kênh, vì hai lý do:         │
         * │  ① nó nằm trong prefix của **mọi lượt `route()`**, tức trước cả   │
         * │    lúc lập kế hoạch — nó giết việc ngay ở cửa, không tốn một      │
         * │    nhân viên nào để lộ ra là có chuyện;                           │
         * │  ② `supersedes` bắt bản mới **chép lại** bản cũ, nên một câu sai  │
         * │    được **gia hạn ở mỗi lần nén**, không bao giờ hết hạn.        │
         * │                                                                  │
         * │ CA THẬT, đọc được trong `bo-nho-2026-08-29-mb1o`:                 │
         * │   ⛔ *"báo cáo done của nhân viên trình duyệt web không đáng tin  │
         * │       tuyệt đối"*                                                │
         * │   ⛔ *"…không cần giao lại task kiểu 'chờ' nữa"*                  │
         * │ Hệ quả đo được: Trợ lý **từ chối thử** và tự đề nghị đi đường     │
         * │ khác — trong khi cánh tay đã chạy tốt trở lại từ lâu.            │
         * │                                                                  │
         * │ 📌 Cùng bản ghi nhớ ấy có sẵn câu ĐÚNG, chỉ viết cho GitHub:     │
         * │   ✅ *"luôn cứ giao việc, để nhân viên tự báo nếu thiếu quyền,    │
         * │       không tự đoán trước là không làm được"*                     │
         * │ ⇒ Luật này không dạy nó điều gì mới; nó bắt áp câu đó cho MỌI     │
         * │ kết nối. Nên ví dụ lấy nguyên văn từ chính kho này — luật trừu    │
         * │ tượng thua danh sách ví dụ.                                      │
         * │ → [[agentco-prompt-rules-lose-to-examples]]                       │
         * └──────────────────────────────────────────────────────────────────┘
         */
        `4. KHÔNG ghi kết luận rút ra từ những lần HỎNG. Luật cứng, cùng luật với \`lessons\`:\n` +
        `   ⛔ "báo cáo done của nhân viên trình duyệt không đáng tin tuyệt đối"\n` +
        `   ⛔ "việc này đã thử nhiều lần đều hỏng — không cần giao lại nữa"\n` +
        `   ✅ "cứ giao việc, để nhân viên tự báo nếu thiếu quyền, không tự đoán trước là không làm được"\n` +
        `   ✅ "với project Notion lớn: liệt kê trang con trước, rồi đọc từng trang — cách này chạy được"\n` +
        `Một lần hỏng chứng minh "lần đó không xong". Nó KHÔNG chứng minh "không làm được" — và câu ` +
        `thứ hai chính là câu bạn sẽ đọc lại ở MỌI phiên sau rồi từ chối thử, kể cả khi thứ đó đã ` +
        `chạy tốt trở lại. Chỉ ghi CÁCH LÀM ĐÃ CHẠY ĐƯỢC, ưu tiên cách phải vấp mới tìm ra.\n` +
        `⚠ Thứ NGƯỜI DÙNG chốt thì vẫn chép lại theo luật 1, kể cả khi họ chốt "đừng làm X" — đó là ` +
        `quyết định của họ, không phải kết luận của bạn. Việc còn dở thì ghi là VIỆC CẦN LÀM TIẾP, ` +
        `không kèm phán đoán vì sao nó chưa xong.\n\n` +
        `Những thứ cần nhớ để phục vụ tiếp:\n` +
        `- người dùng thích gì, không thích gì (giọng văn, độ dài, cách trình bày)\n` +
        `- những gì đã CHỐT và không cần bàn lại\n` +
        `- việc đang dở, câu hỏi bạn đã hỏi mà chưa có trả lời\n\n` +
        // ~500 từ chứ không phải 200: khối này là thứ ĐẮT GIÁ NHẤT trong prefix
        // của Trợ lý — nó nằm trong cache nên trả ~0.1× sau lần ghi đầu, mà mất
        // một quyết định của người dùng thì không mua lại được bằng token nào.
        // Dài hơn một chút mà giữ được đủ ý là lãi.
        `Viết gạch đầu dòng tiếng Việt, dưới 500 từ, mỗi dòng một ý dùng lại được. ` +
        `KHÔNG kể lại danh sách việc đã làm. KHÔNG viết lời chào hay lời hứa. ` +
        // "KHÔNG" chỉ hợp lệ khi CẢ HAI đều trống. Bản trước không nói rõ, nên
        // một phiên chat vặt ("chào bạn") có thể trả về KHÔNG — và tuy nhánh đó
        // không ghi node mới (nên không xoá gì), câu dặn vẫn phải khớp với luật
        // gộp ở trên, nếu không thì hai câu trong cùng một prompt đá nhau.
        `Nếu KHÔNG có trí nhớ cũ và phiên này cũng không có gì đáng nhớ thì trả về đúng một chữ: KHÔNG`,
    );
    return { value: text.trim(), usage };
  }

  /** Sau khi nạp lại văn phòng từ đĩa. Giữ nguyên session. */
  rebind(office: LoadedOffice): void {
    this.office = office;
  }

  setHotKnowledge(text: string): void {
    this.hotKnowledge = text.trim();
  }

  /** Bản nén trí nhớ — khối riêng trong prefix, không trộn vào hot. */
  private memory = '';

  setMemory(text: string): void {
    this.memory = text.trim();
  }

  /**
   * Bảng kê tủ tài liệu. → docs/SPEC-library.md §8b
   *
   * Nằm trong prefix được cache, KHÔNG phải một lượt gọi tool. Cho Trợ lý một
   * tool để đi đọc mục lục thì mỗi lần đọc là một lượt, mà `route()` chạy ở MỖI
   * tin nhắn — đó là đường đông người qua lại nhất của sản phẩm.
   */
  private library = '';

  setLibrary(text: string): void {
    this.library = text.trim();
  }

  /**
   * Bảng kê KẾT QUẢ các ca trước. → docs/SPEC-artifacts.md §2.4
   *
   * Chỉ TÊN FILE. Trợ lý vẫn không đọc được một byte nào của chúng — nó chỉ
   * biết đủ để ghi đường dẫn vào `inputs` cho nhân viên đi mở. Ranh giới đó
   * giống hệt tủ tài liệu, và nó là lý do bẻ được luật "artifact vô hình" mà
   * không mở toang cái cửa luật ấy sinh ra để đóng.
   */
  private artifacts = '';

  setArtifacts(text: string): void {
    this.artifacts = text.trim();
  }

  /**
   * Ai được giao việc — do cạnh `Assistant → agent` trên canvas quyết định.
   *
   * Đây là chỗ kéo một sợi dây thành hậu quả ĐO ĐƯỢC: agent bị ngắt thì `pitch`
   * của nó biến khỏi ngữ cảnh Assistant. Cái giá đi kèm: roster nằm trong prefix
   * được cache, nên đổi dây = ghi lại cache một lần. Rẻ (roster vài trăm token)
   * nhưng KHÔNG miễn phí — đừng gọi hàm này mỗi lần kéo chuột.
   */
  setAssignable(ids: Set<string> | undefined): void {
    this.assignable = ids;
  }

  /**
   * Vai trò Assistant thật sự thấy. Scheduler dùng đúng danh sách này để validate.
   *
   * Vai trò đã LƯU TRỮ bị loại ở đây, không phụ thuộc vào canvas: `assignable`
   * đến từ cạnh nối, mà cạnh nối chỉ tồn tại khi có layout.json. Văn phòng chưa
   * có file đó thì `assignable` là undefined = "tất cả" — và "tất cả" phải
   * không bao gồm người đã cất đi.
   */
  assignableRoles(): Set<string> {
    const live = [...this.office.roles.keys()].filter((id) => !this.office.archivedRoles.has(id));
    if (!this.assignable) return new Set(live);
    return new Set(live.filter((id) => this.assignable!.has(id)));
  }

  /**
   * Danh bạ — chỉ pitch + một dòng khả năng, KHÔNG kèm skills.
   * → docs/SPEC-tools-approval.md §1
   *
   * Khả năng TỰ SINH từ connector/MCP đang nối vào agent, không bắt người dùng
   * viết tay vào `pitch`. Thiếu nó thì Trợ lý chia việc như thể không ai có
   * tool nào — không thể quyết "giao cho người này vì nó với tới được Notion".
   *
   * CỐ Ý chỉ nêu TÊN, không nêu schema: Trợ lý cần biết *với tới được cái gì*,
   * không cần biết *gọi thế nào*. Nó không gọi tool nào cả.
   */
  /**
   * Một cánh tay, nói bằng thứ Trợ lý CẦN, không bằng thứ ta lưu.
   *
   * ┌──────────────────────────────────────────────────────────────────────┐
   * │ 🔴 CA USER GẶP 24/08, BA LƯỢT LIÊN TIẾP, KHÔNG THOÁT RA ĐƯỢC:        │
   * │                                                                      │
   * │   — "Trong thư mục đã cho phép, tìm 5 file lớn nhất…"                │
   * │   — "Bạn cho mình xin đường dẫn đầy đủ của thư mục cần soi nhé?"     │
   * │   — "thư mục music"                                                  │
   * │   — "Bạn cho mình xin đường dẫn đầy đủ tới thư mục Music đó nhé?"    │
   * │   — "nhân viên của bạn biết thư mục này rồi"                         │
   * │   — "Mình vẫn cần đường dẫn đầy đủ…"                                 │
   * │                                                                      │
   * │ **Trợ lý không cố chấp — nó thật sự KHÔNG BIẾT.** `role.mcp` chỉ là   │
   * │ một mảng BĂM (`a385afc3ab6`), và bản trước đổ thẳng mảng đó vào dòng  │
   * │ năng lực. Băm không nói được nó trỏ vào đâu, nên câu *"thư mục đã cho │
   * │ phép"* không giải được, và người dùng thì tin rằng hệ thống đã biết   │
   * │ (đúng — `company.yaml` biết, chỉ Trợ lý là không).                    │
   * │                                                                      │
   * │ Đây là món nợ ĐÃ CÓ TÊN trong chính file này từ 22/08: *"dòng đó      │
   * │ liệt kê MCP bằng TÊN, không bằng NĂNG LỰC — tên server là LỜI KHAI,   │
   * │ danh sách tool của nó mới là SỰ THẬT"*. Ca này là món nợ đó thu lãi,  │
   * │ ở dạng rẻ nhất để trả: thư mục nằm sẵn trong `args`, `folderRoots` đã │
   * │ có sẵn, 0 lời gọi thêm.                                              │
   * │                                                                      │
   * │ ⚠ Ghi `thư mục:` chứ không dùng mũi tên hay dấu hai chấm trần — dòng  │
   * │ này nằm giữa một khối liệt kê và phải TỰ ĐỌC ĐƯỢC khi đứng một mình,  │
   * │ cùng luật đã áp cho `chạy lệnh: TẮT`.                                 │
   * └──────────────────────────────────────────────────────────────────────┘
   */
  private reach(role: Role): string {
    /**
     * ⚠ CHỈ bắc cầu khi vai trò có **từ HAI cánh tay trở lên**.
     *
     * Một cánh tay thì không có gì để nhầm — model gọi cái duy nhất nó thấy.
     * Dán chuỗi kỹ thuật vào mọi dòng là trả token cho thứ vô ích, và dạy model
     * rằng những chuỗi đó là nhiễu — rồi nó bỏ qua đúng lúc chuỗi đó có nghĩa.
     */
    const many = role.mcp.length > 1;
    const parts = role.mcp.map((id) =>
      armReach(this.office.company.arms, this.office.company.mcpServers, id, many ? id : undefined),
    );
    // Web bật sẵn cho mọi nhân viên (BUILTIN_TOOLS) nên luôn nêu — đây là khả
    // năng thật, và không nêu thì Trợ lý không biết mà giao việc tra cứu.
    parts.push('web');
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ `pitch` LÀ LỜI KHAI. Khối này là SỰ THẬT. Phải có cả hai.            │
     * │                                                                      │
     * │ Ca đo được 22/08 (bài 9.3): vai trò `nguoi-kiem-ke` có `pitch` ghi    │
     * │ *"Chạy lệnh để lấy thông tin về file và thư mục trên máy"* — nhưng    │
     * │ công tắc shell của nó ĐANG TẮT. Trợ lý đọc lời khai đó, giao việc,    │
     * │ và nhân viên tiêu **4 lượt · $0,1358** để phát hiện ra mình không có  │
     * │ tay. Rồi task sau đổ theo vì phụ thuộc.                               │
     * │                                                                      │
     * │ Không ai nói dối cả: `pitch` do người dùng gõ lúc tạo nhân viên, và   │
     * │ nó mô tả Ý ĐỊNH. Khả năng thì nằm ở `tools`, và trước dòng này Trợ lý │
     * │ **không có đường nào nhìn thấy `tools`**.                             │
     * └──────────────────────────────────────────────────────────────────────┘
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ ⚠ ĐÍNH CHÍNH 22/08 (lần chạy lại 9.3) — BẢN CHỈ-KHẲNG-ĐỊNH VÔ HIỆU.  │
     * │                                                                      │
     * │ Bản trước đẩy `lệnh trên máy` vào danh sách CHỈ KHI có shell, với lý  │
     * │ do *"luật 7 đã lo mặt phủ định"*. Chạy lại 9.3: Trợ lý **vẫn** giao   │
     * │ việc cho `nguoi-kiem-ke`, vẫn lập đủ 2 bước, vẫn tiêu $0,1380.        │
     * │                                                                      │
     * │ Vì sao: văn phòng `kiem-ke` KHÔNG AI có shell ⇒ chuỗi `lệnh trên máy` │
     * │ không xuất hiện ở đâu trong danh bạ ⇒ **vắng mặt không phải tín       │
     * │ hiệu**. Một dấu hiệu chỉ-khẳng-định chỉ đọc được nhờ TƯƠNG PHẢN, mà   │
     * │ ở đây không có gì để tương phản. Luật 7 cũng không thể bắn: theo bằng │
     * │ chứng Trợ lý cầm, `pitch` nói CÓ người hợp.                           │
     * │                                                                      │
     * │ ⇒ Cờ phải nêu CẢ HAI chiều (`BẬT`/`TẮT`) thì mỗi dòng mới tự mang     │
     * │   thông tin, không phụ thuộc vào việc trong phòng có ai khác kiểu.    │
     * │                                                                      │
     * │ Ý NGHĨA của cờ thì gom vào `SHELL_LEGEND`, nói MỘT LẦN. Nó là sự      │
     * │ thật về agentco, không phải thuộc tính của một nhân viên — đặt nó lên │
     * │ dòng của từng người là gán nhầm tầng, đúng cái sai đã sinh ra ca này. │
     * │ Hoà vốn token ở ~3 nhân viên, sau đó gom càng lúc càng thắng.         │
     * │                                                                      │
     * │ ⚠ Cờ vẫn viết `chạy lệnh: TẮT` chứ KHÔNG phải `shell: 0` — chú giải   │
     * │ nằm ở đầu khối, còn dòng thứ 9 thì đã xa; cờ phải tự đọc được khi     │
     * │ đứng một mình. 2 token cho việc không phụ thuộc vào khoảng cách.      │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    parts.push(shellFlag(role.tools));
    return ` [${parts.join(' · ')}]`;
  }

  /**
   * ẢNH CHỤP DANH BẠ — ai với tới đâu, tính bằng code, 0 token.
   * → docs/SPEC-arms.md §15
   *
   * Dựng từ chính chuỗi `armReach` mà `roster()` gửi đi, nên nó bắt đủ **mọi**
   * đường làm danh bạ khác đi: cắt/nối dây (`role.mcp`), đổi tên cánh tay
   * (`arms[id].label`), thêm/cất nhân viên (`assignableRoles`). So chuỗi với
   * chuỗi thay vì kể ra từng ca — thiếu một ca ở đây là im lặng, không phải lỗi.
   *
   * ⚠ Băm cấu hình (`armHash`) KHÔNG dùng được cho việc này: nó là danh tính
   * của một cánh tay, không phải của cái danh bạ. Đổi tên thì băm không đổi.
   */
  private reachMap(): Map<string, string[]> {
    const m = new Map<string, string[]>();
    for (const id of [...this.assignableRoles()].sort()) {
      const role = this.office.roles.get(id);
      // ⚠ CÙNG phép tính với `reach()`. Lệch một chỗ thì `reachDiff` báo "đổi"
      // cho một dòng không đổi gì — một cảnh báo giả ở mỗi lượt.
      const mcp = role?.mcp ?? [];
      const many = mcp.length > 1;
      const caps = mcp.map((x) =>
        armReach(this.office.company.arms, this.office.company.mcpServers, x, many ? x : undefined),
      );
      /**
       * CÔNG TẮC SHELL ĐI CHUNG MỘT ĐƯỜNG VỚI CÁNH TAY (user chốt 24/08).
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ Ca thật: user bật `Bash` cho một nhân viên rồi hỏi lại **y hệt**    │
       * │ câu cũ. Trợ lý đáp *"câu này mình đã thử trước đó rồi và bị chặn"*  │
       * │ — đúng cùng lớp lỗi với việc rút dây MCP, chỉ khác cái công tắc.    │
       * │                                                                    │
       * │ `roster()` **đã** đổi khi công tắc đổi (`shellFlag` nằm trong dòng  │
       * │ năng lực), nên prompt vốn đã đúng. Thứ thiếu là cái DIFF: bản trước │
       * │ chỉ chụp `role.mcp`, nên bật/tắt shell không sinh dòng nào và       │
       * │ lịch sử lại thắng.                                                 │
       * └────────────────────────────────────────────────────────────────────┘
       *
       * ⚠ Chỉ chụp thứ ĐỔI ĐƯỢC. `web` cũng nằm trong dòng năng lực nhưng nó
       * bật sẵn cho mọi người và không có công tắc — đưa vào đây là một token
       * không bao giờ diff, tức tiếng ồn thuần.
       */
      if (hasShell(role?.tools ?? [])) caps.push('chạy lệnh');
      m.set(id, caps);
    }
    return m;
  }

  /**
   * HẬU KIỂM TẤT ĐỊNH: câu vừa nói có nhắc tới cánh tay KHÔNG CÒN AI NỐI không?
   * → docs/SPEC-arms.md §15
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ VÌ SAO CẦN CỔNG NÀY DÙ ĐÃ CÓ DÒNG NHẮC TRONG PROMPT.                     │
   * │                                                                          │
   * │ Ca đo được 24/08 (`P` phiên `a425003b`): người dùng gõ **y hệt** một câu │
   * │ ba lần quanh lúc rút dây, và Trợ lý trả về **giống nhau từng ký tự** cả  │
   * │ ba, kèm nguyên văn `D:\Downloads\Programs Installation` — một đường dẫn  │
   * │ ĐÃ KHÔNG CÒN trong prompt của lượt đó (đo bằng cache: lượt 2 `cache_read │
   * │ = 0` sau 15 giây ⇒ prefix đã dựng lại, danh bạ đã sạch). Model chép lại  │
   * │ câu của CHÍNH NÓ trong lịch sử `resume`, không đọc lại danh bạ.          │
   * │                                                                          │
   * │ Một dòng dặn trong prompt là TÍN HIỆU, không phải cổng — nó không có     │
   * │ xác suất hỏng bằng 0 và không được ghi vào sổ như một bảo đảm            │
   * │ ([[agentco-deterministic-vs-signal]]). Cổng này thì tất định: danh sách  │
   * │ nhãn + thư mục gốc là HỮU HẠN và ta biết hết, nên "có nhắc tới hay       │
   * │ không" là một phép so chuỗi, không phải một phán đoán.                    │
   * │                                                                          │
   * │ ⚠ RANH GIỚI, phải giữ nguyên câu này: nó bắt được TÊN, không bắt được    │
   * │ CÁCH NÓI VÒNG. Spike L2 là ca thoát có thật — model bỏ tên thư mục       │
   * │ nhưng vẫn nói *"thư mục mà Người soi cài đặt phụ trách"*, không có chuỗi │
   * │ nào để khớp. ***ĐÃ HẸP LẠI, CHƯA ĐÓNG.***                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Ba điều kiện để một chuỗi bị tính là "cũ" — cả ba đều cần, và mỗi cái bịt
   * một ca dương tính giả đã nghĩ ra trước khi viết:
   *
   *  1. Cánh tay đó **không** nằm trong `role.mcp` của bất kỳ ai đang trực.
   *  2. Chuỗi **không** có trong câu người dùng vừa gõ — họ tự nêu tên thư mục
   *     rồi Trợ lý trả lời *"không ai với tới đó"* là hành vi ĐÚNG.
   *  3. Chuỗi **không** là một phần của cánh tay còn sống. `D:\X` bị rút mà
   *     `D:\X\con` vẫn nối thì nhắc `D:\X` không phải nói bậy.
   */
  private staleArmMentions(say: string, userText: string): string[] {
    const live = new Set<string>();
    for (const id of this.assignableRoles()) {
      for (const m of this.office.roles.get(id)?.mcp ?? []) live.add(m);
    }
    const book = this.office.company.arms;
    /**
     * Bù thêm TÊN TÀI KHOẢN cho kim thứ ba. → `staleMentions §arms.via`
     *
     * ⚠ Đọc kho OAuth có ĐIỀU KIỆN, không đọc mặc định: cổng này chạy ở **mọi**
     * lượt Trợ lý, và tuyệt đại đa số văn phòng không có cánh tay nào bị rút.
     * Không có ứng viên nào ⇒ không chạm đĩa. Cùng khuôn đọc-lười đã dùng ở
     * `office.ts §canvas`.
     */
    const needsOauth = Object.keys(this.office.company.mcpServers).some(
      (id) => !live.has(id) && (book[id]?.secrets?.length ?? 0) > 0,
    );
    const oauth = needsOauth ? readOAuth(companyPaths(this.office.companyDir)) : {};
    const arms: Record<string, { label?: string; via?: string }> = {};
    for (const [id, meta] of Object.entries(book)) {
      const via = (meta.secrets ?? []).map((s) => oauth[s]?.label).find(Boolean);
      arms[id] = { ...(meta.label ? { label: meta.label } : {}), ...(via ? { via } : {}) };
    }
    return staleMentions({
      arms,
      servers: this.office.company.mcpServers,
      live,
      say,
      userText,
    });
  }

  private roster(): string {
    const allowed = this.assignableRoles();
    const lines = [...this.office.roles.values()]
      .filter((r) => allowed.has(r.id))
      .map(
        (r) =>
          `- ${r.id} (${r.display_name || r.id}): ${r.pitch}` +
          this.reach(r) +
          (r.not_for.length ? ` [không làm: ${r.not_for.join(', ')}]` : ''),
      );
    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ VĂN PHÒNG RỖNG: NÓI VIỆC PHẢI LÀM, ĐỪNG ĐỂ MODEL TỰ BỊA RA LÝ DO.    │
     * │                                                                      │
     * │ Ca 24/08 — văn phòng mới tinh, 0 nhân viên. Người dùng hỏi *"tìm      │
     * │ giúp 5 quán cà phê ở quận 1"*, Trợ lý trả lời:                        │
     * │                                                                      │
     * │   *"văn phòng mình không có kết nối tìm kiếm thông tin bên ngoài"*    │
     * │   *"Mình không có khả năng truy cập internet"*                        │
     * │                                                                      │
     * │ Vế thứ hai ĐÚNG (Trợ lý `tools: []`). Vế thứ nhất **SAI**, và sai     │
     * │ theo chiều đắt nhất: `WebSearch`/`WebFetch` nằm trong `BUILTIN_TOOLS` │
     * │ nên **mọi nhân viên đều tra web được** — đo 24/08, chạy thật, ra kết  │
     * │ quả kèm nguồn. Thiếu duy nhất một thứ: văn phòng chưa có ai.          │
     * │                                                                      │
     * │ Dòng cũ `(none — nobody on duty)` chỉ nêu một sự kiện. Model lấp chỗ  │
     * │ trống bằng một lời giải thích nghe rất hợp lý về SẢN PHẨM — đúng thứ  │
     * │ luật *"đừng để model tự giải thích hệ thống cho người dùng"* cấm, và  │
     * │ hậu quả là người dùng tin sản phẩm không làm được việc nó làm được.   │
     * │                                                                      │
     * │ ⚠ Đoạn này CHỈ tồn tại khi roster rỗng ⇒ token trả đúng lúc nó có     │
     * │ giá trị, và bằng 0 ở mọi văn phòng đang hoạt động.                    │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    if (lines.length === 0) {
      /**
       * ⚠ ĐÃ ĐỔI CÙNG LÚC với việc `lookup` được tra web (24/08) — và phải cùng
       * lúc, nếu không thì đúng bệnh *hai bề mặt nói ngược nhau*: một bên trả
       * lời được câu hỏi, bên kia vẫn khai "không việc gì chạy được".
       *
       * Bản trước (viết sáng cùng ngày) nói *"No work can run until the human
       * adds one"*. Đúng lúc đó, nửa sai từ lúc `lookup` biết tra web.
       */
      return (
        `# Employees you can assign to\n\n(none — nobody has been added to this office yet)\n\n` +
        `You can still answer questions yourself through \`lookup\` — including looking things up ` +
        `on the web. What you cannot do is **produce anything the human keeps**: a file, a report, ` +
        `a table. That needs an employee, so when they ask for one, say so plainly and point them ` +
        `at the "+ Nhân viên" button. **Never describe this as something the product cannot do:** ` +
        `every employee can search and read the web, and open files on the machine by full path. ` +
        `What is missing is a person to assign to, not a capability.`
      );
    }
    return `# Employees you can assign to\n\n${SHELL_LEGEND}\n\n${lines.join('\n')}`;
  }

  /**
   * Mức model của Trợ lý này. Văn phòng có quyền ghi đè `models.master`.
   * → docs/SPEC-offices.md §4.5
   */
  get modelTier(): Tier {
    return this.office.config.assistant.model_tier ?? this.office.company.models.master;
  }

  /** Model thật sự sẽ chạy — để giao diện nói ra thay vì bắt người dùng đoán. */
  get model(): string {
    return this.office.company.models[this.modelTier];
  }

  private systemPrompt(): string[] {
    const built = buildAssistantPrompt(this.office, {
      roster: this.roster(),
      hotKnowledge: this.hotKnowledge,
      memory: this.memory,
      library: this.library,
      artifacts: this.artifacts,
      model: this.model,
    });
    return built.systemPrompt as string[];
  }

  /**
   * Lập kế hoạch — chạy ở query ONE-SHOT RIÊNG, KHÔNG nằm trong session Assistant.
   *
   * Lý do: prompt cache đánh theo (model, prefix). Nếu bước này chạy trên session
   * Assistant bằng một model khác (ví dụ Opus cho chất lượng) thì MỖI LẦN đổi model
   * là miss toàn bộ ngữ cảnh — đúng cái ~36.000 token quy đổi đã cảnh báo ở vụ MCP.
   * Tách ra thì đặt `models.planner: deep` thoải mái mà session vẫn ấm nguyên.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `planId` ĐƯỢC TRUYỀN VÀO, KHÔNG TỰ SINH — bug đã sửa 20/08.              │
   * │                                                                          │
   * │ Bản trước gọi `newPlanId()` ngay tại đây, còn `Office.run()` cũng gọi    │
   * │ `newPlanId()` cho bản ghi công việc của nó. HAI id cho MỘT ca. Rồi        │
   * │ `office.ts` ghi đè `plan.plan_id` bằng id của bản ghi — nhưng lúc đó      │
   * │ `artifactScoper` đã đóng khung xong mọi đường dẫn bằng id KIA.            │
   * │                                                                          │
   * │ Hậu quả đo được trên máy người dùng: `artifacts/P-260820-0302-ov9e/` tồn  │
   * │ tại trên đĩa, còn `tasks/index.json` chỉ biết `P-260820-0301-aajq`. Thư   │
   * │ mục kết quả mang một id MỒ CÔI — không có kế hoạch nào, không có file log │
   * │ nào tên đó. Người dùng còn nhìn thấy cả hai id trong cùng một tin nhắn    │
   * │ báo kết quả.                                                             │
   * │                                                                          │
   * │ Một ca = MỘT id, sinh ở đúng một chỗ (`Office.run`), chảy xuống mọi nơi  │
   * │ cần. Một id sinh ở hai chỗ thì kiểu gì cũng có ngày lệch.                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /**
   * Nhận một bản nháp có sẵn thay vì gọi model. → `decideRoute` cửa cứu hộ
   *
   * Mỏng có chủ ý: nó chỉ tiêm `default_deliver` của văn phòng vào `buildPlan`.
   * Để `Office` tự gọi `buildPlan` thì `Office` phải tự đi lấy con mặc định đó —
   * và ngày ai đó quên, `default_deliver: reply` im lặng vô tác dụng ở đúng một
   * trong hai cửa. Một phép biến đổi, một chỗ gọi.
   */
  adopt(draft: PlanDraft, request: string, planId: string): PlanOrAsk {
    return {
      kind: 'plan',
      plan: buildPlan(draft, request, planId, this.office.config.assistant.default_deliver),
    };
  }

  /**
   * WORKER ẨN — đọc file đã được xác minh, trả lời thẳng. → `RouteSchema` lookup
   *
   * Ba tính chất, và cả ba đều do CODE giữ chứ không do lời dặn:
   *
   *  · `persistSession: false` — thứ nó đọc **chết cùng lượt gọi**. Đây là cả
   *    lý do nó tồn tại thay vì trao `Grep` cho Trợ lý.
   *  · `tools` chỉ đọc — nó **không ghi được file**, nên nó không thể lấn sang
   *    việc của nhân viên kể cả khi Trợ lý định tuyến sai. Ranh giới "hỏi để
   *    BIẾT / giao để CÓ" là một giới hạn NĂNG LỰC, không phải một lời hứa.
   *  · `systemPrompt` là `LOOKUP_PROMPT` trần — không charter, không kho tri
   *    thức, không skills, không roster. Prefix tí xíu, và **không có gì ẩn**.
   *
   * `usage` trả về cho `Office` ghi sổ dưới khâu `lookup`: nó có hình dạng chi
   * phí riêng, gộp vào `route` thì không thấy khâu nào đang phình.
   */
  async lookup(paths: readonly string[], question: string): Promise<AssistantResult<string>> {
    const { text, usage } = await this.run(
      paths.length
        ? `Tài liệu cần đọc:\n${paths.map((p) => `- ${p}`).join('\n')}\n\nCâu hỏi: ${question}`
        : // Không nêu tài liệu nào = câu hỏi tra cứu chung. Nói RA điều đó thay vì
          // gửi một danh sách rỗng — một khối "Tài liệu cần đọc:" trống là thứ
          // model phải tự diễn giải, và nó sẽ diễn giải khác nhau mỗi lần.
          `Không có tài liệu nào của văn phòng liên quan tới câu này — tra trên web rồi trả lời.\n\nCâu hỏi: ${question}`,
      /**
       * Mức model của CHÍNH TRỢ LÝ, không phải `models.planner` — và cố ý KHÔNG
       * đẻ một knob thứ ba.
       *
       * Với người dùng thì đây LÀ Trợ lý đang trả lời; nó chỉ không giữ tài liệu
       * lại trong đầu. Nên nó phải nói cùng một chất lượng với phần còn lại của
       * cuộc trò chuyện, và cái knob quyết chuyện đó đã có sẵn:
       * `assistant.model_tier` của văn phòng.
       *
       * `models.planner` thì SAI hẳn trục: người ta đặt nó `deep` để khâu chia
       * việc nghĩ kỹ, và nếu dùng ở đây thì mỗi câu "file này nói gì" chạy Opus.
       */
      this.model,
      false,
      {
        systemPrompt: LOOKUP_PROMPT,
        /**
         * `Read` để đọc, `Grep` để tìm ĐÚNG CHỖ trong một file dài — luật "text
         * đã bóc dùng để TÌM, bản gốc dùng để ĐỌC KỸ" (SPEC-library §7). `Glob`
         * vì một đường dẫn thư mục vẫn hợp lệ trong `paths`.
         *
         * `WebSearch`/`WebFetch` thêm 24/08 — đo được **+992 token** vào prefix
         * của lượt lookup (2 828 → 3 820), và chỉ trả khi lookup thật sự chạy.
         *
         * ⚠ Cả năm đều CHỈ ĐỌC: worker ẩn vẫn không ghi được file, nên ranh giới
         * *"lookup TRẢ LỜI, không BÀN GIAO"* là một giới hạn NĂNG LỰC chứ không
         * phải một lời dặn — kể cả khi Trợ lý định tuyến sai.
         *
         * ⚠ Phải nói ra phần KHÔNG chặn được: `WebFetch` là một đường dữ liệu
         * ĐI RA, và giờ nó với tới được trong một văn phòng 0 nhân viên, 0 cấu
         * hình. Mọi nhân viên vốn đã có nó nên rủi ro tăng thêm là nhỏ — nhưng
         * nó đổi từ "phải dựng văn phòng trước" sang "mở app là có". Ghi ra để
         * sau này không ai bảo chưa tính. → SPEC-arms §5e (mô hình đe doạ)
         */
        tools: ['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'],
      },
    );
    return { value: text.trim(), usage };
  }

  async plan(request: string, planId: string): Promise<AssistantResult<PlanOrAsk>> {
    const models = this.office.company.models;
    const { text, usage } = await this.askOneShot(
      `Lập kế hoạch cho yêu cầu sau. Trả về đúng một object JSON như đã quy định.\n\nYêu cầu: ${request}`,
      models[models.planner],
    );

    const parsed = extractJson(text, PlanOutputSchema);
    if (!parsed) throw this.planFailed(request, text);

    // Nó cần biết thêm một thứ trước khi chia được việc. Đây là một CÂU NÓI,
    // không phải một lỗi — đi thẳng lên ô chat và không tốn token nhân viên nào.
    if ('ask' in parsed) return { value: { kind: 'ask', say: parsed.ask.trim() }, usage };

    return {
      value: {
        kind: 'plan',
        plan: buildPlan(parsed, request, planId, this.office.config.assistant.default_deliver),
      },
      usage,
    };
  }

  /**
   * Lập kế hoạch KHÔNG ra JSON — và đây là chỗ hệ thống từng NÓI DỐI.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BUG ĐÃ SỬA (20/08): một câu lỗi cho HAI nguyên nhân trái ngược.         │
   * │                                                                          │
   * │ Bản trước ném đúng một câu cho mọi ca: *"Trợ lý chưa hiểu đủ rõ để chia  │
   * │ việc. Thử nói cụ thể hơn…"* — một CHẨN ĐOÁN mà code không hề có căn cứ   │
   * │ để đưa ra. Nó chỉ biết duy nhất một sự thật: `extractJson` trả về rỗng.  │
   * │                                                                          │
   * │ Đo được trên máy người dùng 20/08: ba lượt liên tiếp nhận câu này, trong │
   * │ khi `route()` ngay trước đó viết lại yêu cầu **rất rõ ràng** (*"Tạo file │
   * │ ghi chú thuật ngữ riêng cho doc-3.md… lưu tại artifacts/vi/…"*). Người   │
   * │ dùng đọc câu lỗi rồi diễn đạt lại ba kiểu khác nhau — vô ích, vì diễn    │
   * │ đạt chưa bao giờ là vấn đề — và cuối cùng đoán *"hết tiền?"*. Trả lời    │
   * │ sai còn tệ hơn không trả lời: nó gửi người dùng đi sai hướng và tính     │
   * │ tiền một lượt `route` cho mỗi lần thử.                                   │
   * │                                                                          │
   * │ Ba nguyên nhân THẬT, cần ba câu khác nhau:                               │
   * │   · model không trả về gì   → lỗi hạ tầng, diễn đạt lại không cứu được   │
   * │   · model trả lời bằng VĂN  → nó đang hỏi/từ chối; nội dung câu đó CHÍNH │
   * │     LÀ thông tin, và bản cũ ném thẳng nó vào thùng rác                    │
   * │   · JSON sai hình dạng      → lỗi của ta hoặc của model, không của user  │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * ⚠ Có TRÍCH lời model, và điều đó không phá luật *"đừng để model tự giải
   * thích hệ thống cho người dùng"*. Luật đó cấm để model **kể về cơ chế** như
   * thể nó biết. Ở đây câu của nó được đóng ngoặc kép và giới thiệu là *"nó
   * nói"* — một BẰNG CHỨNG được trích dẫn, không phải một lời giải thích. Và
   * việc phải làm thì vẫn do code viết ra.
   *
   * Bản đầy đủ ghi ra `.state/plan-failure.log` — câu trên chat phải ngắn, còn
   * chẩn đoán một ca hỏng thì cần nguyên văn. Ghi hỏng KHÔNG được nuốt mất lỗi
   * gốc: người dùng đang chờ một câu trả lời, không phải một lỗi ghi file.
   */
  private planFailed(request: string, text: string): RunError {
    const raw = text.trim();
    this.logFailure('plan-failure.log', request, raw);

    if (!raw) {
      return new RunError(
        'Mình gọi được model nhưng nó không trả về gì cả — lỗi này nằm ở đường truyền, ' +
          'không phải ở cách bạn nói. Thử lại sau một chút nhé.',
        'other',
      );
    }
    /**
     * ⚠ Câu này ĐÃ PHẢI SỬA MỘT LẦN, và đó là bài học đáng giữ.
     *
     * Bản đầu (cùng ngày) khuyên: *"Trợ lý chỉ nhìn thấy tủ tài liệu, KHÔNG
     * nhìn thấy ngăn Kết quả"*. Đúng lúc viết, **sai vài giờ sau** khi bảng kê
     * kết quả ra đời (SPEC-artifacts §2.4). Một câu lỗi mô tả GIỚI HẠN của hệ
     * thống là một câu sẽ lạc hậu đúng vào ngày giới hạn đó được gỡ — và không
     * có test nào bắt được, vì nó chỉ là chữ.
     *
     * Nên bản này chỉ nói thứ **luôn đúng ở thời điểm chạy**: model đã phá giao
     * thức. Từ 20/08 nó CÓ cửa hợp lệ để hỏi (`{"ask": "…"}`), nên trả về văn
     * xuôi không còn là "nó cần hỏi" mà là "nó không dùng cửa đã có".
     */
    return new RunError(
      'Mình chưa chia được việc này. Thay vì một kế hoạch, Trợ lý nói:\n' +
        `  "${briefText(raw)}"\n` +
        'Câu đó lẽ ra phải đi qua đường hỏi lại chứ không phải viết thẳng ra như vậy — ' +
        'nên đây là lỗi của mình, không phải của cách bạn nói. Cứ giao lại y nguyên: ' +
        'phần lớn ca như thế chạy được ở lần thứ hai. Nếu nó hỏi một điều gì cụ thể thì ' +
        'trả lời luôn trong câu giao việc.',
      'other',
    );
  }

  /**
   * Tổng kết sau khi DAG chạy xong. Chạy TRÊN session Assistant — đây cũng là
   * cách kế hoạch (vốn lập ở query riêng) được ghi vào trí nhớ hội thoại, ở dạng
   * nén, để lần sau người dùng hỏi "sao lại làm thế" thì Assistant biết.
   *
   * Thu luôn BÀI HỌC CHUNG ở đây. Assistant là bên duy nhất được ghi vào
   * `knowledge/shared/` (SPEC-offices.md §4.3), và gộp vào lượt gọi sẵn có nên
   * KHÔNG tốn thêm lượt nào.
   */
  async report(
    steps: readonly { title: string }[],
    receipts: Receipt[],
    /** Số lượt lập kế hoạch không ra được kế hoạch trước ca này. → `worthLearning` */
    friction = 0,
    /** Ca này còn cảnh báo cấp CA không (file hứa mà thiếu · rơi ngoài khung). → `worthLearning` */
    leaked = false,
  ): Promise<AssistantResult<{ say: string; lessons: Lesson[] }>> {
    const plan = steps.map((s, i) => `${i + 1}. ${s.title}`).join(' · ');
    /**
     * ⚠ ĐÁNH DẤU NGAY TRONG BẢNG KẾT QUẢ việc nào được phép làm nguồn bài học.
     *
     * Cổng `learnable` là tất định và nó đã chặn ở vế "có hỏi hay không". Nhưng
     * một ca hỗn hợp (một việc `done`, một việc `blocked`) vẫn mở cổng — và lúc
     * đó model nhìn thấy CẢ HAI dòng, rồi rút bài học từ đúng dòng hỏng. Đó
     * chính là hình dạng của ba mẩu độc đo được 29/08.
     *
     * Điều kiện phải nằm **trên chính dòng** nó quản, không nằm trong một câu
     * luật ở đoạn dưới — luật trừu tượng thua danh sách ví dụ.
     * → [[agentco-prompt-rules-lose-to-examples]] · [[agentco-rule-must-see-what-it-governs]]
     */
    const summary = receipts
      .map((r) => {
        const head =
          `- [${r.status}] ${r.role}: ${r.say}${r.artifacts.length ? ` → ${r.artifacts.join(', ')}` : ''}` +
          (learnable(r) ? '   ⟵ ĐI ĐẾN ĐÍCH dù có vấp: CHỈ việc này được rút bài học' : '');
        /**
         * `gist` = SỰ KIỆN nhân viên tìm được. Đây là **thứ duy nhất** Trợ lý có
         * để trả lời câu hỏi của người dùng: nó không đọc được file (§4.7), nên
         * không có dòng này thì câu chốt hay nhất nó viết được vẫn là *"kết quả
         * nằm trong file kia"* — và người dùng phải đi mở, tệ nhất là qua bridge.
         *
         * ⚠ Xuống dòng + thụt vào chứ không nối vào `say`: `gist` được phép là
         * gạch đầu dòng (user chốt 30/08), và ép nó thành một dòng là bóp chết
         * đúng hình dạng hữu ích nhất của nó.
         */
        return r.gist ? `${head}\n    KẾT QUẢ: ${r.gist.replace(/\n/g, '\n    ')}` : head;
      })
      .join('\n');

    const wantLessons = worthLearning(receipts, friction, leaked);

    /**
     * Ca ma sát hỏi một câu KHÁC HẲN — và khác là cả điểm của nó.
     *
     * Ca trục trặc kỹ thuật hỏi *"cái bẫy đã vấp là gì"*. Ca ma sát thì cỗ máy
     * chạy sạch, nên hỏi câu đó sẽ nhận về "không có gì" — đúng, và vô dụng.
     * Thứ đáng học nằm ở phía NGƯỜI DÙNG: câu nào cuối cùng làm việc chạy được,
     * và lần sau nên hỏi thẳng điều gì. → `worthLearning`
     */
    const frictionAsk =
      `⚠ Người dùng đã phải nói lại ${friction} lần mới giao được việc này — mấy lượt trước ` +
      `bạn không chia được việc. Ca chạy thì sạch, nên bài học KHÔNG nằm ở kỹ thuật mà nằm ở ` +
      `chỗ hiểu nhau: câu nào của họ cuối cùng làm việc chạy được, và lần sau gặp yêu cầu ` +
      `tương tự thì nên hỏi thẳng điều gì ngay từ đầu?\n\n`;

    const { text, usage } = await this.askSession(
      `Kế hoạch vừa chạy: ${plan}\n\nKết quả:\n${summary}\n\n` +
        `Trả về đúng một object JSON trong khối \`\`\`json:\n` +
        /**
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ TRẢ LỜI CÂU HỎI, KHÔNG BÁO CÁO TIẾN ĐỘ. (user chốt 30/08)         │
         * │                                                                    │
         * │ > *"tôi thường xuyên phải vào file để xem kết quả, điều này càng    │
         * │ >  bất lợi khi dùng qua bridge"* · *"nó chỉ cần neo theo intent     │
         * │ >  của user là được"*                                              │
         * │                                                                    │
         * │ Bản cũ chỉ xin *"đã xong gì, có gì cần để ý"* — và nó cho ra đúng   │
         * │ *"mình đã ghi danh sách vào file X, bạn mở file đó để xem"*. Câu ấy │
         * │ **đúng** với thứ nó được hỏi; chỗ sai là câu hỏi.                   │
         * │                                                                    │
         * │ ⚠ ĐÂY LÀ NƠI DUY NHẤT NEO ĐƯỢC VÀO Ý ĐỊNH NGƯỜI DÙNG. Nhân viên     │
         * │ chưa bao giờ thấy câu họ gõ — nó chỉ thấy brief của task. Trợ lý    │
         * │ thì vẫn còn nguyên câu đó trong phiên. Nên phép chia là: **nhân     │
         * │ viên cấp SỰ KIỆN, Trợ lý NEO**.                                    │
         * │                                                                    │
         * │ ⚠ Và phải cấm bịa ngay tại đây: `gist` là nguồn DUY NHẤT. Một câu   │
         * │ chốt nghe trôi chảy mà thêm dữ kiện không ai kiểm được thì tệ hơn   │
         * │ hẳn câu "mở file ra xem".                                          │
         * └────────────────────────────────────────────────────────────────────┘
         */
        `{"say":"<tiếng Việt, TRẢ LỜI THẲNG câu người dùng vừa hỏi bằng số liệu và tên ` +
        `lấy từ dòng KẾT QUẢ ở trên — đó là thứ họ hỏi, đừng bắt họ mở file mới biết. ` +
        `Khoảng 1–3 câu, hoặc vài gạch đầu dòng nếu là danh sách. Nêu luôn thứ cần họ để ý. ` +
        `KHÔNG thêm bất kỳ dữ kiện nào không có ở dòng KẾT QUẢ. Không có dòng KẾT QUẢ nào ` +
        `thì nói thẳng đã làm gì và chỉ tới file. Không kể lại tiến độ, không thuật ngữ kỹ thuật>"` +
        (wantLessons
          ? `,\n "lessons":[{"kind":"pitfall","text":"<CÁCH LÀM dùng lại được cho VĂN PHÒNG này, dưới 25 từ>"}]}\n\n` +
            (friction > 0
              ? frictionAsk
              : `Có việc ĐI ĐẾN ĐÍCH dù trên đường có vấp — \`lessons\` là chỗ ghi lại CON ĐƯỜNG ` +
                `cuối cùng đã chạy được, tối đa 2, và vẫn ĐỂ TRỐNG nếu nó không dạy được gì dùng lại.\n` +
                `🔴 CHỈ rút từ dòng có dấu ⟵ ở trên. Việc \`blocked\`/\`failed\` KHÔNG được thành bài ` +
                `học, kể cả khi nó là chuyện đáng nói nhất trong ca: một việc chưa xong chứng minh ` +
                `"lần này không xong", nó KHÔNG chứng minh "không làm được". Ghi câu đó vào kho là ` +
                `dạy mọi nhân viên bỏ cuộc sớm ở lần sau — đã đo được đúng ca đó. Trục trặc chưa gỡ ` +
                `được thì nói trong \`say\` cho người dùng, đó mới là đúng người đọc.\n\n`) +
            `Bài học ghi CÁCH LÀM, tuyệt đối không ghi KIẾN THỨC:\n` +
            `  ✅ "chính sách đổi trả nằm ở library/files/doi-tra.md — grep ở đó trước khi trả lời"\n` +
            `  ⛔ "sản phẩm giảm trên 50% không được đổi trả"\n` +
            `Câu dưới đã nằm sẵn trong tài liệu của văn phòng. Chép nó vào đây là tạo ra một ` +
            `bản sao thứ hai KHÔNG AI CẬP NHẬT: ngày người dùng sửa chính sách, tài liệu đổi còn ` +
            `bài học thì không — và bài học THẮNG, vì nó nằm sẵn trong đầu mọi nhân viên còn tài ` +
            `liệu thì phải đi tìm.\n` +
            `Không ghi con số, ngưỡng, giá, ngày tháng. Chỉ ghi con đường đã đi và cái bẫy đã vấp.`
          : `}`),
    );

    const parsed = extractJson(text, ReportSchema);
    // Không đọc được thì vẫn phải có câu báo cáo — người dùng đang chờ.
    const value = parsed ?? { say: text.trim() || 'Đã xong.', lessons: [] };
    // Chốt cuối: không hỏi thì không nhận, kể cả model tự ý gửi kèm.
    return { value: wantLessons ? value : { ...value, lessons: [] }, usage };
  }

  /**
   * Quyết định người dùng vừa nói gì: trò chuyện, hỏi thêm, hay giao việc.
   *
   * Chạy TRÊN session Assistant (rẻ: ngữ cảnh chỉ có roster + charter + skills,
   * đã cache) nên nó nhớ cả cuộc hội thoại. "Chào" không được biến thành một
   * kế hoạch DAG — đó là lỗi người dùng gặp ngay thao tác đầu tiên.
   *
   * `ask` là trường hợp đáng giá nhất: yêu cầu mơ hồ thì HỎI LẠI thay vì lập
   * kế hoạch sai rồi đốt tiền. Đây đúng là nỗi đau gốc của sản phẩm — người
   * ngoại đạo hoang mang không biết AI đang dắt mình đi đâu.
   */
  async route(message: string, hasActivePlan: boolean): Promise<AssistantResult<RouteOutcome>> {
    /**
     * DIFF DANH BẠ khi nó vừa đổi — tín hiệu, **không phải** cổng. → `reachDiff`
     *
     * Cùng cơ chế `scopeHint` ngay dưới: một dòng có điều kiện, im khi không có
     * gì đổi. Nó tồn tại vì `resume` mang cả hội thoại cũ, và câu cũ của chính
     * Trợ lý là một VÍ DỤ — mà ví dụ thì thắng luật trừu tượng
     * ([[agentco-prompt-rules-lose-to-examples]]).
     *
     * ⚠ Bản đầu (24/08 sáng) chỉ nói *"danh bạ vừa đổi, đọc lại bên trên"* —
     * một lời dặn, và nó đặt cược vào đúng thứ vừa đo được là YẾU: bảo model
     * chú ý tới một dòng đã **biến mất**. Bản này nêu thẳng thay đổi, nên cái
     * biến mất trở thành một dòng chữ **xuất hiện**. Đổi trục, không phải dặn
     * to hơn. Cả số đo nằm ở `reachDiff`.
     *
     * ⚠ Cố ý KHÔNG nhét mã băm vào câu: người dùng không đọc nó, còn model thì
     * càng có chuỗi lạ càng dễ bịa ra một câu chuyện về chuỗi đó.
     *
     * Chỉ bắn khi ĐANG có phiên: lượt đầu của một phiên mới thì lịch sử rỗng,
     * không có gì để đính chính, và một dòng cảnh báo về "câu trước" khi không
     * có câu trước nào là mời model bịa ra một cái.
     */
    const now = this.reachMap();
    const changes =
      this.sessionId !== undefined && this.reachPrev !== undefined ? reachDiff(this.reachPrev, now) : [];
    const reachHint = changes.length
      ? `\n⚠ Danh bạ vừa đổi: ${changes.join(' · ')}. ` +
        `Danh sách nhân viên bên trên là bản ĐÚNG — bỏ qua mọi câu bạn đã nói trước đó về ai với tới đâu.`
      : '';
    this.reachPrev = now;

    const scopeHint = hasActivePlan
      ? `\nĐang có một công việc chạy dở. Với intent "task", đặt "scope":"refine" nếu câu này BỔ SUNG hoặc SỬA cho việc đang chạy; ` +
        `đặt "scope":"new" nếu đây là một việc KHÁC HẲN. Khi phân vân, chọn "new" — hai việc tách rời chỉ tốn thêm một lần lập kế hoạch, ` +
        `còn gắn nhầm vào việc đang chạy thì làm hỏng cả hai.`
      : `\nHiện không có việc nào đang chạy, nên với intent "task" luôn dùng "scope":"new".`;

    // `let`: cổng hậu kiểm bên dưới có thể cộng thêm một lượt sửa vào đây.
    let { text, usage } = await this.askSession(
      `Người dùng vừa nhắn: "${message}"\n\n` +
        `Trả về đúng một object JSON, không có gì khác:\n` +
        `{"intent":"chat","say":"<trả lời ngắn bằng tiếng Việt>"}\n` +
        `  dùng khi: chào hỏi, cảm ơn, hỏi về văn phòng, hỏi về việc đã làm, nói chuyện phiếm.\n` +
        `{"intent":"ask","say":"<một câu hỏi làm rõ, tiếng Việt>"}\n` +
        `  dùng khi: có vẻ là yêu cầu công việc NHƯNG thiếu thông tin quan trọng ` +
        `(làm cho ai, dài bao nhiêu, giọng thế nào, dựa trên tài liệu nào). ` +
        `Hỏi MỘT câu quan trọng nhất thôi. Thà hỏi còn hơn đoán sai rồi làm lại.\n` +
        `{"intent":"lookup","paths":["library/files/doc-2.md"],"question":"<câu hỏi, giữ nguyên ý người dùng>"}\n` +
        `  dùng khi: một câu HỎI ĐỂ BIẾT, trả lời xong là xong, không cần bàn giao file nào. Hai kiểu:\n` +
        `   (a) TRONG TÀI LIỆU CÓ GÌ — tóm tắt, tra một con số, một điều khoản, "file này nói về gì". ` +
        `Nêu đường dẫn vào "paths", lấy từ hai bảng kê trên HOẶC từ chính câu người dùng vừa gõ. Đừng bịa đường dẫn.\n` +
        /**
         * ⚠ DANH SÁCH VÍ DỤ THẮNG LUẬT TRỪU TƯỢNG — đo được 24/08.
         *
         * Bản đầu của dòng này liệt kê thẳng *"quán ăn, thời tiết, tin tức"*, và
         * luật ưu tiên nhân viên nằm cách đó bốn dòng bên dưới. Kết quả trên một
         * văn phòng CÓ nhân viên `nguoi-tim-tin` (pitch: *"duyệt web, đối chiếu
         * nhiều nguồn, dẫn nguồn"*):
         *
         *   "Tìm 5 quán cà phê ở quận 1"      → lookup  ❌ (phải là task)
         *   "Tin tức công nghệ hôm nay"       → lookup  ❌ (phải là task)
         *
         * Model khớp danh sách ví dụ rồi dừng, không đọc tới luật. ⇒ **điều kiện
         * phải nằm TRÊN CHÍNH DÒNG có ví dụ**, không nằm ở một câu khác.
         */
        `   (b) TRA CỨU CHUNG mà KHÔNG nhân viên nào trong danh bạ chuyên về việc đó — thời tiết, ` +
        `một địa chỉ, một con số ngoài đời, "X là gì". Khi đó để "paths" là mảng RỖNG.\n` +
        `       ⚠ Danh bạ CÓ người chuyên tìm tin/tra cứu/duyệt web thì mọi câu tra cứu đều về tay ` +
        `họ ("task"), kể cả quán ăn hay tin tức: họ đối chiếu nhiều nguồn và dẫn nguồn, "lookup" thì không.\n` +
        /**
         * ⚠ ĐIỀU KIỆN NẰM TRÊN CHÍNH DÒNG CÓ VÍ DỤ — cùng khuôn đã thắng ở
         * `chạy lệnh: TẮT` và ở nhánh (b) phía trên. Đặt nó thành một câu luật
         * ở đoạn khác thì model khớp ví dụ rồi dừng, không đọc tới.
         * → [[agentco-prompt-rules-lose-to-examples]]
         *
         * ┌────────────────────────────────────────────────────────────────────┐
         * │ 🔴 CA THẬT 30/08: người dùng hỏi *"Việc nào đang giao cho tôi?"*   │
         * │ Trợ lý viết brief: *"…lọc những việc gán cho người dùng có email    │
         * │ minh.vu.ptit.d14@gmail.com"* — một email **nó không có cách nào     │
         * │ biết**, và sai. Nhân viên tra đúng theo brief, không thấy ai, báo   │
         * │ về. 6 lượt, $0,1409, câu trả lời vô dụng.                          │
         * │                                                                    │
         * │ Trợ lý lập kế hoạch TRƯỚC mọi lời gọi cánh tay, nên về mặt cấu     │
         * │ trúc nó **không thể** biết người dùng là ai bên trong một dịch vụ.  │
         * │ Mọi định danh nó viết ra đều là phỏng đoán — kể cả khi đoán trúng.  │
         * │                                                                    │
         * │ ⚠ Và một định danh GẦN ĐÚNG nguy hiểm hơn một định danh sai rành   │
         * │ rành: lần này nó hỏng to tiếng (không có user nào mang email đó),   │
         * │ nhưng nếu cú đoán rơi trúng một người thật khác trong workspace     │
         * │ thì *"việc của tôi"* trả về việc của người khác — tự tin, gọn      │
         * │ gàng, kèm một file dẫn chứng, và không ai bắt được.                 │
         * └────────────────────────────────────────────────────────────────────┘
         */
        `{"intent":"task","request":"<viết lại yêu cầu thành một câu rõ ràng, đủ ngữ cảnh>","scope":"new"}\n` +
        `  dùng khi: đã đủ rõ để giao cho đội.\n` +
        `   ⚠ "tôi"/"mình"/"của tôi" thì GIỮ NGUYÊN như thế, đừng thay bằng tên, email hay ID nào — ` +
        `bạn không có cách nào biết người dùng là ai bên trong dịch vụ đó, và đoán gần đúng còn tệ hơn ` +
        `đoán sai hẳn. Viết "tài khoản đang đăng nhập của kết nối"; nhân viên hỏi chính cánh tay đó.\n` +
        `      ✅ "…lọc những việc gán cho tài khoản đang đăng nhập của kết nối Linear"\n` +
        `      ⛔ "…lọc những việc gán cho người dùng có email an@example.com"\n` +
        /**
         * LUẬT PHÂN CỬA `lookup` vs `task` — một câu, và nó phải đúng TRỤC.
         *
         * Câu hỏi KHÔNG phải *"ai làm được việc này"* — người dịch hoàn toàn đọc
         * và tóm tắt được một tài liệu, người dùng đã chứng minh điều đó trên
         * máy thật. Câu hỏi là *"ai làm thì kết quả có khác không"*.
         *
         * Dịch một tài liệu thì CÓ khác: nó phụ thuộc bảng thuật ngữ, giọng văn,
         * charter — tức là phụ thuộc `role`. Thuật lại xem tài liệu nói gì thì
         * KHÔNG: ai đọc cũng ra chừng ấy.
         *
         * Và đây cũng là câu trả lời cho ca *"người dùng tự tạo một nhân viên
         * chỉ-đọc rồi thấy Trợ lý tự làm hết"*: nhân viên đó tồn tại vì họ mang
         * một GÓC NHÌN (soát hợp đồng, kiểm số liệu), nên mọi câu hỏi cần góc
         * nhìn ấy vẫn về tay họ theo đúng luật này. `lookup` chỉ lấy phần mà vai
         * trò không thêm được gì — phần đó vốn không phải việc của ai cả.
         */
        `Phân biệt "lookup" với "task": hỏi xem NGƯỜI KHÁC làm thì kết quả có khác không. ` +
        `Dịch, viết, soát, tư vấn — CÓ khác, vì phụ thuộc chuyên môn và giọng của từng nhân viên → "task". ` +
        `Đọc rồi thuật lại xem tài liệu nói gì — ai đọc cũng ra chừng ấy → "lookup". ` +
        `Cần ra một FILE để người dùng giữ thì luôn là "task".\n` +
        /**
         * Luật ƯU TIÊN, user chốt 24/08: *"cho phép cả lookup cả nhân viên,
         * assistant tự định tuyến, nhưng ưu tiên nhân viên hơn nếu nhân viên là
         * người chuyên nghiệp và có thể làm chính xác việc đó"*.
         *
         * Nó KHÔNG đổi trục đã có ở câu trên — nó phá thế hoà. Trục là *"người
         * khác làm thì kết quả có khác không"*; khi hai bên nhìn ngang nhau,
         * nghiêng về nhân viên. Lý do bất đối xứng: chọn nhầm `task` thì tốn
         * thêm tiền và thời gian, chọn nhầm `lookup` thì người dùng **mất một
         * góc nhìn chuyên môn mà họ đã cố ý dựng ra** — và không ai thấy là đã
         * mất, vì câu trả lời vẫn trôi chảy.
         */
        `Khi hai cửa nhìn ngang nhau, NGHIÊNG VỀ NHÂN VIÊN: nếu trong danh bạ có người mà việc này ` +
        `đúng chuyên môn của họ, giao cho họ ("task"). "lookup" là cho phần mà không vai trò nào ` +
        `thêm được gì.` +
        scopeHint +
        reachHint,
    );

    // Quyết định là hàm THUẦN và có test riêng. Ở đây chỉ còn phần có tác dụng
    // phụ: ghi nhật ký ca hỏng. → `decideRoute`
    let value = decideRoute(text);

    // Cửa cứu hộ có ghi sổ, vì một cửa cứu hộ im lặng là một cái phễu êm ái:
    // model quên `intent` mãi mà không ai biết. → `RouteOutcome.salvaged`
    if ('salvaged' in value && value.salvaged) {
      this.logFailure('route-salvage.log', message, text.trim());
    }

    /**
     * ┌──────────────────────────────────────────────────────────────────────────┐
     * │ 🔴 CÂU CỨU HỘ PHẢI DO MODEL VIẾT, KHÔNG PHẢI HẰNG SỐ CỦA TA.            │
     * │ (user chốt 28/08)                                                        │
     * │                                                                          │
     * │ > *"fallback vẫn parse qua LLM để nó nói tiếng người lại, nhưng vẫn cần  │
     * │ >  phải có context chính xác là gì, không thì rất khó đến người cũng     │
     * │ >  không hiểu được"*                                                     │
     * │                                                                          │
     * │ Ba thứ một chuỗi ghim cứng không làm được, và cả ba đều đã cắn:          │
     * │  ① **Ngôn ngữ.** Nó là tiếng Việt ghim trong mã, nằm giữa một dòng chat  │
     * │     mà mọi câu khác đều do model viết theo tiếng người dùng đang gõ.     │
     * │  ② **Nguyên nhân.** Nó đoán *"lỗi của mình"* trong khi ca thật là **kết  │
     * │     nối đã bị rút** — người dùng đọc xong đi tìm sai chỗ.                │
     * │  ③ **Lối ra.** Nó bảo *"nhắn lại y nguyên"*, và người dùng làm đúng thế  │
     * │     rồi nhận lại y hệt. Một lời khuyên tất định sai còn tệ hơn im lặng.  │
     * │                                                                          │
     * │ ⚠ NHƯNG "để model nói" KHÔNG được thành "để model tự giải thích hệ       │
     * │ thống" — luật đã có ở `roster()`, sinh ra từ ca *"văn phòng mình không    │
     * │ có kết nối tìm kiếm"* (SAI, và nghe rất hợp lý). Nên lượt sửa này đưa    │
     * │ **nguyên văn thứ nó vừa nói** và bắt nó PHÁT LẠI, không bắt nó chẩn      │
     * │ đoán. Đó chính là *"cần có context chính xác"* user nói.                  │
     * │                                                                          │
     * │ Đúng khuôn cổng `stale` ngay dưới: phát hiện tất định trước, gọi model    │
     * │ sau, **sửa đúng một lần**. Sạch thì 0 đồng.                               │
     * └──────────────────────────────────────────────────────────────────────────┘
     */
    if (value.intent === 'garbled') {
      this.logFailure('route-failure.log', message, value.raw);
      /**
       * ⚠ NEO VÀO **VIỆC NGƯỜI DÙNG MUỐN**, không neo vào cái hỏng. (user 28/08)
       *
       * > *"LUÔN BÁM VÀO MỤC TIÊU CỦA CÂU HỎI USER MUỐN ĐẠT ĐƯỢC LÀ GÌ. Ví dụ:
       * >  tôi muốn đọc toeic-learning → báo hiện tại không thể kết nối đến mcp
       * >  github do vừa ngắt kết nối"*
       *
       * Mục tiêu VỐN nằm trong lịch sử phiên (`askSession` chạy trên session của
       * Trợ lý). Nhắc lại nguyên văn ở đây vì một lượt sửa nói về **định dạng**
       * rất dễ kéo model đi trả lời về định dạng — tức trả lời đúng câu hỏi cuối
       * cùng nó vừa đọc, và câu đó là câu của TA. Người dùng thì vẫn đang đợi
       * biết repo kia đọc được hay không.
       *
       * Tốn thêm token? Chỉ trên nhánh đã hỏng, và chỉ bằng độ dài câu họ vừa gõ.
       */
      const goal =
        `Việc người dùng đang muốn: "${truncateToTokens(message, 200)}".\n` +
        `Câu trả lời phải nói về ĐÚNG việc đó — làm được, hay chưa làm được và thiếu gì. ` +
        `ĐỪNG nói về định dạng hay về lỗi kỹ thuật: người dùng không thấy chuyện đó.\n`;
      const repair = await this.askSession(
        value.raw
          ? `⚠ Lượt vừa rồi bạn trả về thứ hệ thống KHÔNG dùng được. Nguyên văn:\n\n${value.raw}\n\n` +
              goal +
              `Nếu trong nguyên văn trên ĐÃ có câu trả lời cho người dùng, hãy PHÁT LẠI ĐÚNG câu đó, ` +
              `đúng định dạng {"intent":"chat","say":"…"}. Nếu chưa có, tự viết một câu ngắn.\n` +
              `⚠ ĐỪNG đoán nguyên nhân kỹ thuật. Chỉ nói thứ bạn ĐỌC ĐƯỢC trong danh bạ ở trên ` +
              `(ví dụ: không còn nhân viên nào nối tới kết nối cần dùng). ` +
              `Viết bằng đúng thứ tiếng người dùng đang dùng.`
          : `⚠ Lượt vừa rồi bạn không trả về gì cả.\n` + goal + `Trả lời lại, đúng định dạng JSON như trên.`,
      );
      usage = addUsage(usage, repair.usage);
      const fixed = decideRoute(repair.text);
      // Lượt sửa cũng hỏng ⇒ mới tới chuỗi ghim cứng. Nó là **phao cuối**, không
      // phải cửa thường — và giờ nó hiếm tới mức thấy nó là một tín hiệu thật.
      if (fixed.intent !== 'garbled') value = fixed;
      else this.logFailure('route-failure.log', `${message}\n[lượt sửa cũng hỏng]`, fixed.raw);
    }

    /**
     * BƯỚC 2 — CỔNG HẬU KIỂM. Đây mới là thứ chặn thật. → `staleArmMentions`
     *
     * Sạch thì tốn 0: một phép so chuỗi trên một danh sách hữu hạn. Chỉ khi
     * TRÚNG mới trả tiền một lượt sửa — cùng hình dạng `repairReceipt` của
     * worker (`worker.ts:401`): phát hiện tất định trước, gọi model sau.
     *
     * Sửa đúng MỘT lần. Vòng lặp ở đây là đốt tiền trên một thứ ta vốn đã biết
     * là không đóng được hoàn toàn.
     */
    const stale = this.staleArmMentions(routeText(value), message);
    if (stale.length) {
      const repair = await this.askSession(
        `⚠ Câu vừa rồi của bạn nhắc tới ${stale.map((s) => `"${s}"`).join(', ')} — nhưng KHÔNG nhân viên nào ` +
          `trong danh bạ hiện tại với tới đó nữa. Đó là thông tin CŨ còn sót lại từ hội thoại trước, ` +
          `không phải trạng thái bây giờ.\n` +
          `Đọc lại danh sách nhân viên bên trên và trả lời lại câu của người dùng, đúng định dạng JSON như trên.`,
      );
      usage = addUsage(usage, repair.usage);
      const fixed = decideRoute(repair.text);
      // Bản sửa hỏng định dạng thì GIỮ bản đầu: một câu cũ còn đọc được vẫn hơn
      // một câu không dùng được. Cùng luật "không trích JSON ra mặt người dùng".
      if (fixed.intent !== 'garbled') value = fixed;
      // Vẫn còn nhắc ⇒ đây là ca thoát của cổng, và nó phải để lại dấu vết.
      // Không có dòng này thì "đã hẹp lại, chưa đóng" là một câu không đo được.
      if (this.staleArmMentions(routeText(value), message).length) {
        this.logFailure('route-stale.log', message, `${stale.join(' · ')}\n${routeText(value)}`);
      }
    }
    return { value, usage };
  }

  // `chat()` ĐÃ BỎ (19/08) — nó là mã chết và việc nối nó lại là một lỗi.
  //
  // `route()` đã trả luôn `say` cho cả `chat` lẫn `ask`, và `handleUserBatch`
  // phát thẳng câu đó. Gọi thêm một hàm `chat()` sau `route()` nghĩa là HAI lượt
  // model cho một câu chào — trên đúng đường đông người qua lại nhất của sản
  // phẩm. → docs/SPEC-offices.md §6

  // ── nội bộ

  /**
   * Trên session Assistant.
   *
   * Model đọc lại ở MỖI lượt, cố ý. Trước đây chú thích ở đây ghi "model CỐ
   * ĐỊNH — không bao giờ đổi giữa ca", nhưng đó là mô tả một giới hạn chứ không
   * phải một bất biến: người dùng có quyền đổi model của Trợ lý, và cái giá của
   * việc đó đã biết rõ (SPEC-offices.md §4.5).
   *
   * Thứ THẬT SỰ bất biến là: đổi model KHÔNG được chạm vào việc đang chạy. Điều
   * đó đã đúng sẵn — `Office.applyCompanyConfig` dựng một `LoadedOffice` MỚI,
   * còn Scheduler của ca đang chạy giữ nguyên bản cũ nó cầm từ đầu. Trợ lý thì
   * mỗi lúc chỉ làm một việc (hòm thư khoá), nên không có lượt nào bị đổi model
   * giữa chừng.
   */
  /**
   * Nguyên văn thứ model trả về, cho người đi sửa lỗi. KHÔNG cho người dùng.
   *
   * Câu trên chat phải ngắn và nói việc phải làm; chẩn đoán một ca hỏng thì cần
   * đủ chữ. Ghi hỏng KHÔNG được nuốt mất ca gốc: người dùng đang chờ một câu trả
   * lời, không phải một lỗi ghi file.
   */
  private logFailure(file: string, request: string, raw: string): void {
    try {
      fs.mkdirSync(this.office.paths.state, { recursive: true });
      fs.appendFileSync(
        path.join(this.office.paths.state, file),
        `\n=== ${new Date().toISOString()}\n--- yêu cầu\n${request}\n--- model trả về (${raw.length} ký tự)\n${raw || '(RỖNG)'}\n`,
        'utf8',
      );
    } catch {
      /* không ghi được nhật ký thì vẫn phải trả lời người dùng */
    }
  }

  private askSession(prompt: string): Promise<{ text: string; usage: Usage }> {
    return this.run(prompt, this.model, true);
  }

  /** Query độc lập, không đụng session. Đổi model ở đây là an toàn. */
  private askOneShot(prompt: string, model: string): Promise<{ text: string; usage: Usage }> {
    return this.run(prompt, model, false);
  }

  private async run(
    prompt: string,
    model: string,
    useSession: boolean,
    /**
     * Ghi đè cho WORKER ẨN — và cố ý chỉ có ĐÚNG HAI trường.
     *
     * Mọi thứ khác (`abortController`, `settingSources`, `strictMcpConfig`,
     * `persistSession`) phải giữ nguyên cho mọi lượt. Mở rộng thành một object
     * options tự do là mời một ngày nào đó có người tắt mất `abortController`
     * cho một nhánh, rồi `/stop` im lặng thôi tác dụng ở đúng nhánh đó — lớp
     * lỗi vừa sửa sáng nay.
     */
    override?: { systemPrompt: string; tools: string[] },
  ): Promise<{ text: string; usage: Usage }> {
    let usage: Usage = { ...EMPTY_USAGE };
    let text = '';

    // Một tay cầm cho MỖI lượt, không dùng lại: một `AbortController` đã abort
    // thì abort vĩnh viễn, nên tái sử dụng nghĩa là lượt kế tiếp chết ngay khi
    // vừa sinh ra. Xem `inflight`.
    const controller = new AbortController();
    this.inflight = controller;
    // Con trỏ hội thoại TRƯỚC lượt này — xem nhánh `aborted` ở `catch`.
    const sessionBefore = this.sessionId;

    try {
      for await (const msg of query({
        /**
         * ⚠ STREAMING INPUT, KHÔNG PHẢI CHUỖI — và đây là điều kiện để
         * `canUseTool` chạy. Truyền `prompt` là một chuỗi thì SDK **im lặng bỏ
         * qua `canUseTool`**: không lỗi, không cảnh báo, tool vẫn chạy, cổng
         * chặn không tồn tại.
         *
         * Đã đo 19/08: Trợ lý `Grep` được vào sổ tay của một nhân viên đã bị
         * ngắt dây, `gate.log` rỗng tuyệt đối. Tệ hơn nữa, khi bị hỏi về một
         * file ngoài vùng cho phép nó trả lời *"mình không có quyền xem"* —
         * **model tự diễn theo bản đồ thư mục trong prompt**, trong khi thực
         * tế nó có toàn quyền. Đúng thứ luật *"đừng để model tự giải thích hệ
         * thống cho người dùng"* đã cấm: nghe rất hợp lý và sai hoàn toàn.
         *
         * Generator này yield MỘT lần rồi kết thúc, nên stream đóng ngay — khác
         * hẳn ca DEADLOCK ở §8, vốn do GIỮ MỞ stream để chờ `interrupt()`.
         */
        prompt: oneShot(prompt),
        options: {
          systemPrompt: override?.systemPrompt ?? this.systemPrompt(),
          model,
          cwd: this.office.dir,
          maxTurns: 4,
          settingSources: [],
          strictMcpConfig: true,
          /**
           * ┌──────────────────────────────────────────────────────────────────┐
           * │ `tools` GIỚI HẠN. `allowedTools` CHỈ TỰ-DUYỆT. HAI THỨ KHÁC NHAU.│
           * │                                                                  │
           * │ Bản trước chỉ đặt `allowedTools: []` và tưởng thế là "Trợ lý      │
           * │ không có tool". Không phải — đó chính xác là con rò đã tìm ra ở   │
           * │ worker ngày 16/08 (§5d): `allowedTools` không cắt tool khỏi ngữ   │
           * │ cảnh, nên ĐỊNH NGHĨA của toàn bộ bộ tool Claude Code vẫn nằm      │
           * │ trong prefix — ở đây là prefix của `route()`, thứ chạy ở MỖI TIN  │
           * │ NHẮN người dùng gõ. Worker được vá 16/08; Trợ lý bị bỏ quên.      │
           * │                                                                  │
           * │ `tools` phải LUÔN được truyền, kể cả khi danh sách rỗng — và ở    │
           * │ đây nó rỗng THẬT.                                                 │
           * └──────────────────────────────────────────────────────────────────┘
           *
           * ┌──────────────────────────────────────────────────────────────────┐
           * │ VÌ SAO TRỢ LÝ KHÔNG CÓ `Grep` — dù ai cũng muốn nó có.           │
           * │                                                                  │
           * │ Ngày 19/08 đã thử trao `Grep`/`Glob` kèm một cổng chặn theo thư  │
           * │ mục, để nó không đọc được sổ tay của nhân viên đã bị ngắt dây.   │
           * │ **Ba cơ chế, không cơ chế nào chặn được:**                        │
           * │                                                                  │
           * │   `canUseTool`                     → không nổ lần nào             │
           * │   `canUseTool` + streaming input   → không nổ lần nào             │
           * │   hook `PreToolUse` (± `matcher`)  → không nổ lần nào             │
           * │                                                                  │
           * │ Đo bằng cách ghi mọi quyết định ra `.state/gate.log`: file RỖNG   │
           * │ TUYỆT ĐỐI trong khi `Grep` vẫn chạy và vẫn đọc được file cấm.     │
           * │ Suy đoán tốt nhất: tool chỉ-đọc được CLI tự duyệt và không đi qua │
           * │ đường phê duyệt nào cả. Chưa xác nhận được, nên **đừng xây gì lên │
           * │ phần này** cho tới khi đo lại.                                    │
           * │                                                                  │
           * │ 🔥 Và đây là lý do phải BỎ HẲN chứ không "tạm chấp nhận": khi bị │
           * │ hỏi về một file ngoài vùng, Trợ lý trả lời *"mình không có quyền  │
           * │ xem file cấu hình hệ thống"* — nó DIỄN theo bản đồ thư mục trong  │
           * │ prompt, trong khi thực tế có toàn quyền. Không hàng rào thì còn   │
           * │ biết là không có; một hàng rào giả được model thuật lại đầy tự    │
           * │ tin thì tệ hơn hẳn. Đúng luật "đừng để model tự giải thích hệ     │
           * │ thống cho người dùng".                                            │
           * │                                                                  │
           * │ Đường ra CÓ tồn tại — tự khai một tool MCP với `where` là ENUM    │
           * │ dựng từ `assignableRoles()`, thì thao tác sai không diễn đạt      │
           * │ được. Nhưng "Trợ lý KHÔNG gắn MCP" là luật cứng: MCP phá prompt   │
           * │ cache khi resume (~36K token/lượt), mà `route()` resume ở mọi tin │
           * │ nhắn. Đổi 36K token/lượt lấy một tiện ích là lỗ nặng.             │
           * │                                                                  │
           * │ Và cái giá của việc bỏ: ĐO ĐƯỢC LÀ BẰNG KHÔNG. Trong lần chạy    │
           * │ lại bài 2, Trợ lý không gọi tool nào — bảng kê tủ tài liệu trong  │
           * │ prefix đã đủ để nó lập kế hoạch đúng.                             │
           * └──────────────────────────────────────────────────────────────────┘
           */
          /**
           * `tools` GIỚI HẠN — nên worker ẩn nhận đúng ba tool chỉ-đọc và
           * KHÔNG ghi được file. `allowedTools` đi kèm để chúng không bị hỏi
           * duyệt: đây là một lượt chạy nền, không có ai ở đó để bấm.
           */
          tools: override?.tools ?? [],
          allowedTools: override?.tools ?? [],
          abortController: controller,
          ...(useSession ? {} : { persistSession: false }),
          ...(useSession && this.sessionId ? { resume: this.sessionId } : {}),
        },
      })) {
        const m = msg as Record<string, unknown>;
        // Hạn mức tài khoản đi kèm luồng, MIỄN PHÍ. Trợ lý mở query ở MỌI tin
        // nhắn người dùng gõ, nên đây là nguồn cập nhật dày nhất — kể cả khi
        // không có nhân viên nào chạy. → `core/energy.ts`
        if (m['type'] === 'rate_limit_event') noteRateLimit(m['rate_limit_info']);
        // CHỈ ghi nhận session id khi đang chạy TRÊN session Assistant. Query
        // one-shot (lập kế hoạch) cũng sinh session_id riêng — ghi đè bằng nó
        // là mất trí nhớ hội thoại.
        if (useSession && typeof m['session_id'] === 'string' && (m['type'] === 'result' || m['subtype'] === 'init')) {
          this.sessionId = m['session_id'];
        }
        if (m['type'] === 'result') {
          const u = (m['usage'] ?? {}) as Record<string, number>;
          // Chỉ đo trên session THẬT. Query one-shot (lập kế hoạch) có ngữ cảnh
          // riêng, lấy số của nó là đo nhầm người.
          if (useSession) {
            this.contextTokens = (u['cache_read_input_tokens'] ?? 0) + (u['cache_creation_input_tokens'] ?? 0);
          }
          usage = addUsage(usage, {
            input: u['input_tokens'] ?? 0,
            output: u['output_tokens'] ?? 0,
            cacheRead: u['cache_read_input_tokens'] ?? 0,
            cacheWrite: u['cache_creation_input_tokens'] ?? 0,
            costUSD: typeof m['total_cost_usd'] === 'number' ? m['total_cost_usd'] : 0,
            model,
            turns: typeof m['num_turns'] === 'number' ? m['num_turns'] : 0,
          });
          /**
           * KẾT QUẢ LỖI KHÔNG ĐƯỢC ĐI TIẾP NHƯ MỘT KẾT QUẢ RỖNG (20/08).
           *
           * SDK báo lỗi bằng HAI đường: ném exception (bắt ở `catch` dưới), và
           * — với lỗi xảy ra GIỮA lượt chạy — trả về một message `result` mang
           * `is_error: true` / `subtype: 'error_*'`. Đường thứ hai không ném gì
           * cả, nên bản trước để nó rơi xuống `text = ''` rồi đi tiếp như thể
           * model đã trả lời xong mà không nói gì.
           *
           * Hậu quả: tầng trên đọc chuỗi rỗng, không parse được JSON, rồi đổ
           * lỗi cho cách người dùng diễn đạt — trong khi thứ vừa xảy ra là hết
           * hạn mức, mất mạng, hay hết lượt. `classifyError` mới là thứ phải
           * quyết, và nó chỉ quyết được nếu lỗi ĐI TỚI được nó.
           */
          const failed =
            m['is_error'] === true ||
            (typeof m['subtype'] === 'string' && m['subtype'].startsWith('error'));
          if (failed) {
            /**
             * ┌──────────────────────────────────────────────────────────────┐
             * │ 🔴 ĐÂY LÀ CHỖ NGƯỜI DÙNG ĐỌC ĐƯỢC CHỮ `error_max_turns`.     │
             * │ (user 27/08: *"sao trả 1 cái lỗi error_max_turns ai biết là  │
             * │  gì"*)                                                       │
             * │                                                              │
             * │ SDK trả `subtype: 'error_max_turns'` với `result` RỖNG, nên   │
             * │ dòng cũ rơi xuống vế thứ hai và ném thẳng **mã máy** ra màn   │
             * │ hình. Không phải lỗi logic — chỉ là chưa ai dịch.             │
             * │                                                              │
             * │ ⚠⚠ PHẢI PHÂN LOẠI TRÊN MÃ GỐC, KHÔNG TRÊN CÂU ĐÃ DỊCH.       │
             * │ `classifyError` khớp bằng regex `/max_turns/`. Dịch trước rồi │
             * │ mới phân loại là câu tiếng Việt không khớp gì cả ⇒ mọi lỗi     │
             * │ tụt về `other` ⇒ tầng trên xử lý sai, **im lặng**. Bản vá cho  │
             * │ câu chữ mà làm hỏng luồng điều khiển là cái giá không ai thấy. │
             * └──────────────────────────────────────────────────────────────┘
             */
            const raw =
              (typeof m['result'] === 'string' && m['result'].trim()) ||
              (typeof m['subtype'] === 'string' ? m['subtype'] : 'lỗi không rõ từ Claude Code');
            const kind = classifyError(raw);
            throw new RunError(sayError(raw, kind), kind, { cause: m });
          }
          text = typeof m['result'] === 'string' ? m['result'] : '';
        }
      }
    } catch (err) {
      /**
       * NGẮT THEO YÊU CẦU NGƯỜI DÙNG KHÔNG PHẢI LỖI — hỏi TAY CẦM, đừng đọc
       * câu chữ của lỗi.
       *
       * SDK ném ra một `AbortError` khi bị abort, và cám dỗ tự nhiên là so tên
       * lỗi hoặc dò chữ "abort" trong `message`. Cả hai đều là suy đoán trên
       * chuỗi do thư viện bên ngoài sinh ra, và sẽ lệch vào ngày nó đổi câu chữ.
       * `controller.signal.aborted` là SỰ VIỆC ta tự gây ra và tự quan sát được
       * — cùng đúng một luật đã bác bỏ việc đoán bằng regex ở `landingOf`.
       *
       * Phải đứng TRƯỚC nhánh `RunError`: một `usage_limit` ném ra đúng lúc
       * người dùng bấm Dừng thì thứ vừa xảy ra vẫn là "đã dừng".
       */
      if (controller.signal.aborted) {
        /**
         * TRẢ CON TRỎ HỘI THOẠI VỀ CHỖ CŨ.
         *
         * `sessionId` được ghi từ tin `init`, tức là NGAY ĐẦU lượt — trước khi
         * model nói một chữ nào. Ngắt giữa chừng rồi giữ con trỏ mới nghĩa là
         * lượt sau `resume` vào một bản ghi VIẾT DỞ, và cái giá của một bản ghi
         * hỏng là toàn bộ trí nhớ hội thoại — thứ đắt nhất trong sản phẩm.
         *
         * Bản ghi cũ vẫn nằm nguyên trên đĩa (`~/.claude/projects/`, append-only)
         * nên trả về là an toàn. Ngữ nghĩa cũng đúng: người dùng bấm Dừng thì
         * lượt đó KHÔNG XẢY RA — không có câu nào được nói, không có gì để nhớ.
         */
        this.sessionId = sessionBefore;
        throw new RunError('Đã dừng theo yêu cầu của bạn.', 'stopped', { cause: err });
      }
      // `RunError` do chính vòng lặp trên ném ra thì ĐI THẲNG: nó đã mang đúng
      // `kind` rồi, bọc lại một lần nữa là chạy `classifyError` trên câu tiếng
      // Việt của chính mình và có ngày hạ một `usage_limit` xuống `other`.
      if (err instanceof RunError) throw err;
      throw new RunError(err instanceof Error ? err.message : String(err), classifyError(err), {
        cause: err,
      });
    } finally {
      // Chỉ dọn tay cầm CỦA CHÍNH MÌNH. Hòm thư khoá nên hai lượt không chồng
      // nhau được, nhưng phép so này làm điều đó thành BẢO ĐẢM chứ không phải
      // một giả định — nếu khoá có ngày hở, xoá nhầm tay cầm của lượt sau nghĩa
      // là `/stop` im lặng mất tác dụng, đúng lớp lỗi vừa sửa.
      if (this.inflight === controller) this.inflight = undefined;
    }

    return { text, usage };
  }
}

function clampStep(step: number, count: number): number {
  return Math.max(0, Math.min(step, Math.max(0, count - 1)));
}

/**
 * Mã kế hoạch — ĐỌC ĐƯỢC BẰNG MẮT. → docs/SPEC-artifacts.md §2.1
 *
 * ```
 * cũ   P-mt08w0t8-iu50     base36 của Date.now()
 * mới  P-260819-1430-iu50
 * ```
 *
 * Cùng một lượng thông tin, khác ở chỗ con người đọc được. Mã này thành TÊN THƯ
 * MỤC (`artifacts/<plan_id>/`) và người dùng được bảo đi mở nó trong file
 * explorer, nên "đọc được" không phải chuyện thẩm mỹ.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ KHÔNG CẦN DI TRÚ, và lý do là CẤU TRÚC chứ không phải may mắn:           │
 * │ `plan_id` KHÔNG BỊ PARSE Ở ĐÂU CẢ. Nó chỉ là một khoá và một đoạn đường  │
 * │ dẫn. Kế hoạch cũ giữ tên cũ, kế hoạch mới nhận tên mới, hai loại sống     │
 * │ chung vô thời hạn. Sắp xếp từ điển vẫn đúng thứ tự thời gian ở cả hai.    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Bốn ký tự ngẫu nhiên vẫn giữ: phút là độ phân giải thô, và hai kế hoạch trong
 * cùng một phút đụng nhau với xác suất 1/36⁴ ≈ 1/1.680.000.
 */
export function newPlanId(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `P-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

function extractJson<T>(text: string, schema: z.ZodType<T>): T | undefined {
  const candidates: string[] = [];
  for (const m of [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)].reverse()) {
    if (m[1]) candidates.push(m[1]);
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));

  for (const raw of candidates) {
    try {
      const parsed = schema.safeParse(JSON.parse(raw.trim()));
      if (parsed.success) return parsed.data;
    } catch {
      /* thử ứng viên tiếp theo */
    }
  }
  return undefined;
}

/** Dùng khi ghi log — đảm bảo không bao giờ đổ nguyên transcript vào file log nhỏ. */
export function briefText(s: string): string {
  return truncateToTokens(s.replace(/\s+/g, ' ').trim(), 200);
}
