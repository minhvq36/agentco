/**
 * The COMPANY-level secrets store. → docs/SPEC-offices.md §5
 *
 * `company/.state/secrets.json` — already in .gitignore, and the one
 * function that exposes a file over HTTP (`ArtifactStore.resolve`) only
 * accepts paths INSIDE `artifacts/`, so `.state/` has no door out at all.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LEAST PRIVILEGE. A role that declares `secrets: [NOTION_TOKEN]` gets ONLY       │
 * │ that key placed into its MCP process's environment. No "just grant everything    │
 * │ for convenience": an agent hit by prompt injection through content it reads       │
 * │ only ever holds the exact keys we handed it, so the cost of a mistake stays       │
 * │ bounded.                                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Secret values NEVER enter a prompt. They're environment variables of an
 * MCP process — the model can't read them, it can only use the tool that's already unlocked.
 */

import fs from 'node:fs';
import path from 'node:path';

import type { CompanyPaths } from './paths.js';
import type { OAuthAccount } from './oauth.js';

export type SecretMap = Record<string, string>;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ AN OAUTH KEY IS **A KIND OF KEY**, NOT A SECOND SYSTEM.                       │
 * │                                                                          │
 * │ A static key is a string; an OAuth key is an object with 4+ fields that            │
 * │ refreshes itself. The temptation is to build it a separate store — and that's      │
 * │ where it breaks: `grantFor`, `injectSecrets`, `armHash`, `role.secrets`,           │
 * │ `secret list` would ALL need a new branch, i.e. **five copies of the same           │
 * │ rule**.                                                                     │
 * │                                                                          │
 * │ Instead: an OAuth account still **has a NAME** like any other key, and             │
 * │ `readSecrets` **flattens** it down to the current `access_token`. All five         │
 * │ places above change zero lines. The only thing OAuth adds is *"this value is        │
 * │ refreshed in the background"* — a matter of LIFECYCLE, not of shape.               │
 * │                                                                          │
 * │ The key's name is `$oauth`, and it **cannot collide** with any key name: a          │
 * │ key name passes through `PLACEHOLDER` = `[A-Z0-9_]+`, no `$`. And the old           │
 * │ `readSecrets` **already** skipped every non-string value ⇒ a company created         │
 * │ with the old version can read the new one and vice versa, no migration needed.       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const OAUTH_KEY = '$oauth';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE APP'S IDENTITY MUST OUTLIVE THE ACCOUNTS IT ISSUES KEYS TO.               │
 * │ (root cause of two dead Notion accounts — traced 27/08)                       │
 * │                                                                          │
 * │ Before: the `client_id` obtained through Dynamic Client Registration (DCR)          │
 * │ lived only in an in-RAM `Map`. Shutting down the daemon lost it ⇒ the next          │
 * │ startup **registered a BRAND NEW app** with the service. Running for a few           │
 * │ days scattered dozens of apps, each holding the keys of one batch of                 │
 * │ accounts, and none of them ever got cleaned up.                                    │
 * │                                                                          │
 * │ The measurement on 27/08 pointed right at it: the two dead accounts shared          │
 * │ ONE old `client_id`, while the live account used the newest `client_id`. Both        │
 * │ clients still exist (`invalid_grant`, not `invalid_client`) ⇒ what got revoked        │
 * │ was **the grant to the old app**, not the key itself.                              │
 * │                                                                          │
 * │ ⇒ The app must be registered **once, and kept forever**. That's also exactly        │
 * │ what the user asked for: *"like a Facebook or Shopee account — you stay             │
 * │ logged in for a year, nobody kicks you out"*. A web session stays alive             │
 * │ because **the app stays put**, only the key rotates. We were doing the              │
 * │ opposite: rotating the app itself.                                                 │
 * │                                                                          │
 * │ The `$clients` key, same file, same atomic write path — **does NOT** spawn a         │
 * │ third store. Same reasoning already written for `$oauth` in the block above.        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const CLIENTS_KEY = '$clients';

/**
 * Every reserved key. Used in **one** place: `writeSecrets` must preserve them all.
 *
 * ⚠ This is the spot that nearly broke a second time. `writeSecrets`
 * rebuilds the whole file from `{...keys, $oauth}` — meaning any reserved
 * key **not named on that exact line** gets silently wiped the next time
 * the user connects any arm at all. Listing it in one place means adding a
 * third key later never requires remembering to edit somewhere else.
 */
const RESERVED = [OAUTH_KEY, CLIENTS_KEY] as const;

/** OAuth accounts keyed by KEY NAME (`NOTION_OAUTH_A1B2C3D4`). → `oauth.ts` */
export type OAuthMap = Record<string, OAuthAccount>;

function readRaw(paths: CompanyPaths): Record<string, unknown> {
  if (!fs.existsSync(paths.secretsFile)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(paths.secretsFile, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as Record<string, unknown>;
  } catch {
    // A broken secrets file must NOT crash the company — whichever agent
    // needs a key will report it as missing on its own.
    process.emitWarning('.state/secrets.json is unreadable; any agent that needs a key will report it missing');
    return {};
  }
}

export function readSecrets(paths: CompanyPaths): SecretMap {
  const raw = readRaw(paths);
  const out: SecretMap = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v;
  }
  /**
   * ⚠ OAUTH OVERRIDES A STATIC KEY OF THE SAME NAME, deliberately, in this exact direction.
   *
   * A real case: the user hand-pastes an access token into
   * `NOTION_ACCESS_TOKEN` today, then clicks Sign in tomorrow. If the
   * static key won, they'd finish signing in and the system would still
   * use the old string **that expired 8 hours ago** — and the symptom is a
   * 401 right after an action that just reported success.
   *
   * This direction is safe because OAuth is something with a LIFECYCLE: it
   * refreshes itself, while a hand-pasted string just sits there waiting to die.
   */
  for (const [name, acc] of Object.entries(readOAuth(paths))) {
    if (acc.access_token) out[name] = acc.access_token;
  }
  return out;
}

/** Just the OAuth portion — for the background refresh loop and for the interface's account listing. */
export function readOAuth(paths: CompanyPaths): OAuthMap {
  const bag = readRaw(paths)[OAUTH_KEY];
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return {};
  const out: OAuthMap = {};
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    // Must have at least `access_token` — skip a half-broken record rather
    // than letting it flatten to `undefined` and end up on the server as `Bearer `.
    if (v && typeof v === 'object' && typeof (v as OAuthAccount).access_token === 'string') {
      out[k] = v as OAuthAccount;
    }
  }
  return out;
}

/**
 * Writes/deletes ONE OAuth account. Read-modify-write the whole file, never
 * overwrites the entire store.
 *
 * ⚠ RE-READS FROM DISK RIGHT BEFORE WRITING, never uses a copy already held
 * in hand. The background refresh loop and the user clicking "Sign in" can
 * run at the same time; writing from a stale snapshot would wipe out a key
 * the other one just saved — and losing a `refresh_token` that has already
 * ROTATED can't be recovered by anything short of signing in again.
 */
export function saveOAuth(paths: CompanyPaths, name: string, acc: OAuthAccount | null): void {
  const raw = readRaw(paths);
  const bag = { ...(readOAuth(paths) as Record<string, unknown>) };
  if (acc) bag[name] = acc;
  else delete bag[name];
  writeRaw(paths, { ...raw, [OAUTH_KEY]: bag });
}

/**
 * A registered `client_id`, keyed by `issuer|redirect_uri`. → `$clients`
 *
 * ⚠ The key must include `redirect_uri`: DCR issues a `client_id` **for the
 * exact registered URI**. Changing the daemon's port and reusing the old
 * client ⇒ `invalid_redirect_uri`, and that error message never states the real cause.
 *
 * ⚠ `client_id` is **not a secret** (a public client,
 * `token_endpoint_auth_method: none`). It lives here because this is where
 * **company-owned** data lives, not because it needs to be hidden.
 */
export function readClients(paths: CompanyPaths): Record<string, string> {
  const bag = readRaw(paths)[CLIENTS_KEY];
  if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bag as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[k] = v;
  }
  return out;
}

/**
 * `null` = **DELETE** the entry, not write an empty string.
 *
 * Needed for the *"use your own client_id"* field: clearing the field means
 * **falling back to agentco's own client**, and the only way to express
 * that is for the entry to disappear. Writing `''` would make
 * `deviceClientId` read back an empty string and send that to the vendor.
 */
export function saveClient(paths: CompanyPaths, key: string, clientId: string | null): void {
  const raw = readRaw(paths);
  const next = { ...readClients(paths) };
  if (clientId === null) delete next[key];
  else next[key] = clientId;
  writeRaw(paths, { ...raw, [CLIENTS_KEY]: next });
}

export function writeSecrets(paths: CompanyPaths, map: SecretMap): void {
  /**
   * ⚠ TWO TRAPS HERE, AND BOTH COME FROM THE SAME EXISTING LINE: `addArm`
   * calls `writeSecrets({ ...readSecrets(pp), ...secrets })`.
   *
   * ① Not preserving `$oauth` ⇒ connecting any arm at all **wipes out every
   *    signed-in account**. Losing a `refresh_token` that has rotated leaves
   *    no way back except signing in again from scratch.
   *
   * ② `readSecrets` now FLATTENS access_token into the map ⇒ writing that
   *    map straight back down would bake a **static copy** of a key that's
   *    meant to refresh itself. That copy dies after 8 hours and sits in
   *    the file as a plain string — harmless today (OAuth wins on read) but
   *    a landmine for anyone reading the file and mistaking it for the real key.
   */
  /**
   * ③ 🔴 AND EVERY OTHER RESERVED KEY MUST ALSO SURVIVE — not just `$oauth`.
   *
   * The earlier version named `$oauth` explicitly on the very line that
   * rebuilds the file, so the **second** reserved key (`$clients`) would
   * get silently wiped the next time an arm gets connected — and losing
   * `$clients` means the next sign-in registers a new app, recreating
   * **exactly the bug just traced**. Preserved via the LIST (`RESERVED`), not by hand-typed name.
   */
  const raw = readRaw(paths);
  const oauth = readOAuth(paths);
  const flat: SecretMap = {};
  for (const [k, v] of Object.entries(map)) if (!(k in oauth)) flat[k] = v;
  const keep: Record<string, unknown> = {};
  for (const k of RESERVED) if (raw[k] && Object.keys(raw[k] as object).length) keep[k] = raw[k];
  writeRaw(paths, { ...flat, ...keep, ...(Object.keys(oauth).length ? { [OAUTH_KEY]: oauth } : {}) });
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 ATOMIC WRITE — because losing half a file here means losing **THE ENTIRE       │
 * │ KEY STORE**. (the user, 26/08: *"this race condition is that dangerous?              │
 * │ let's patch it"*)                                                            │
 * │                                                                          │
 * │ `writeFileSync` **truncates the file to 0 bytes first, then writes**. Dying         │
 * │ between those two steps (daemon killed · power loss · disk full) leaves a          │
 * │ truncated JSON file ⇒ `readRaw` fails to parse ⇒ `catch` returns `{}` ⇒            │
 * │ **every account vanishes**, not just the one being written. The user has to         │
 * │ sign back into EVERYTHING.                                                    │
 * │                                                                          │
 * │ And it's twice as expensive because the most frequently run write path is the       │
 * │ **key refresh loop** — running in the background, every 15 minutes, when no          │
 * │ one is watching.                                                              │
 * │                                                                          │
 * │ Write to a temp file, then `rename`: on the same drive, `rename` is an **atomic**    │
 * │ OS operation. At every moment, the real file is either the OLD version intact,       │
 * │ or the NEW version intact — there's no third state.                                 │
 * │                                                                          │
 * │ ⚠ `fsync` BEFORE renaming, not after. A rename is atomic at the directory level,      │
 * │ but it makes no promise that the CONTENT has hit disk — a power loss could leave       │
 * │ a new file name pointing at an empty block.                                        │
 * │                                                                          │
 * │ ⚠⚠ AND HERE IS WHAT IT **CANNOT** SAVE, stated plainly: if the process dies             │
 * │ AFTER Notion has already rotated the key but BEFORE we write it, the new key           │
 * │ lives inside an HTTP response that's now lost — no storage mechanism can recover        │
 * │ it. That window is a few microseconds and costs at most ONE account. The way out         │
 * │ is `needs_login`.                                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
function writeRaw(paths: CompanyPaths, obj: Record<string, unknown>): void {
  const dir = path.dirname(paths.secretsFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.secrets.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  /**
   * ⚠ Permissions are set on the TEMP FILE, before renaming — not after.
   *
   * After a rename, there's a brief moment where the real file sits there
   * with default permissions, and on a multi-user machine that moment is
   * enough. On POSIX: only the owner can read it. On Windows `chmod` is a
   * no-op, and the user's own directory ACL is already sufficient.
   */
  try {
    fs.chmodSync(tmp, 0o600);
  } catch {
    /* couldn't set permissions — fine, move on */
  }
  // Atomic: after this line, the real file is the new version OR the old one, never in between.
  fs.renameSync(tmp, paths.secretsFile);
}

/**
 * Grants only the keys this role declares. Any missing key has its name returned.
 *
 * ⚠ AN EMPTY STRING = MISSING, not "present but empty". A blank input field
 * submits `''`, and treating that as a valid key means `Bearer ` gets sent
 * to the server and comes back 401 — meaning the user gets told *"wrong
 * key"* for having **never filled one in**. Every function that asks "is
 * there a key yet" has to return the same answer, or two spots in the same
 * flow believe two different things. → §missingSecretRefs
 */
export function grantFor(
  all: SecretMap,
  wanted: readonly string[],
): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of wanted) {
    const value = all[name];
    if (value === undefined || value === '') missing.push(name);
    else env[name] = value;
  }
  return { env, missing };
}

/** NAMES only, never values — used by the interface and logs. */
export function secretNames(paths: CompanyPaths): string[] {
  return Object.keys(readSecrets(paths)).sort();
}

/** The one place that knows the placeholder syntax. Change it here and it changes everywhere. */
const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g;

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴🔴 FILLS PLACEHOLDERS **EVERYWHERE** IN THE CONFIG — not just `headers`.       │
 * │ (bug the user caught, 31/08, test 20 step B)                                 │
 * │                                                                          │
 * │ A real case: pasting a README block with `env: { MEMORY_FILE_PATH:                 │
 * │ "${MEMORY_PATH}" }`, the interface **generates the correct field** `MEMORY_PATH`,    │
 * │ the user fills in `abcde` → still *"Missing key: MEMORY_PATH"*. Refilling it            │
 * │ over and over changes nothing.                                                   │
 * │                                                                          │
 * │ ⚠⚠ THE CAUSE IS AN ASYMMETRY BETWEEN TWO FUNCTIONS SHARING ONE PATH:               │
 * │                                                                          │
 * │   `missingSecretRefs`  scans **the entire config** (JSON.stringify)  ← detects       │
 * │   `injectSecrets`      only substitutes inside HTTP's **`headers`**  ← fills          │
 * │                                                                          │
 * │ The stdio branch never substitutes placeholders at all — it only **merges keys        │
 * │ into `env` BY NAME** (correct for a catalog entry: the vendor's server reads           │
 * │ `process.env.NOTION_TOKEN` directly). So every placeholder outside `headers`            │
 * │ gets **detected forever, never filled** ⇒ an infinite loop, with the error               │
 * │ message pointing at the exact field the user JUST FILLED IN. The worst kind of           │
 * │ wrong-door error: it accuses something that's actually correct.                        │
 * │                                                                          │
 * │ The comment at `missingSecretRefs` had already predicted this exact day — *"a           │
 * │ function that only looks at `headers` will be correct right up until the day             │
 * │ someone writes `url: 'https://${HOST}/mcp'`"*. It only guessed the wrong SPOT:            │
 * │ stdio's `env` got there first, arriving through path B — the path a catalog              │
 * │ entry can't shield against.                                                        │
 * │                                                                          │
 * │ ⇒ **THE INVARIANT THAT MUST HOLD: the FILLING function's scope = the CHECKING            │
 * │ function's scope.** The slightest mismatch produces a placeholder nobody can              │
 * │ ever fill. There's a test guarding this.                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * A placeholder with no matching key is **left as-is** and recorded in
 * `missing` — so `missingSecretRefs` downstream still catches it and
 * reports the correct *"missing key"* message.
 */
function fillRefs<T>(node: T, keys: Record<string, string>, missing: Set<string>): T {
  if (typeof node === 'string') {
    return node.replace(PLACEHOLDER, (whole, name: string) => {
      const v = keys[name];
      if (v === undefined) {
        missing.add(name);
        return whole;
      }
      return v;
    }) as T;
  }
  if (Array.isArray(node)) return node.map((v) => fillRefs(v, keys, missing)) as T;
  /**
   * ⚠ Only walks into PLAIN objects. A `McpSdkServerConfigWithInstance`
   * carrying `instance` is a live object (`McpServer`) — recursing into it
   * would crawl through an entire SDK object tree and rebuild a dead copy
   * of it. The calling branch already gates on `command`/`url`, but this
   * function has to be safe on its own: it's recursive, and whoever edits
   * it later will call it from a third call site.
   */
  if (node && typeof node === 'object' && Object.getPrototypeOf(node) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = fillRefs(v, keys, missing);
    return out as T;
  }
  return node;
}

/**
 * The PATH placeholder — filled in with `<office>/.state/browser` at spawn time.
 *
 * ⚠ Angle brackets, not `${…}`, and that's **deliberate**: two syntaxes, two
 * meanings, two fill paths. `missingSecretRefs()` scans for `${…}` to find
 * missing keys — a path placeholder that slipped into that net would report
 * *"Missing key: OFFICE_STATE"*, a **wrong-door error message** produced by
 * the exact mechanism built to avoid wrong-door error messages.
 *
 * Exported so `catalog.ts` uses this exact same string — two copies of one
 * constant is something that has already burned this project once (`agentSlot` vs `arrange`).
 */
export const OFFICE_STATE = '<OFFICE_STATE>';

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHICHEVER PLACEHOLDERS STILL REMAIN AFTER INJECTION — i.e. MISSING KEYS.        │
 * │ (bug reported by the user, 25/08)                                          │
 * │                                                                          │
 * │ The symptom the user reported, and it's the RIGHT question:                     │
 * │                                                                          │
 * │   *"a wrong key on a fresh connect → 401. But a MISSING key (left blank)              │
 * │    reports the exact same message? Where am I misunderstanding this"*                │
 * │                                                                          │
 * │ There's no misunderstanding at all — **we reported it wrong**. Three entirely           │
 * │ different causes all land on the exact same Notion 401:                              │
 * │                                                                          │
 * │   ① a genuinely wrong key    → `Bearer ntn_xxx`      → 401  ✔ correct message           │
 * │   ② left blank               → `Bearer ${NOTION_…}`  → 401  ✘ wrong door                │
 * │   ③ reused in a different office → `Bearer ${NOTION_…}`  → 401  ✘ wrong door             │
 * │                                                                          │
 * │ We KNOW ② and ③ BEFORE sending. `injectSecrets` already leaves the placeholder          │
 * │ as-is and calls `emitWarning` — but that warning goes to the daemon's stderr,           │
 * │ while the user is looking at the screen. And then we **still send** the header           │
 * │ containing `${…}`.                                                             │
 * │                                                                          │
 * │ ⇒ Don't send a request we already know for certain will 401. A WRONG-DOOR error         │
 * │ message costs more than no error message at all: the user goes and checks their          │
 * │ account, checks permissions, checks the workspace — everywhere except the actual          │
 * │ broken spot. → SPEC-arms §5m ②                                                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Scanned across the JSON string of the ENTIRE config, not just `headers`:
 * `args`, `env`, `url` can all carry a placeholder, and a function that
 * only looks at `headers` will be correct right up until the day someone
 * writes `url: 'https://${HOST}/mcp'`.
 */
export function missingSecretRefs(config: unknown): string[] {
  const seen = new Set<string>();
  for (const m of JSON.stringify(config ?? null).matchAll(PLACEHOLDER)) seen.add(m[1]!);
  return [...seen].sort();
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ INJECTS KEYS INTO AN MCP CONFIG — ONE FUNCTION, TWO CALL SITES. → SPEC-arms §5a  │
 * │ (as of 29/08 it also fills in **path placeholders** — see the `dirs` parameter)   │
 * │                                                                          │
 * │ 🔴 A HOLE BEING PATCHED: up to 25/08, keys **only** went into servers with a       │
 * │ `command` (injected via `env`). `http`/`sse` servers received **nothing at         │
 * │ all** — so the first HTTP arm would run WITH NO KEY and nobody would know why.      │
 * │                                                                          │
 * │ ⚠ AND THIS IS WHY IT HAS TO BE ONE SHARED FUNCTION, NOT TWO SEPARATE PATCHES:       │
 * │ `pickMcp` (at runtime) and `probeArm` (the "Try it" button) **must inject exactly    │
 * │ the same way**. The slightest mismatch means the Try button tests something          │
 * │ different from what will actually run — reports ✓ and then breaks the first time     │
 * │ a worker uses it. `server.ts` already stated this invariant in words; this           │
 * │ function turns it into **structure**.                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Two paths, chosen by the config's shape, not by vendor name:
 *
 *   has `command`  → merged into `env`      (as before, unchanged behavior)
 *   has `url`      → substitutes the `${KEY_NAME}` placeholder inside `headers`
 *
 * Why a placeholder instead of a separate `inject` field: it's **data**,
 * sitting right inside `company.yaml` where the user can read it — they
 * SEE exactly where the key goes. It also just works for configs the user
 * **pastes in themselves** (path B), with no need for us to know the
 * vendor ahead of time. Same reasoning as §5h·1: *a catalog is data, not code*.
 *
 *     headers: { Authorization: 'Bearer ${NOTION_ACCESS_TOKEN}' }
 *
 * ⚠ Only substitutes with keys the role was actually GRANTED (`grantFor`
 * filters beforehand). A placeholder with no matching key is **left as-is,
 * with a warning** — never send the literal string `${NAME}` to a server as
 * if it were a real token: the server would return 401, and that error
 * message would point at "wrong key" instead of "missing key" — the wrong door to go looking at.
 */
export function injectSecrets<T>(
  config: T,
  env: Record<string, string>,
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE SECOND PLACEHOLDER: A PATH. And it lives here for a reason about the HASH.  │
   * │ (the user's call, 29/08: *"where the data lives shouldn't affect the hash at        │
   * │ all"*)                                                                       │
   * │                                                                          │
   * │ Where data is stored is **not part of an arm's identity**. Baking an absolute        │
   * │ path into `args` bakes it into the hash, in exchange for two broken outcomes:        │
   * │   · the same catalog entry connected in two offices ⇒ two different hashes ⇒          │
   * │     two different arms, even though a catalog entry is **the blueprint** and an        │
   * │     office is just a clone of it;                                                   │
   * │   · **moving the company directory ⇒ EVERY hash changes** ⇒ the directory can no       │
   * │     longer be moved at all.                                                        │
   * │                                                                          │
   * │ ⇒ The registry holds a **placeholder**, and the real path only exists at spawn         │
   * │ time — exactly how **key values** have been handled since 25/08 (keys never enter       │
   * │ the hash).                                                                       │
   * │                                                                          │
   * │ ⚠ DELIBERATELY NOT using `${…}` syntax: in this project that syntax has exactly         │
   * │ one meaning, **the name of a key**, and `missingSecretRefs()` scans for it.             │
   * │ Borrowing it would self-produce the message *"Missing key: OFFICE_STATE"* — a           │
   * │ wrong-door error message.                                                          │
   * │                                                                          │
   * │ ⚠ And it lives in the SAME function as key injection, not a second function:            │
   * │ `pickMcp` and `probeArm` must fill it in **exactly the same way**, or the Try           │
   * │ button would test something different from what will actually run — the exact          │
   * │ invariant stated in the comment block above.                                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  dirs?: { officeState: string },
): T {
  if (!config || typeof config !== 'object') return config;
  const cfg = config as Record<string, unknown>;

  // An empty key isn't a key — same rule as `grantFor`. Filtered ONCE here
  // so both branches below see the same fact.
  const keys = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

  if (typeof cfg['command'] === 'string') {
    /**
     * Fills in the path placeholder FIRST, and makes it independent from
     * keys: an arm might need a path with **no key at all** (a browser
     * entry is exactly this case). Folding it into the `if
     * (!keys.length) return` branch would make it silently not run.
     */
    /**
     * ⚠ `path.normalize` AFTER substitution — and only on strings THAT CONTAIN the placeholder.
     *
     * The catalog writes `<OFFICE_STATE>/profile` using `/` (it's data, and
     * must read identically on every machine), while `officeState` is a
     * path from the OS **currently running**. Concatenating them directly
     * gives `D:\…\browser/profile` — mixed separators. Windows tolerates
     * it, but that string leaks into everywhere else: error messages,
     * audit logs, and every path comparison afterward. The **sixth** hit
     * of the *"correct on the dev machine, wrong somewhere else"* failure
     * class (OS-specific shell names · non-Latin slugs · the remote 📂
     * button · Docker path mapping · shell quoting).
     *
     * Only a string containing the placeholder gets normalized:
     * `--output-max-size 52428800` run through `normalize` becomes
     * `52428800` (luckily unchanged) — but a different flag might not be
     * so lucky. Don't touch anything that isn't a path.
     */
    const args =
      dirs && Array.isArray(cfg['args'])
        ? (cfg['args'] as unknown[]).map((a) =>
            typeof a === 'string' && a.includes(OFFICE_STATE)
              ? path.normalize(a.split(OFFICE_STATE).join(dirs.officeState))
              : a,
          )
        : cfg['args'];
    const withArgs = args === cfg['args'] ? cfg : { ...cfg, args };
    if (!Object.keys(keys).length) return withArgs as T;

    /**
     * ⭐ FILLS PLACEHOLDERS FIRST, MERGES BY NAME SECOND — two mechanisms, both needed.
     * (patched 31/08, see the comment block at `fillRefs`)
     *
     *   fill placeholders  `env: { MEMORY_FILE_PATH: "${MEMORY_PATH}" }`  ← path B,
     *                      the user pastes in a vendor's README
     *   merge by name       the server reads `process.env.NOTION_TOKEN` directly  ← a catalog entry
     *
     * Dropping the second half breaks every stdio catalog entry; dropping
     * the first half is the exact bug just caught. Merging happens after
     * substitution, so a key that just got substituted elsewhere is still
     * present in `env` under its original name — an extra unused variable, and harmless.
     */
    const gone = new Set<string>();
    const filled = fillRefs(withArgs as Record<string, unknown>, keys, gone);
    warnMissing(gone, 'the process will run with an unfilled placeholder.');
    return { ...filled, env: { ...((filled['env'] as object) ?? {}), ...keys } } as T;
  }

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE THIRD BRANCH: A CLI DECLARATION. → SPEC-arms §16                          │
   * │                                                                          │
   * │ It has neither `command` nor `url` at the top level — keys live inside              │
   * │ `actions[].env`. Missing this branch means it **falls through both `if`s and         │
   * │ returns unchanged**: placeholders never get filled, while `missingSecretRefs`         │
   * │ (which scans the whole config) keeps flagging it forever. The exact 31/08 bug,        │
   * │ same shape, just a different location.                                           │
   * │                                                                          │
   * │ ⇒ **INVARIANT: the FILLING function's scope = the CHECKING function's scope.**       │
   * │ There's a test guarding this.                                                     │
   * │                                                                          │
   * │ ⚠ ONLY fills placeholders, does NOT merge `keys` into one shared `env`: an           │
   * │ action must only ever see the exact key it declared. Merging by name (the stdio         │
   * │ branch) is correct for a catalog entry — the vendor's own server reads                  │
   * │ `process.env.NOTION_TOKEN` directly — but here the child process is the                 │
   * │ CUSTOMER's own binary, and pouring the company's entire bundle of keys into its           │
   * │ env would reopen exactly the §5d hole that was just closed at real cost.                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  if (cfg['type'] === 'cli') {
    const gone = new Set<string>();
    const filled = fillRefs(cfg, keys, gone);
    warnMissing(gone, 'the command will run with an unfilled placeholder.');
    return filled as T;
  }

  if (typeof cfg['url'] === 'string') {
    const missing = new Set<string>();
    const filled = fillRefs(cfg, keys, missing);
    warnMissing(missing, 'the server will answer 401.');
    const headers = filled['headers'];
    if (!headers || typeof headers !== 'object') return filled as T;
    /**
     * ⚠ FORCES HEADERS TO STRINGS — preserves the existing behavior. A
     * numeric header (`{N: 5}`) passed straight down to the SDK becomes a
     * type-mismatched field at the very bottom, and the error there would
     * say nothing about the config the user just pasted. There's a test guarding this.
     */
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      out[k] = typeof v === 'string' ? v : String(v);
    }
    return { ...filled, headers: out } as T;
  }

  return config;
}

/**
 * NAME, never VALUE — the same rule as everywhere else in this file.
 *
 * ⚠ The two-sentence rule from `worker.ts §pickMcp`: a name shaped like
 * `*_OAUTH_xxxxxxxx` is a SIGNED-IN ACCOUNT, with no string to type in at
 * all. Telling someone to `secret set` it points at the wrong door.
 * Recognized purely by the shape of the name — never guessed.
 */
function warnMissing(names: Set<string>, consequence: string): void {
  if (!names.size) return;
  process.emitWarning(
    `connection is missing key(s) ${[...names].join(', ')} — ${consequence} ` +
      `A name shaped \`*_OAUTH_xxxxxxxx\` is a sign-in account (reconnect it in the Connections ` +
      `dialog); any other name is added with \`agentco secret set <NAME>\`. Do not go looking ` +
      `on the server side.`,
  );
}
