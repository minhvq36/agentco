/**
 * CÂU HỎI DUY NHẤT: một MCP server HTTP mà **Claude Code CLI của khách** đã đăng
 * nhập OAuth rồi — thì tiến trình do **Agent SDK** đẻ ra có dùng lại được chìa
 * đó không, khi ta vẫn giữ nguyên `strictMcpConfig: true` + `settingSources: []`
 * như `worker.ts §324-325`?
 *
 * Vì sao hỏi: cổng của Figma lọc theo `client_name` lúc đăng ký động (đo 29/08:
 * `agentco` → 403 thân rỗng · `Claude Code` → 200). Nếu chìa của CLI dùng lại
 * được thì agentco **không cần** được Figma duyệt — Claude Code đã ở trong danh
 * sách, và người đăng nhập là khách chứ không phải ta.
 *
 * ⚠ ĐO BẰNG GOOGLE DRIVE, KHÔNG BẰNG FIGMA. Cùng hình dạng (HTTP + OAuth lưu
 * trong CLI), nhưng Drive **đã đăng nhập sẵn** trên máy này nên đo được ngay,
 * không cần tài khoản Figma và không cần ai bấm đồng ý. Thứ đang đo là **cơ
 * chế thừa kế chìa**, không phải Figma.
 *
 * Chạy: npx tsx scripts/spike-inherit-cli-oauth.ts
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

type InitInfo = { name: string; status: string }[];

const DRIVE = { type: 'http' as const, url: 'https://drivemcp.googleapis.com/mcp/v1' };
const FIGMA = { type: 'http' as const, url: 'https://mcp.figma.com/mcp' };

async function probe(
  label: string,
  opts: Record<string, unknown>,
): Promise<void> {
  const t0 = Date.now();
  let seen: InitInfo | null = null;
  const errs: string[] = [];
  try {
    for await (const m of query({
      prompt: 'ok',
      options: {
        maxTurns: 1,
        persistSession: false,
        allowedTools: [],
        systemPrompt: 'Reply with one word.',
        stderr: (s: string) => {
          const line = s.trim();
          if (line && /mcp|oauth|auth|401|403/i.test(line)) errs.push(line.slice(0, 300));
        },
        ...opts,
      },
    } as never)) {
      const msg = m as { type?: string; subtype?: string; mcp_servers?: InitInfo };
      if (msg.type === 'system' && msg.subtype === 'init') {
        seen = msg.mcp_servers ?? [];
        break; // chỉ cần cái bắt tay, không cần chạy hết lượt
      }
    }
  } catch (e) {
    errs.push(`THROW ${(e as Error).message.slice(0, 300)}`);
  }
  console.log(`\n── ${label}   (${Date.now() - t0}ms)`);
  console.log('   mcp_servers:', seen === null ? '(không thấy system.init)' : JSON.stringify(seen));
  for (const e of errs.slice(0, 6)) console.log('   stderr:', e);
}

async function main(): Promise<void> {
  // ① Đúng hình dạng worker.ts hôm nay.
  await probe('A · drive · strictMcpConfig:true · settingSources:[]  ← hình dạng worker.ts', {
    strictMcpConfig: true,
    settingSources: [],
    mcpServers: { drive: DRIVE },
  });

  // ② Nới `settingSources` — nếu A hỏng mà B chạy thì chìa đi theo settings.
  await probe('B · drive · strictMcpConfig:true · settingSources:["user"]', {
    strictMcpConfig: true,
    settingSources: ['user'],
    mcpServers: { drive: DRIVE },
  });

  // ③ Không khai gì cả — CLI tự nạp server của khách hay không.
  await probe('C · KHÔNG khai mcpServers · settingSources:["user"] · strict:false', {
    settingSources: ['user'],
  });

  // ④ Đối chứng: Figma CHƯA đăng nhập. Phải ra khác A nếu A thật sự dùng chìa.
  await probe('D · figma (chưa login) · strictMcpConfig:true · settingSources:[]', {
    strictMcpConfig: true,
    settingSources: [],
    mcpServers: { figma: FIGMA },
  });
}

void main();
