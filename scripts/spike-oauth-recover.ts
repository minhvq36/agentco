/**
 * SPIKE — IS THE `dead` FLAG CORRECT? And if it's wrong, CAN WE RECOVER?
 * → `core/oauth.ts §DeadGrantError` · `server/oauth-routes.ts §refreshDue`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE QUESTION NOBODY'S ASKED YET: when we write `dead`, are we recording  │
 * │ a FACT about Notion's side, or a CONCLUSION we made up ourselves?        │
 * │                                                                          │
 * │ That flag has a one-way consequence: `needsRefresh` returns `false`      │
 * │ once it sees `dead` ⇒ **never retried again**. So one wrong label means  │
 * │ a permanently dead account, even if the key on disk still works.         │
 * │                                                                          │
 * │ This script knocks directly on Notion's door using the EXACT key         │
 * │ currently on disk:                                                      │
 * │   · 200 ⇒ the flag was WRONG, and we just recovered the account         │
 * │     (write the new key, clear the flag)                                 │
 * │   · invalid_grant ⇒ the flag was RIGHT, the key is really dead, must     │
 * │     log in again                                                        │
 * │                                                                          │
 * │ ⚠ There is NO "read-only" mode. The only way to know if a refresh token  │
 * │ is still alive is to USE it, and Notion ROTATES tokens — using it kills  │
 * │ the old key and a new one must be written back. So this script          │
 * │ **always writes** on success, and writes through `saveOAuth`            │
 * │ (atomic: temp → fsync → rename).                                        │
 * │                                                                          │
 * │ Run:  npx tsx scripts/spike-oauth-recover.ts [--all]                     │
 * │       (by default only tries accounts flagged `dead`; `--all` tries     │
 * │       every account)                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discover, refreshAccount, DeadGrantError, TransientError } from '../dist/core/oauth.js';
import { companyPaths } from '../dist/core/paths.js';
import { readOAuth, saveOAuth } from '../dist/core/secrets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMPANY = path.join(HERE, '..', 'company');

const mask = (v?: string): string => (v ? `${v.slice(0, 6)}…${v.slice(-4)}` : '—');

async function main(): Promise<void> {
  const all = process.argv.includes('--all');
  const paths = companyPaths(COMPANY);
  const store = readOAuth(paths);
  const names = Object.keys(store).filter((n) => all || store[n]?.dead);

  if (!names.length) {
    console.log('\nNo accounts flagged `dead`. (Use --all to try every account.)\n');
    return;
  }

  console.log(`\n━━ ATTEMPTING RECOVERY for ${names.length} account(s)\n`);

  for (const name of names) {
    const acc = store[name]!;
    console.log(`── ${acc.label ?? name}`);
    console.log(`   dead flag        ${acc.dead ? `YES · ${acc.dead.at} · ${acc.dead.why}` : 'no'}`);
    console.log(`   refresh on disk  ${mask(acc.refresh_token)}`);

    if (!acc.refresh_token) {
      console.log('   ⇒ 🔴 no refresh token at all — re-login is the only path.\n');
      continue;
    }

    try {
      const meta = await discover(acc.mcp_url);
      if (!meta) {
        console.log('   ⇒ ⚠ server no longer requires a token (?), skipping.\n');
        continue;
      }
      const next = await refreshAccount(meta, acc);
      /**
       * ⚠ EXPLICITLY CLEAR THE FLAG. `refreshAccount` merges from `acc`, and
       * `applyToken` doesn't carry `dead` forward — but relying on another
       * function *incidentally* dropping a field is relying on luck. Clear
       * it here, where we know why.
       */
      const { dead: _bo, ...clean } = next as typeof next & { dead?: unknown };
      saveOAuth(paths, name, clean as typeof next);
      console.log(`   ⇒ 🟢 RECOVERED — new key ${mask(clean.access_token)}, dead flag cleared.`);
      console.log(
        `      refresh token ROTATED: ${next.refresh_token !== acc.refresh_token ? 'YES' : 'no'}\n`,
      );
    } catch (e) {
      if (e instanceof DeadGrantError) {
        console.log(`   ⇒ 🔴 REALLY DEAD — Notion rejected this exact key. ${e.message}\n`);
      } else if (e instanceof TransientError) {
        console.log(`   ⇒ ⚠ TEMPORARY failure (network/service) — can't conclude yet. ${e.message}\n`);
      } else {
        console.log(`   ⇒ ❓ ${(e as Error).message}\n`);
      }
    }
  }
}

main().catch((e) => {
  console.error(`\n🔴 ${(e as Error).message}\n`);
  process.exit(1);
});
