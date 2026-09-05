import { createHash } from 'node:crypto';

// One constant, declared in one place. `secrets.ts` is where the placeholder
// gets FILLED IN, so it's also where the string lives — this file just
// borrows it. Safe import direction: `secrets.ts` imports nothing from here
// (only `paths` + `oauth`, both types).
import { OFFICE_STATE } from './secrets.js';
import { t, type MessageKey } from '../i18n/index.js';

/**
 * THE ARM CATALOG — what a user can "pull off the shelf and use right away".
 * → docs/SPEC-arms.md §4e · §5c · §5h·1 · §11c
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THIS IS DATA, NOT A FEATURE.                                             │
 * │                                                                          │
 * │ A catalog entry = **path B (paste an MCP config) with the form            │
 * │ pre-filled**. Same `McpServerConfig`, same execution path, same             │
 * │ `probeArm`. Different in exactly one way: WHO FILLS THE FORM. ⇒ the           │
 * │ catalog can't do anything path B can't do, and adding an entry means            │
 * │ adding one object below — not writing code.                              │
 * │                                                                          │
 * │ ⚠ CRITERION 5 (§4d): an entry WE HAVEN'T RUN OURSELVES END-TO-END must         │
 * │ NOT appear. A broken entry is worse than no entry, because it spends            │
 * │ TRUST — the most expensive thing to a non-technical user. So today it's           │
 * │ exactly ONE entry, and v1's remaining three (Notion · GitHub · Google)            │
 * │ join it once each one actually, genuinely works. The user is NOT blocked          │
 * │ while waiting: path B accepts every other server.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** The subtitle on the card states THE COST — a user chooses by effort, not by name. */
export type ArmPrice = 'none' | 'keys' | 'login';

/**
 * How to build an MCP config — **pure data**, no functions, no provider names.
 *
 * Exactly two shapes, because the protocol has exactly two (§2: stdio +
 * Streamable HTTP; SSE is accepted for compatibility but **never
 * recommended**, so it has no place here — anyone who needs it pastes a
 * config by hand via path B).
 */
export type ArmSpec =
  | {
      kind: 'stdio';
      command: string;
      args: string[];
      /**
       * Appends the user-selected directory list to the end of `args`.
       *
       * This is the **entire** "customize per provider" job the old `build`
       * function existed to do — one boolean flag. Worth remembering when
       * someone wants to bring functions back.
       */
      appendFolders?: boolean;
      /**
       * ┌──────────────────────────────────────────────────────────────────────┐
       * │ ARGUMENTS THAT DIFFER BY OS — and it's really a DISK SPACE issue.        │
       * │                                                                      │
       * │ The case that created this (measured 08/29): Playwright with no          │
       * │ browser declared uses a **bundled build** — `chromium_headless_shell`     │
       * │ **269 MB**, the full one **415 MB**, and **an old one is never                │
       * │ auto-cleaned** (the measuring machine had 1,340 MB — two builds from            │
       * │ 04/2026 + 07/2026 sitting side by side). Declaring a **channel**                │
       * │ (`msedge`/`chrome`) uses a browser **already installed**: 0 bytes.             │
       * │                                                                      │
       * │ But the correct channel name differs by OS ⇒ a static `args` array          │
       * │ can't express that. This is the field for it, and it's **generic** —          │
       * │ no provider name lives in this type.                                    │
       * │                                                                      │
       * │ ⚠ AND IT GOES INTO THE HASH. Moving a company from Windows to macOS ⇒          │
       * │ different args ⇒ different hash ⇒ **re-plug it in**. This matches the          │
       * │ "lifecycle has two verbs" rule, and it's also a fact: it's a different          │
       * │ browser on a different machine.                                         │
       * └──────────────────────────────────────────────────────────────────────┘
       */
      argsByOs?: Readonly<Record<string, readonly string[]>>;
    }
  | {
      kind: 'http';
      url: string;
      /**
       * The `${CREDENTIAL_NAME}` placeholder gets replaced by `injectSecrets`
       * when the server is built. → `core/secrets.ts`. The string here is what
       * the user CAN READ in `company.yaml`; the real value never lives in
       * this file.
       */
      headers?: Record<string, string>;
      /**
       * The name of the header carrying the LIST OF CHECKED TOOL GROUPS.
       * → §5h·7e
       *
       * ⚠ DELIBERATELY NOT using a `${TOOLSETS}` placeholder: `${…}` syntax in
       * this project has exactly one meaning — **a credential name** — and
       * `missingSecretRefs()` scans the whole config to find any leftover
       * placeholder. Borrowing that syntax for something that isn't a
       * credential would produce *"Missing credential: TOOLSETS"*, a
       * **wrong-door** error message born right inside the patch for
       * wrong-door errors. `buildConfig` writes the real value straight in
       * here.
       */
      toolsetHeader?: string;
      /**
       * Header added at the **read-only** tier — a gate built by the SERVER
       * ITSELF.
       *
       * Measured 08/26 (§5h·7j): calling `create_or_update_file` through the
       * read-only door gets rejected at the **protocol layer**
       * (`-32602 unknown tool`), not "the tool ran and returned an error".
       * That's the difference between **a list** and **a gate**, and this
       * gate sits beyond the reach of anything running on the client machine.
       *
       * ⚠ Does NOT replace filtering `allowedTools` on our side — two shields
       * at different layers, use both. A provider without one just leaves it
       * blank, and the `read` tier still runs on our own layer as before.
       */
      readOnlyHeaders?: Record<string, string>;
      /**
       * An alternate URL for the **read-only** tier — the same job as
       * `readOnlyHeaders`, a different mechanism: the provider cuts by
       * ADDRESS instead of by header.
       *
       * Measured 08/29 (Linear): `…/mcp` **57 tools ≈19,811 tokens** ·
       * `…/mcp/readonly` **35 tools ≈8,544** — cuts exactly 22 write tools,
       * **loses not one read tool**, ≈11,267 tokens cheaper per turn.
       *
       * ⚠⚠ ADDING THIS FIELD MEANS UPDATING `serverFenced()` — it sits at the
       * END OF THE FILE, not next to this, and forgetting it rebuilds the
       * 08/27 bug exactly (the tier selector never shows up, the user gets
       * permanently locked at the lowest tier, **with no error message at
       * all**). Full reasoning in `serverFenced`'s comment block.
       *
       * 📌 An accidental bonus, not a deliberate one: the URL goes into
       * `armHash`, so the read tier and the write tier **automatically**
       * become two arms with two hashes — something the cut-by-header
       * version can only get by relying on `level` inside the hash.
       */
      readOnlyUrl?: string;
      /**
       * The `scope` requested at the Consent screen. Not declared ⇒ **sends no
       * parameter at all**, the exact behavior as always (Notion · GitHub
       * unchanged, not one byte).
       *
       * 🔴 Exists because *"let the provider decide"* was an unmeasured
       * assumption. Notion declares exactly **one** scope (`default`), so
       * being absent is harmless; Linear declares **four**
       * (`read` · `write` · `openid` · `email`) and we **don't know** which
       * one it grants by default. And this entry's permission tier is read
       * from the credential, so an unknown scope is an unknown gate.
       *
       * ⚠ REQUEST **WIDE** HERE, never narrow — even when the user is about to
       * choose the read-only tier. Scope gets locked in at the Consent click,
       * which is **before** they ever see the tier selector; requesting
       * narrow would lock the door before anyone knows it exists, and
       * `offeredTiers` would collapse to exactly one tier. Measured 08/29,
       * rebuilding the exact same case. Narrowing is the SAVE step's job.
       * → `serverFenced` · SESSIONS_MEMORY §5x
       */
      authScope?: string;
    };

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE SPECIAL PLACEHOLDER `${OAUTH}` — WHERE "THIS ARM'S OWN ACCOUNT" GOES.     │
 * │                                                                          │
 * │ The catalog is **static data**, while an OAuth credential name is                │
 * │ **generated at login time** (`NOTION_OAUTH_<8 hex workspace_id>` — see            │
 * │ `oauth.ts §accountName`). The two only meet in one place: a catalog                │
 * │ entry writes a **placeholder with a conventional name**, and `buildConfig`          │
 * │ fills in the real account name at plug-in time.                              │
 * │                                                                          │
 * │ Why not have the catalog write `${NOTION_ACCESS_TOKEN}` directly as before:         │
 * │ **two Notion workspaces would share the same credential name ⇒ share the             │
 * │ same hash ⇒ merge into one arm.** §6i warned about exactly this case                 │
 * │ since 08/23.                                                             │
 * │                                                                          │
 * │ Once substituted, the string in `company.yaml` is a NORMAL placeholder            │
 * │ (`${NOTION_OAUTH_A1B2C3D4}`) — `injectSecrets` doesn't need to know OAuth            │
 * │ exists at all. One convention in exactly one function, 0 new branches                │
 * │ downstream.                                                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const OAUTH_SLOT = '${OAUTH}';

/** ONE build function for every entry. Adding a provider = adding data, not a branch. */
export function buildConfig(
  spec: ArmSpec,
  input: {
    folders: string[];
    account?: string;
    groups?: string[];
    level?: string;
    /**
     * The OS currently running — a parameter rather than reading
     * `process.platform` directly, so a test can build configs for **all
     * three OSes** on one machine. The exact rule stepped on five times
     * already: *"correct on the dev machine, wrong somewhere else"*.
     */
    platform?: string;
    /**
     * The mode the user chose — **already resolved** into an object, not an
     * id.
     *
     * Resolved at the call site (which knows the catalog entry and knows
     * where the request came from) rather than here, because the
     * `loopbackOnly` gate needs the **socket address** — something a config
     * builder must never know about. A pure function has to receive the
     * result of a decision, not go fetch facts to make its own.
     */
    options?: readonly ArmOption[];
  },
): Record<string, unknown> {
  if (spec.kind === 'http') {
    let headers = spec.headers;
    if (headers && input.account) {
      const slot = `\${${input.account}}`;
      headers = Object.fromEntries(
        Object.entries(headers).map(([k, v]) => [k, v.split(OAUTH_SLOT).join(slot)]),
      );
    }
    /**
     * Tool groups → one header. **SORTED** before joining, because this
     * string feeds into `armHash`: checking the same three groups in two
     * different orders producing two different hashes would immediately
     * break the rule *"same config ⇒ same arm"*. Same reason `armHash` sorts
     * JSON keys before hashing.
     */
    if (spec.toolsetHeader && input.groups?.length) {
      headers = { ...(headers ?? {}), [spec.toolsetHeader]: [...input.groups].sort().join(',') };
    }
    // Read-only tier: adds the server's own gate on top of our filter layer. → §5h·7j
    if (spec.readOnlyHeaders && input.level === 'read') {
      headers = { ...(headers ?? {}), ...spec.readOnlyHeaders };
    }
    // Same rule, different mechanism: the provider cuts by ADDRESS. → `readOnlyUrl` above.
    const url = spec.readOnlyUrl && input.level === 'read' ? spec.readOnlyUrl : spec.url;
    return { type: 'http', url, ...(headers ? { headers } : {}) };
  }
  /**
   * Join order: shared `args` → `argsByOs` → user-selected directories.
   *
   * ⚠ Directories must go LAST (many CLIs treat trailing arguments as
   * positional), and `argsByOs` must go BEFORE them since it's still a named
   * flag.
   */
  const os = input.platform ?? process.platform;
  const extra = spec.argsByOs?.[os] ?? [];

  /**
   * A mode's directory. A missing `stateDir` while a mode demands a directory
   * ⇒ **throw**, don't skip: skipping means `--user-data-dir` silently
   * disappears and the arm silently falls back to a clean mode — i.e. the
   * user chose "keep me logged in" and gets back something that **keeps
   * nothing**, with no error message at all. A failure that's silent in the
   * **narrowing** direction is still a silent failure.
   */
  const on = input.options ?? [];
  const add: string[] = [];
  const drop = new Set<string>();
  for (const o of on) {
    add.push(...(o.args ?? []));
    for (const r of o.remove ?? []) drop.add(r);
    /**
     * 🔴 WRITE THE **PLACEHOLDER**, NOT THE REAL PATH. → `secrets.ts §OFFICE_STATE`
     *
     * The real path only exists at spawn time. Writing it here means writing
     * it into `args` ⇒ into the hash ⇒ the exact place that turns data into
     * an arm's identity: the same entry plugged into two offices would
     * produce two hashes, and moving the company's directory would change
     * every hash.
     */
    for (const d of o.dirs ?? []) add.push(d.flag, `${OFFICE_STATE}/${d.sub}`);
  }

  return {
    command: spec.command,
    // `drop` applies to BOTH `spec.args` AND `argsByOs` — a flag removable
    // here but not there is a trap waiting for the day a second entry uses it.
    args: [
      ...[...spec.args, ...extra].filter((a) => !drop.has(a)),
      ...add,
      ...(spec.appendFolders ? input.folders : []),
    ],
  };
}

/**
 * An entry's options that are on by default — used when the user hasn't
 * checked anything.
 *
 * ⚠ Returns an **array**, even empty: a default is a decision that must be
 * written out with `on`, not something inferred from declaration order —
 * which silently changes the day someone reorders the list.
 */
export function defaultOptions(arm: CatalogArm): readonly ArmOption[] {
  return (arm.options ?? []).filter((o) => o.on);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHICH CHECKBOXES ARE ON — READ FROM THE SAVED CONFIG, not from memory.        │
 * │ (user, 08/29: *"looking at the panel should tell me how it's configured"*)     │
 * │                                                                          │
 * │ Inferred backward from `args` rather than storing a second id list in the       │
 * │ roster, because two sources for the same fact is two sources that can            │
 * │ drift — and the wrong one would end up being the **displayed** one, i.e.          │
 * │ the user reads a config that isn't the one actually running. Same logic           │
 * │ as *"read from the handshake, not from what the user typed"*.                   │
 * │                                                                          │
 * │ A checkbox counts as ON when **all three clauses** match: its `args` are          │
 * │ present · its `remove` are absent · the flags in `dirs` are present.             │
 * │ Missing any one clause means "show window" (which only has `remove`)              │
 * │ would always look like it's on.                                          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function activeOptions(arm: CatalogArm, config: unknown): readonly ArmOption[] {
  const args = (config as { args?: unknown })?.args;
  if (!Array.isArray(args)) return [];
  const has = (s: string) => args.includes(s);
  return (arm.options ?? []).filter(
    (o) =>
      (o.args ?? []).every(has) &&
      (o.remove ?? []).every((r) => !has(r)) &&
      (o.dirs ?? []).every((d) => has(d.flag)),
  );
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THIS PROVIDER CUTS TOOLS AT THE SERVER, BY TIER — and it's a CIRCULAR       │
 * │ TRAP. (bug caught by the user 08/27)                                     │
 * │                                                                          │
 * │ For an entry that's both `tiered` and has `readOnlyHeaders`, testing at         │
 * │ the `read` tier sends the gate header ⇒ the server **returns only read           │
 * │ tools** ⇒ `offeredTiers` sees all three tiers as equal ⇒ the rule *"only          │
 * │ show a tier that adds ≥1 tool"* collapses to **one tier** ⇒ the tier              │
 * │ selector DOESN'T SHOW UP ⇒ the user **has no path up to full access**.           │
 * │ The default tier locks itself.                                          │
 * │                                                                          │
 * │ The symptom matched exactly what the user described: *"16 read-only              │
 * │ tools · 0 write tools"* then *"still no way to get this out? How do I             │
 * │ test it?"*. No error message anywhere — every layer did its own job                │
 * │ correctly.                                                              │
 * │                                                                          │
 * │ ⇒ Rule: **DISCOVERY carries no gate; RUNTIME does.** The Try button asks             │
 * │ *"what's the MOST this arm can do"* — mixing enforcement into a discovery          │
 * │ question makes the answer cut itself short. (The saved version still               │
 * │ builds with the gate, and `scopedTools` at save time still asks the                │
 * │ server again at the correct tier — so the granted tool list doesn't                 │
 * │ widen at all.)                                                          │
 * │                                                                          │
 * │ 🆕 08/29 — SAME TRAP, SECOND DOOR: `readOnlyUrl` (Linear cuts by ADDRESS,           │
 * │ not by header). Actually measured: testing at the `read` tier while                │
 * │ hitting `/mcp/readonly` ⇒ **35 tools, all three tiers equal, the tier               │
 * │ selector vanishes.** This function must see **every** server-side cutting            │
 * │ mechanism, not just the first one we happened to run into — it's the                 │
 * │ SOLE place answering *"does this entry cut its own discovery access                  │
 * │ short"*. Add a new mechanism and forget this line, and the bug comes                 │
 * │ back exactly the same, and **silently**. → [[agentco-finish-completely]]              │
 * │                                                                          │
 * │ ⚠ There's a THIRD door, measured but NOT fixable here: **the credential's           │
 * │ own scope**. A Linear credential with `read` scope calling the full `/mcp`           │
 * │ also only shows 35 tools. That door sits beyond this function's reach                │
 * │ because scope is decided at the moment the user clicks Consent —                    │
 * │ **before** they ever see the tier selector. The paired rule: **request               │
 * │ WIDE at consent time** (`read write`), then narrow at SAVE time.                     │
 * │ → `oauth.ts §refreshAccount(scope)` · `arms/linear.ts §narrowScope`                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function serverFenced(a: CatalogArm): boolean {
  return a.spec.kind === 'http' && Boolean(a.spec.readOnlyHeaders || a.spec.readOnlyUrl);
}

/** Does this entry need login rather than typing a credential? Inferred from `spec`, not re-declared. */
export function needsOAuth(a: CatalogArm): boolean {
  return a.spec.kind === 'http' && JSON.stringify(a.spec.headers ?? {}).includes(OAUTH_SLOT);
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ HOW TO LOG IN — for a provider that does **NOT offer dynamic client            │
 * │ registration (DCR)**. → §5h·7                                            │
 * │                                                                          │
 * │ Notion lets us request a `client_id` on the fly, so it **doesn't need this      │
 * │ field**. GitHub doesn't: a `client_id` has to already exist. And because           │
 * │ device flow **never uses `client_secret` at any step** (including                  │
 * │ refresh), `client_id` is **PUBLIC DATA** — shipped straight in code, the           │
 * │ way `gh` CLI, VS Code, and Vercel all do. Because of this the customer                 │
 * │ types **0 credentials**, exactly like Notion.                            │
 * │                                                                          │
 * │ ⚠ `clientId` here **can be overridden from the UI**, and that's                    │
 * │ deliberate, not a leftover feature: it's the escape hatch for the two               │
 * │ risks of agentco being the app-of-record (§5h·7h) — ① if OUR app gets                │
 * │ suspended by the provider, EVERY customer breaks at once; ② an enterprise            │
 * │ customer doesn't want to route through our identity. Same data field,               │
 * │ **0 extra lines of code**, and it's the kindest answer to *"why should I             │
 * │ trust agentco"*: **"you don't have to."**                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmAuth {
  kind: 'device';
  clientId: string;
  /** Some providers require a scope right at the device-code request step. GitHub App doesn't (measured: empty). */
  scope?: string;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ASK WHOSE CREDENTIAL THIS IS — for a provider that does NOT return identity.    │
 * │ → §5h·7k                                                                 │
 * │                                                                          │
 * │ Notion returns `workspace_id` + `workspace_name` right in the token             │
 * │ response. **GitHub returns both empty.** Without this field,                    │
 * │ `accountName()` falls back to `issuer|mcp_url` — a string **identical for         │
 * │ every account** ⇒ the same credential name ⇒ **the same hash** ⇒ two              │
 * │ different GitHub accounts get merged into ONE arm. Exactly the §6i case,           │
 * │ and it has no visible symptom until a second person logs in.                    │
 * │                                                                          │
 * │ ⇒ We ask, using the protocol we already have (`mcp-http.ts §callTool`).            │
 * │ `idField` becomes the hash seed (pick something that **doesn't change on             │
 * │ a rename**), `labelField` becomes the display label.                            │
 * │                                                                          │
 * │ 🎯 And it also patches a UX trap we stepped in ourselves while measuring:           │
 * │ the first login accidentally grabbed the credential of the **app owner's           │
 * │ own account**, because the browser was logged into that account. Without            │
 * │ showing `@login`, the only symptom is *"the arm can't see any repos"* — a           │
 * │ wrong-door message that sends people off checking permissions.                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmIdentity {
  /** The endpoint to ask. Usually the cheapest slice, not the full endpoint. */
  url: string;
  tool: string;
  /** The key used as the HASH SEED — must stay stable across a rename. */
  idField: string;
  /** The key used as the human-readable LABEL. */
  labelField: string;
}

/**
 * A tool group the user checks. The group belongs **to the provider**, not to
 * us.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ `label` KEEPS THE PROVIDER'S OWN NAME · `help` SAYS WHAT IT DOES. (user       │
 * │ settled 08/28)                                                          │
 * │                                                                          │
 * │ > *"That first checkbox: 'Know who I am, which repos' — I don't understand      │
 * │ >  it. I'd rather have technical terms like issue, action, easier to             │
 * │ >  understand than that"*                                                │
 * │                                                                          │
 * │ The old label translated `context` into a human sentence — and translated         │
 * │ **the wrong scope**: it promised *"knows which repos"* while `context`            │
 * │ only holds three account/organization tools. Both confusing and wrong.            │
 * │                                                                          │
 * │ ⇒ The name is the **address** (a user can look it up in the provider's           │
 * │ own docs), `help` is the **description**. Replacing the address with the           │
 * │ description loses both: unlookupable, and no better understood.                  │
 * │ [[agentco-count-mechanisms]]                                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmGroup {
  id: string;
  label: MessageKey;
  /** One sentence saying WHAT this group lets you do. Missing it leaves a non-technical user guessing. */
  help?: MessageKey;
  /** On by default when the dialog opens. Keep it minimal — every group costs tokens per turn. */
  on?: boolean;
}

export interface ArmSecretField {
  /**
   * THE EXACT VARIABLE NAME. The user never types this string — we ship it.
   *
   * It can't be inferred from the protocol: MCP never announces "which
   * variables I need", because that's a requirement at PROCESS STARTUP,
   * happening BEFORE the handshake. A wrong name ⇒ `status: 'failed'` — known
   * broken, unknown why. → SPEC-arms.md §5c
   */
  name: string;
  label: string;
  /** Where to get it. Missing this leaves a non-technical user stuck, with nobody to ask. */
  help: string;
}

export interface CatalogArm {
  id: string;
  name: MessageKey;
  /**
   * Our own NEUTRAL icon, not a third-party logo. → SPEC-arms.md §11c
   *
   * Not because of high risk — because `brand` is a DATA FIELD, turning on a
   * logo per provider later is a one-line change. Shipping neutral across the
   * board makes the catalog look like ONE SYSTEM, instead of half logos, half
   * gray icons.
   */
  icon: string;
  blurb: MessageKey;
  price: ArmPrice;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CONFIG IS DATA, NOT A FUNCTION. (user settled 08/25)                     │
   * │                                                                          │
   * │ The previous version: every entry had `build(input) => config` — i.e.        │
   * │ **one function per provider**. Small, but it's the exact place where            │
   * │ "add a provider" starts to mean "write code", and from there to                 │
   * │ `notion.ts` · `slack.ts` · `gmail.ts` is a slope with no step to stop on.        │
   * │                                                                          │
   * │ Now: **one** shared `buildConfig()`, each provider is a plain object.           │
   * │ A non-obvious but important consequence: the catalog is now                    │
   * │ **serializable** — turning it into JSON, loading it remotely, or letting          │
   * │ a user add their own entry all require NOT ONE line of code changed.            │
   * │ That's §5h·1 paying off for the third time.                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  spec: ArmSpec;
  /** Not declared ⇒ dynamic client registration (DCR) + web flow, exactly like Notion. → §5h·7 */
  auth?: ArmAuth;
  /** Not declared ⇒ identity read from the token response (Notion). → §5h·7k */
  identity?: ArmIdentity;
  /**
   * Tool groups for the user to check. Not declared ⇒ plug in the whole
   * server.
   *
   * 🔴 For GitHub this is **not an advanced option, it's a condition of
   * existing**: plugging in the default endpoint as-is is **≈30,000 tokens
   * PER TURN** (89 tools at `x/all` runs ≈60,000), while the whole system's
   * tool floor is only ~13,200 and a `filesystem` arm measures 2,185.
   * → §5h·7e
   */
  groups?: ArmGroup[];
  secrets: ArmSecretField[];
  /** An arm that needs an allowed-directory list. That directory list IS the allowlist. */
  folders?: { label: MessageKey; help: MessageKey };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ AN OUTSIDE FENCE — held by the PROVIDER, we only OPEN A DOOR for the           │
   * │ user to walk through. (user, 08/27: *"So there's nothing we can do?"*)          │
   * │                                                                          │
   * │ For GitHub, "which repos the app can touch" lives in the **installation**       │
   * │ itself, and an installation can only be edited on **GitHub's own consent          │
   * │ screen**. No API lets software add repos to itself — if one existed, the           │
   * │ entire consent mechanism would be meaningless. So the only thing we can            │
   * │ do, and MUST do, is a button.                                            │
   * │                                                                          │
   * │ 🔴 Without this field that message **never appears anywhere in the                │
   * │ product** — it only lives in a walkthrough file. A user who skips the             │
   * │ walkthrough plugs it in, sees `✓ 16 tools`, then gets a 404 on every call:          │
   * │ an arm that "runs" but can't do anything, with an error message that                │
   * │ sends them off checking their credential. Exactly the *wrong-door*                  │
   * │ failure class §5h·7f exists to close. → Test C-2 · F-3 Test 13                     │
   * │                                                                          │
   * │ ⚠ One of our apps serves **unlimited customers**: `client_id` is a                 │
   * │ SOFTWARE identity, each customer installs it into THEIR OWN account and             │
   * │ has their own installation carrying their own repo selection. A customer            │
   * │ does **not create an app**, there's no 15-minute setup step — that's                 │
   * │ Google's G2 path (§5h·4), and GitHub is deliberately not that path.                 │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  scope?: {
    /**
     * The button that opens it. States the ACTION, not "configuration" — and
     * it's the ONLY thing this block draws, so the wording has to be
     * self-sufficient.
     *
     * The accompanying `help` field was dropped 09/02 (the app is all text
     * already). What it warned about isn't lost: `repoScan` right below is
     * the only place allowed to say *"installed / not installed"* (§5h·7o),
     * and the translated 404 at runtime catches exactly the person who just
     * forgot to install it (§5h·7f-bis). Both speak AT THE RIGHT MOMENT,
     * unlike a paragraph read before anyone can understand what they're
     * choosing.
     */
    say: MessageKey;
    url: string;
  };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ CHECK INSTALLED ACCESS — automatic, 0 characters the user types.              │
   * │ → SPEC-arms §5h·7o                                                       │
   * │                                                                          │
   * │ Why it's needed: `probeArm` calls `tools/list`, and `tools/list`                │
   * │ **succeeds even when the app isn't installed on any repo** ⇒ a ✓ mark             │
   * │ proves *login works*, it does NOT prove *what it can reach*.                     │
   * │ → [[agentco-measurement-vs-conclusion]]                                 │
   * │                                                                          │
   * │ 🔴 AND THIS IS WHERE AN OBVIOUS-SEEMING PREMISE GOT KILLED BY THE                 │
   * │ MEASUREMENT (08/27): a `ghu_` credential is **NOT limited by the                  │
   * │ installation for PUBLIC repos** — measured: `list_branches` ran on **all           │
   * │ 16** repos while the app was only installed on **2**. ⇒ every "try                 │
   * │ reading a file" style probe reports ✓ regardless of installation, i.e.             │
   * │ it answers a DIFFERENT question than the one being asked.                        │
   * │                                                                          │
   * │ What actually distinguishes it is `gateTool`: a tool that's **READ-ONLY            │
   * │ but requires push permission**, something that only exists on a repo the           │
   * │ app is installed on. Measured 4/4 correct.                                       │
   * │                                                                          │
   * │ ⚠ `search` only sees repos OWNED by `login` itself — organization repos            │
   * │ aren't included. So an empty list **doesn't prove** "nothing installed             │
   * │ at all", and the UI has to leave an explicit way out instead of hard              │
   * │ blocking.                                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  repoScan?: {
    /** Asks "who am I" to build the search query. Usually the same as `identity.tool`. */
    meTool: string;
    loginField: string;
    searchTool: string;
    /** `${login}` gets replaced with the account name. */
    searchQuery: string;
    /**
     * 🔴 A READ-ONLY tool that requires WRITE permission — that's the entire
     * mechanism. Picking a regular read tool (`list_branches`) by mistake
     * would build a check that **always answers YES**, which is worse than
     * not checking at all.
     */
    gateTool: string;
  };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ BRAND PROFILE — AND THE LOGO LIVES RIGHT INSIDE IT. (moved here 08/28)         │
   * │                                                                          │
   * │ An empty `checkedOn` means **nobody has read that provider's brand rules            │
   * │ yet**.                                                                   │
   * │                                                                          │
   * │ ⚠ `mark` (a monochrome SVG path) sits HERE rather than in a lookup table            │
   * │ inside the web directory, and that's the entire point of moving it:               │
   * │                                                                          │
   * │  ① §11c is the rule *"rules not read ⇒ no logo"*. That rule can only be           │
   * │    enforced if **the logo and the brand declaration can see each other**.          │
   * │    On 08/27 we shipped GitHub/Notion logos inside `ArmIcon.tsx` while               │
   * │    `checkedOn` still sat `null` here — two files, nothing cross-checking            │
   * │    them, the rule became a promise.                                          │
   * │  ② The UI no longer needs to know any provider's name: it draws                   │
   * │    `brand.mark`, full stop. **0 provider names in the web code** — the             │
   * │    same discipline already used for `repoScan`.                                 │
   * │                                                                          │
   * │ Empty ⇒ draws a shape by TYPE (folder · plug · gear), never draws                │
   * │ something made up.                                                       │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  brand: {
    owner: string | null;
    guidelineUrl: string | null;
    checkedOn: string | null;
    /** SVG path in a 24×24 box, filled with `currentColor`. No color, no background. */
    mark?: string;
  };
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ READ-ONLY = A FLAG, NOT A LIST OF TOOL NAMES. (caught by the user 08/25)        │
   * │                                                                          │
   * │ 🔴 The first version hard-coded 14 `notion-*` names right into this file.       │
   * │ The user pointed it out immediately: *"we have to write code ourselves to          │
   * │ pick each tool… and more providers later?"* — correct, and worse than             │
   * │ that: **I had MEASURED the thing that made it unnecessary** and typed it            │
   * │ by hand anyway. Measured 08/25: **28/28 Notion tools all declare                   │
   * │ `annotations`**.                                                          │
   * │                                                                          │
   * │ ⇒ "Read-only" is something **ASKABLE AT HANDSHAKE TIME**, not something            │
   * │ to enumerate. `probe.ts §levelOf` has done exactly that inference since             │
   * │ 08/23 — including the DENY-BY-DEFAULT rule: no `readOnly` declared ⇒               │
   * │ filed under `write_external`, **absence is not a safety signal**.                 │
   * │                                                                          │
   * │ With this flag on, at PLUG-IN TIME, `addArm` runs a probe, filters                │
   * │ `level === 'read'`, and writes the resolved list into                            │
   * │ `arms[hash].tools` in `company.yaml`. Three things at once:                       │
   * │   · **0 tool names in code** — adding a provider is still adding data              │
   * │   · works for **any** server, including a community MCP we've never                │
   * │     heard of                                                              │
   * │   · the list lives in `company.yaml` ⇒ the user **can audit it**                  │
   * │                                                                          │
   * │ Still keeps the property of the hand-typed version: the list is a               │
   * │ **snapshot at plug-in time**, so a provider adding a WRITE tool later               │
   * │ **doesn't automatically leak in**. Different in exactly one way: it's a            │
   * │ **measured** snapshot, not a hand-typed one — so it also doesn't go stale           │
   * │ in the opposite direction (a provider renaming a READ tool silently loses           │
   * │ it from a hand-typed list; this one doesn't).                            │
   * │                                                                          │
   * │ ⚠ Does NOT break the "wire by whole server" gate (user, 08/24): that gate         │
   * │ decides **WHO** gets to use it — still a wire. This flag states what the           │
   * │ arm **IS**.                                                              │
   * │                                                                          │
   * │ ⚠ It cuts the RIGHT TO CALL, **not** tokens: the schema for all 28 tools           │
   * │ still comes back from the server. What cuts tokens is `ToolSearch`                 │
   * │ (worker.ts). Two different shields — don't assume one buys the other.              │
   * │ → SPEC-arms §9b                                                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  readOnly?: boolean;
  /**
   * Lets the user choose a **permission tier** at plug-in time (Read-only /
   * +Add / Full access). → `probe.ts §tierOf` · docs/SPEC-arms.md §6j
   *
   * Replaces `readOnly` for entries that support all three tiers. Keep
   * `readOnly` for an entry we deliberately do **not** allow to be raised —
   * but as of today no such entry exists, and a "hard-locked read-only" entry
   * should be a written-down decision, not a default.
   */
  tiered?: boolean;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE TIER EXPLANATION — OVERRIDABLE PER PROVIDER. (added 08/30)                 │
   * │                                                                          │
   * │ 🔴 WHY THIS FIELD HAS TO EXIST, rather than "write one smarter shared               │
   * │ sentence": the default `add` tier's sentence is *"Can create new                    │
   * │ pages/items, but doesn't touch anything already there"* — **wrong for               │
   * │ Linear**. Linear has no `create_issue`; it uses `save_issue` (upsert)                │
   * │ declaring `destructiveHint: true` ⇒ creating an issue falls into `full`.             │
   * │ Linear's `add` tier adds exactly **4 tools** and **cannot create an                  │
   * │ issue** — the very core action of that entire product.                         │
   * │                                                                          │
   * │ ⚠ BOUNDARIES, so this field doesn't balloon into a patch-everything spot:           │
   * │  · It does **NOT** change which tool belongs to which tier — that's                 │
   * │    `probe.ts §tierOf`, and `tierOf` only ever reads `annotations`. User             │
   * │    settled 08/29: *"just follow the truth table"*. Patching tier                    │
   * │    assignment for one provider would stuff a special case into the core.            │
   * │    → [[agentco-domain-vs-boundary]]                                      │
   * │  · It does **NOT** change the tier's NAME. A name is shared vocabulary               │
   * │    across every arm: "Read + Add" here but a different name on another               │
   * │    entry would leave the user unable to compare two arms. Only the                  │
   * │    EXPLANATION sentence changes.                                          │
   * │  · It edits a string that's **OURS**, not the provider's own declaration            │
   * │    — so it doesn't clash with the rule *"keep the provider's own group               │
   * │    names"* (§groups).                                                    │
   * │                                                                          │
   * │ Not declared ⇒ the default sentence, i.e. every entry today except               │
   * │ Linear. Overpromising is worse than overwarning (§11a-bis) — and a                  │
   * │ sentence promising *"can create"* on a tier that can't is exactly that               │
   * │ worse kind.                                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  tierSay?: Partial<Record<'read' | 'add' | 'full', MessageKey>>;
  /**
   * A shape hint the UI uses to pick an ICON -- the same pattern `folders` already uses.
   * Data, not a code branch keyed by provider name.
   */
  shape?: 'browser';
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ONE SENTENCE FOR THE **MODEL**, added to a role's roster line. → `armReach`     │
   * │                                                                          │
   * │ ⚠ Does NOT break the 08/27 decision (*"drop the idea of adding a                  │
   * │ priority rule to the worker's system prompt"*). That decision was about              │
   * │ a **general rule** pasted onto every turn; this is **per-entry data**,               │
   * │ only appears when a role holds that exact arm, and sits **right on that              │
   * │ arm's own line** — following the                                          │
   * │ [[agentco-prompt-rules-lose-to-examples]] rule.                          │
   * │                                                                          │
   * │ The case that created it (measured 08/29): a user said *"open youtube               │
   * │ and wait for me to log in"*. The Assistant planned it, the worker ran,               │
   * │ then reported *"can't wait"* — **$0.0473 for a task that's STRUCTURALLY             │
   * │ impossible**. Nobody was wrong: that fact didn't exist anywhere in the               │
   * │ context.                                                                 │
   * │                                                                          │
   * │ ⚠ This sentence must be SHORT and must **point to a next step**, not just         │
   * │ say "can't" — it enters the prefix of EVERY turn for that role. A long              │
   * │ sentence here is a long recurring bill. → the *"rescue sentence anchors             │
   * │ to the GOAL"* rule (08/28)                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  hint?: string;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ TOOLS NEVER GRANTED — even at the full-access tier. (08/29)                    │
   * │                                                                          │
   * │ ⚠ ONLY EVER CUTS, NEVER ADDS — so it does **not** clash with the one-way            │
   * │ rule settled 08/25 (*"unknown ⇒ escalate, never downgrade"*). Downgrading           │
   * │ means calling a dangerous tool safe; this states a tool that's **never              │
   * │ to be used**. Opposite directions, and only this direction is safe when            │
   * │ we're wrong.                                                             │
   * │                                                                          │
   * │ Why it's needed: `browser_run_code_unsafe` and `browser_evaluate` run              │
   * │ **arbitrary JS** in the page. Their annotations are correct                        │
   * │ (`destructive: true`), so `tierOf` files them under `full` — entirely               │
   * │ valid, and entirely not enough. Full access means *"can write"*, not               │
   * │ *"can run arbitrary code under your own login session"*.                          │
   * │                                                                          │
   * │ ⚠ This is OUR OWN list, living inside the catalog ⇒ it's **DATA**, and it            │
   * │ is a **snapshot at plug-in time**, same as `tools`. If a provider adds a            │
   * │ dangerous new tool later, this list **doesn't know about it on its                 │
   * │ own** — the same limit already noted on `readOnly`.                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  neverTools?: readonly string[];
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ MODE — a set of MUTUALLY EXCLUSIVE choices, unlike `groups` (check many).       │
   * │                                                                          │
   * │ Exists because the browser entry has two **entirely different** blast              │
   * │ radii, and the user has to **see which one they're picking**: a clean               │
   * │ browser every turn, or a browser that **remembers your login**. Hiding             │
   * │ the second one inside an Advanced checkbox would sell a wide blast radius            │
   * │ for one unthinking click.                                                │
   * │                                                                          │
   * │ ⚠ A mode's `args` go into the config ⇒ **into the hash** ⇒ switching modes           │
   * │ is **a different arm**, not an edit. Follows the "plug in and unplug"               │
   * │ rule.                                                                    │
   * │                                                                          │
   * │ `loopbackOnly` — a mode only selectable when the browser and the daemon             │
   * │ are on the **same machine**. The browser window opens on the machine                │
   * │ running the daemon, so clicking in Hanoi while the window pops up on a               │
   * │ Singapore server is exactly the 📂 button's bug. The gate has to be                 │
   * │ measured with `isLoopback(req.socket.remoteAddress)` — the **socket                 │
   * │ address**, not `Host` (a client can spoof it).                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  options?: readonly ArmOption[];
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THESE ARE TWO INDEPENDENT CHECKBOXES, NOT ONE THREE-TIER LIST.               │
 * │ (caught by the user 08/29, and the user was right)                              │
 * │                                                                          │
 * │ The first version bundled "show window" and "remember login" into three            │
 * │ mutually exclusive choices. Wrong: they're **two independent Playwright             │
 * │ flags**, four combinations in total, and that version **dropped a real              │
 * │ combination**: *show the window but save nothing* — i.e. the "watch what             │
 * │ the worker is doing" case, exactly what the user asked for in the first             │
 * │ place.                                                                   │
 * │                                                                          │
 * │ Root cause: I counted **scenarios** instead of counting **mechanisms**.             │
 * │ A list curated by scenario always misses exactly the scenario nobody's              │
 * │ told yet. → [[agentco-count-mechanisms]]                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export interface ArmOption {
  id: string;
  /** Human language, shown directly on the checkbox. */
  label: MessageKey;
  /** One sentence stating the **BLAST RADIUS**, not the configuration. */
  help: MessageKey;
  /** On by default when the user hasn't chosen anything. Multiple options can be on by default at once. */
  on?: boolean;
  /** Flags added to `args` when this option is checked. */
  args?: readonly string[];
  /**
   * Flags **removed from** `args` when this option is checked.
   *
   * Exists because some choices ARE the **absence** of a flag: "show window"
   * is exactly *not* passing `--headless`. Without a removal path,
   * `--headless` would need to be hand-carried down into every combination,
   * and every new combination becomes one more place to forget it.
   */
  remove?: readonly string[];
  /**
   * A runtime directory that has to be carried into `args`:
   * `<flag> <stateDir>/<sub>`.
   *
   * ⚠ DELIBERATELY NOT using `${…}` syntax — in this project that string has
   * **exactly one meaning: a credential name**, and `missingSecretRefs()`
   * scans the whole config to find any leftover placeholder. Borrowing it for
   * a path would produce *"Missing credential: OFFICE"* — a wrong-door error
   * message, exactly what §5m exists to avoid.
   */
  dirs?: readonly { flag: string; sub: string }[];
  /** Only shown/accepted when the browser and the daemon are on the same machine. */
  loopbackOnly?: boolean;
}

/** States "stdio or http" in human language for the UI — inferred from `spec`, not re-declared. */
export function transportOf(a: CatalogArm): 'stdio' | 'http' {
  return a.spec.kind;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ EACH PROVIDER'S DATA LIVES IN `arms/`, ONE FILE PER PROVIDER. (user, 08/28)     │
 * │                                                                          │
 * │ This file keeps **the types + the build function + the hashing** — what          │
 * │ every entry shares. Adding a provider = adding a file inside `arms/` and           │
 * │ one line in `arms/index.ts` — nothing here gets touched.                        │
 * │                                                                          │
 * │ ⚠ The import direction goes in exactly ONE way: `arms/*` `import type`             │
 * │ from this file (types get erased at compile time ⇒ no runtime cycle),               │
 * │ while this file imports BACK exactly one thing: the already-assembled              │
 * │ array. Reversing this creates a module cycle — the kind that only blows            │
 * │ up at runtime, in a file with nothing to do with it.                             │
 * │                                                                          │
 * │ `catalog.ts` stays the **single shared door**: everywhere else in the             │
 * │ project keeps `import { CATALOG, findArm } from './catalog.js'` as before.          │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export { CATALOG } from './arms/index.js';
export { FILES_ARM } from './arms/files.js';
export { BROWSER_ARM } from './arms/browser.js';
export { NOTION_ARM } from './arms/notion.js';
export { GITHUB_ARM } from './arms/github.js';

import { CATALOG as ALL } from './arms/index.js';

export function findArm(id: string): CatalogArm | undefined {
  return ALL.find((a) => a.id === id);
}

/**
 * An arm's IDENTITY = HASH(config + credential names). → docs/SPEC-arms.md §6i
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A HASH AND NOT A USER-TYPED NAME (user settled 08/23)                       │
 * │                                                                          │
 * │ The previous version used a user-typed `id` as the key, i.e. ONE string             │
 * │ carrying two jobs: identity and display label. Every symptom traced back            │
 * │ to that — archiving and recreating the same directory went undetected ·             │
 * │ the "already plugged in elsewhere" list bloated into a pile of near-               │
 * │ duplicates · the same config under a different name became two things ·            │
 * │ and renaming meant CHANGING THE KEY, dragging a rewrite of `mcp:` across            │
 * │ every `roles/*.yaml`.                                                    │
 * │                                                                          │
 * │ Split apart: **the hash is the identity** (immutable, machine-generated),           │
 * │ **the label is the name** (changes freely, nothing depends on it). Same             │
 * │ config ⇒ same hash ⇒ a duplicate becomes a thing that CAN'T HAPPEN, rather           │
 * │ than something to remember to check.                                    │
 * │                                                                          │
 * │ ⚠ CREDENTIAL NAMES MUST GO INTO THE HASH. Two different Notion workspaces           │
 * │ have identical `args` and differ only in `NOTION_TOKEN` vs                          │
 * │ `NOTION_TOKEN_B`. Hashing per config alone would merge two workspaces into           │
 * │ one — a silent failure, in the most expensive possible spot.                        │
 * │                                                                          │
 * │ ⚠⚠ THE HASH DOES NOT REPLACE THE PATH CHECK, and this is the easiest place          │
 * │ to get confused: the day we bump a package's version in the catalog, the           │
 * │ SAME directory produces a DIFFERENT hash ⇒ a second arm can get created             │
 * │ pointing at the exact same place ⇒ the "one path, one arm" rule breaks              │
 * │ silently. Two checks guarding two different things:                     │
 * │                                                                          │
 * │    hash   "is this exact config already known"      → COMPANY scope             │
 * │    path   "has this office already reached there"    → OFFICE scope             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `JSON.stringify` with SORTED keys: the same config written with keys in a
 * different order still has to produce the same hash, or "a duplicate can't
 * happen" becomes "a duplicate happens if you type the keys in a different
 * order".
 */
/**
 * `owner/repo` in CANONICAL form — lowercase, no suffix, no prefix.
 *
 * A user types this field by hand, and they'll paste all kinds of things:
 * `github.com/a/b`, `https://github.com/a/b.git`, `A/B`, `/a/b/`. All four are
 * **the same repo**, and GitHub is case-insensitive on both `owner` and
 * `repo`.
 *
 * ⚠ This function stands at TWO places on the same axis and **must be one
 * function**: it normalizes what goes into the HASH, and it normalizes what
 * the gate COMPARES against. Two copies of the same normalization drifting
 * apart means an arm blocks itself from the exact repo it was granted — and
 * the only symptom is "404, why a 404". → [[agentco-catch-hides-premises]]
 */
export function normRepo(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.)?github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
}

export function armHash(
  config: unknown,
  secretNames: readonly string[] = [],
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠⚠ THE PERMISSION TIER MUST GO INTO THE HASH — and the STRONGEST reason         │
   * │ isn't collision prevention.                                              │
   * │                                                                          │
   * │ The user stressed this 08/25: *"Changing the permission level at this              │
   * │ office must NOT change it at another office, that matters."* Putting the           │
   * │ tier in the hash ⇒ changing the tier = **a different arm** ⇒ another               │
   * │ office's `role.mcp` and `office.arms` still point at the old hash ⇒                │
   * │ **untouched, no line of code has to guard that on purpose**.                       │
   * │                                                                          │
   * │ If the tier were an edit-in-place field on the shared roster, it would be           │
   * │ the exact opposite: one click at office A **silently raises permissions**            │
   * │ for every office sharing it. Ruled out by **structure**, not by                    │
   * │ discipline.                                                              │
   * │                                                                          │
   * │ And the collision-prevention half still holds: same URL + same credential           │
   * │ + different tier sharing a hash would be a **silent overwrite** — exactly          │
   * │ the case §6i exists to block.                                            │
   * │                                                                          │
   * │ ⚠ JUNK HAS A CEILING: A→B→A lands back on the **exact same old hash**             │
   * │ (already in the roster ⇒ `addArm` reuses it). At most **3** entries for a           │
   * │ given (config + credential) — matching the tier count.                          │
   * │                                                                          │
   * │ ⚠ `undefined` must NOT enter the hash seed: every arm created before               │
   * │ 08/26 must keep its **exact old hash**, or the entire `company.yaml`                │
   * │ orphans itself after an upgrade. `JSON.stringify` drops `undefined` keys            │
   * │ — that's a behavior we RELY ON, not luck. A test guards it.                        │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  level?: string,
): string {
  const stable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, stable(val)]),
      );
    }
    return v;
  };
  /**
   * ⚠ REMOVED the fourth parameter `repos` (08/27 afternoon) — at the same
   * time the repo-level fence was removed.
   *
   * 📌 And here's the most memorable sentence about the GitHub entry's hash,
   * the user worked it out themselves: *"the GitHub hash seems to only depend
   * on which GitHub account it is, and what they're actually allowed to touch
   * isn't something we control anyway"* — **correct, and that's the right
   * outcome.** The hash is a fingerprint of what **agentco configures**, not
   * of what the arm **can reach**. Reach is the provider's own property,
   * changes outside our control, and baking it into the hash would be
   * promising something we can't keep. ⇒ A GitHub arm = (account + tool
   * groups + tier). → §5h·7l
   */
  const seed = JSON.stringify({ c: stable(config), s: [...secretNames].sort(), l: level });
  return `a${createHash('sha256').update(seed).digest('hex').slice(0, 10)}`;
}

/**
 * The directories an arm's config can reach. Empty = not a filesystem arm.
 *
 * Inferred from `args`: any argument that looks like an ABSOLUTE PATH.
 * Deliberately doesn't check package names — a user plugging in a different
 * filesystem server via "plug in manually" still has to obey the
 * duplicate-directory rule, and we don't know their package name in advance.
 *
 * ⚠ Accepts both path styles on EVERY platform (`D:\…` and `/home/…`),
 * without checking `process.platform`: an office zipped from a different OS
 * still has to correctly read the exact string written in `company.yaml`.
 * Same reason `SHELL_ALIASES` ships both names.
 */
export function folderRoots(config: unknown): string[] {
  const args = (config as { args?: unknown })?.args;
  if (!Array.isArray(args)) return [];
  return args.filter(
    (a): a is string => typeof a === 'string' && (/^[a-zA-Z]:[\\/]/.test(a) || a.startsWith('/')),
  );
}

/**
 * ⚠ `armKeys` WAS REMOVED (08/26) — don't rebuild it. It changed the
 * `mcpServers` key from a hash to a label's slug, so the model could tell two
 * arms of the same type apart.
 *
 * The user rejected it, and was right: a bridge at the **roster line**
 * (`assistant.ts §armReach`) is still needed in EVERY case (a non-Latin label
 * produces an empty slug · a duplicate label means both have to fall back to
 * the hash), so the slug was only a **partial** optimization stacked on top
 * of a mechanism that was already sufficient. In exchange it spawned three
 * conversion points, and the first (`armGrants`) broke in the direction of
 * **granting excess permission**. Details: `worker.ts` where `mcpServers` is
 * built.
 *
 * > *"the name is the house, the hash is the street address"* — user, 08/26.
 * > An address is for routing; a name is for calling out to. The roster
 * > connects the two, and it doesn't need to change the address to do that.
 */

/**
 * A NAME THE USER TYPED → an arm's REAL DIRECTORY. → `paths.ts §resolveInput`
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ The case that created this (08/26): a user typed *"list the songs in                │
 * │ Musics"*, the Assistant copied `"Musics"` into `inputs`, and the plan got            │
 * │ blocked because no file by that name exists — while an arm named                    │
 * │ **Musics** pointed straight at `D:\…\Musics`.                            │
 * │                                                                          │
 * │ TWO keys per arm, because a user refers to it both ways:                        │
 * │   · **label** — what they see on the diagram (`Musics`)                          │
 * │   · **directory leaf name** — what they see in Explorer                        │
 * │ These usually match, but a label can be renamed freely, so not always.            │
 * │                                                                          │
 * │ ⚠ Arms WITHOUT a directory (Notion, GitHub) don't enter this table: they            │
 * │ aren't a spot on disk, and mapping `"Notion" → a path` would be made up.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function armDirIndex(
  arms: Record<string, { label?: string }>,
  servers: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, cfg] of Object.entries(servers)) {
    const root = folderRoots(cfg)[0];
    if (!root) continue;
    const leaf = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
    const label = arms[id]?.label?.trim() ?? '';
    // Label goes AFTER the leaf name: the label is something the user set, so
    // when two arms collide on a key, the labeled one wins — it's what they
    // just typed.
    if (leaf) out[leaf.toLowerCase()] = root;
    if (label) out[label.toLowerCase()] = root;
  }
  return out;
}

/** Normalize for comparison: strip a trailing slash, unify `\`→`/`, drop case sensitivity. */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Does `next` EXACTLY MATCH any directory in `existing`?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ RULE (user settled 08/23): WITHIN ONE OFFICE, two arms must not point at             │
 * │ the **EXACT SAME** directory. Across different offices, it's fine —                 │
 * │ independent clones are deliberate.                                              │
 * │                                                                          │
 * │ Why the exact-match case is blocked: it's **pure duplication** — two                │
 * │ identical tool sets, the office pays 2× tokens for one capability, and              │
 * │ the model has two paths to do the same thing. No reason to want it.                 │
 * │                                                                          │
 * │ Moving forward is free: if a second person needs that directory, **wire             │
 * │ into the existing node**. One arm serving many workers is normal — that's           │
 * │ exactly why it's a NODE and not a property.                                       │
 * │                                                                          │
 * │ ⚠ THE FIRST VERSION ALSO BLOCKED "SUBDIRECTORIES", AND THAT WAS REMOVED             │
 * │ (the user rejected it, and was right).                                       │
 * │                                                                          │
 * │ The old reasoning: *"`D:/Records/2026` is inside `D:/Records`, so it                │
 * │ doesn't add anything"*. Wrong twice:                                            │
 * │                                                                          │
 * │  1. It DOES add something — a narrower arm is **least privilege**: worker           │
 * │     A can only reach `2026`, worker B can reach the whole archive. And it            │
 * │     helps the model avoid rummaging through a large directory tree.                 │
 * │  2. It's ASYMMETRIC BY CREATION ORDER. The final configs are identical,             │
 * │     differing only in who plugged in first — and operation order isn't a            │
 * │     property of the design.                                              │
 * │                                                                          │
 * │ Overlap STILL costs real tokens. But that's **a price the user chose**,             │
 * │ and the rule already settled for this exact kind of question is *show the           │
 * │ cost, don't block it* (§9b — removed the 2,000 cap). Applied a second               │
 * │ time, same reasoning.                                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function coveredBy(
  existing: { id: string; folders: string[] }[],
  next: string[],
): { id: string; folder: string } | undefined {
  for (const want of next.map(norm)) {
    for (const e of existing) {
      for (const have of e.folders.map(norm)) {
        if (want === have) return { id: e.id, folder: want };
      }
    }
  }
  return undefined;
}

/**
 * Does this root swallow the OFFICE (or COMPANY) directory whole?
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BLOCKED, and the second reason is HEAVIER than the first.                       │
 * │                                                                          │
 * │ 1. REDUNDANT: `Read`/`Write`/`Glob`/`Grep` already read-write freely inside          │
 * │    the office directory (that's its `cwd`). Plugging an arm into that                │
 * │    exact same spot pays ~2,200 tokens PER TURN to buy a capability                  │
 * │    that's already there, for free.                                              │
 * │                                                                          │
 * │ 2. 🔴 IT ROUTES AROUND THE `.state/` GUARD. `paths.ts §guardedZone` blocks           │
 * │    reading the credential store and writing config files — but the hook            │
 * │    only matches BUILTIN tools (`Read|Grep|Glob|Write|Edit`). An MCP tool             │
 * │    named `mcp__x__read_file` does NOT match. ⇒ an arm pointed at the                 │
 * │    office directory reopens the exact two holes just patched this                  │
 * │    morning, through a different door.                                          │
 * │                                                                          │
 * │ This is a NARROW patch for a WIDER hole: any filesystem MCP pointed                 │
 * │ anywhere containing `.state/` can route around it the same way. The wider           │
 * │ hole has to be patched by widening the hook's matcher to `mcp__*` —                 │
 * │ already noted in SPEC-arms §5f, NOT done yet, and nobody has measured               │
 * │ whether that matcher actually works. Don't read this gate as "already                │
 * │ safe": it closes the EASIEST path, not the whole class.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function swallowsOffice(root: string, officeDir: string, companyDir: string): boolean {
  const r = norm(root);
  return [officeDir, companyDir].some((d) => {
    const n = norm(d);
    return n === r || n.startsWith(`${r}/`);
  });
}

/**
 * The catalogue as the UI receives it: same shape, but every text field is the
 * SENTENCE rather than the catalogue key.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THE ENTRIES HOLD KEYS AND NOT SENTENCES.                             │
 * │                                                                          │
 * │ `arms/*.ts` are module-level constants, so a sentence written there is   │
 * │ frozen at import time — the interface switch would move every other      │
 * │ string on the screen and leave these behind. Keys resolve per request.   │
 * │                                                                          │
 * │ ⚠ `hint` is NOT touched here. It is read by the model, not by a person,  │
 * │ so it is an English literal in the entry and stays one. → the two worlds │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export type UiArm = Omit<CatalogArm, 'name' | 'blurb' | 'groups' | 'options' | 'folders' | 'scope' | 'tierSay'> & {
  name: string;
  blurb: string;
  groups?: readonly { id: string; label: string; help?: string; on?: boolean }[];
  options?: readonly (Omit<ArmOption, 'label' | 'help'> & { label: string; help: string })[];
  folders?: { label: string; help: string };
  scope?: { say: string; url: string };
  tierSay?: Partial<Record<'read' | 'add' | 'full', string>>;
};

function localise(a: CatalogArm): UiArm {
  return {
    ...a,
    name: t(a.name),
    blurb: t(a.blurb),
    ...(a.groups
      ? { groups: a.groups.map((g) => ({ ...g, label: t(g.label), ...(g.help ? { help: t(g.help) } : {}) })) }
      : {}),
    ...(a.options ? { options: a.options.map((o) => ({ ...o, label: t(o.label), help: t(o.help) })) } : {}),
    ...(a.folders ? { folders: { label: t(a.folders.label), help: t(a.folders.help) } } : {}),
    ...(a.scope ? { scope: { say: t(a.scope.say), url: a.scope.url } } : {}),
    ...(a.tierSay
      ? {
          tierSay: Object.fromEntries(
            Object.entries(a.tierSay).map(([tier, key]) => [tier, t(key)]),
          ) as Partial<Record<'read' | 'add' | 'full', string>>,
        }
      : {}),
  };
}

export function catalogForUi(): (UiArm & {
  transport: 'stdio' | 'http';
  needsLogin: boolean;
  deviceLogin: boolean;
  serverFence: boolean;
  host?: string;
})[] {
  /**
   * `host` — the endpoint's DOMAIN, and it's here because of a real dead end
   * (08/31).
   *
   * A user pasted `{"type":"http","url":"https://mcp.notion.com/mcp"}` via
   * "plug in manually", the server returned `needs-auth`, and the screen said
   * *"you need to approve this in the browser"* — while that path **has no
   * Login button at all**. The correct message should be *"this service is
   * already in the built-in catalog, use that path instead"*, and saying that
   * requires the UI to **recognize** the URL they just pasted.
   *
   * ⚠ Domain only, not the full URL: enough to recognize the provider, and
   * not a promise that our full path matches the one they pasted.
   * ⚠ Nothing secret here — it's already public in the provider's own README.
   */

  // `needsLogin` is inferred from `spec`, not hand-declared: an entry using
  // the `${OAUTH}` placeholder NEEDS login, and there's no way for these two
  // fields to disagree.
  //
  // `deviceLogin` is inferred from `auth` — the UI needs to know because TWO
  // different flows show up differently to the user: the web flow opens a tab
  // and waits for it to finish; device code **shows a code right here** and
  // polls on its own. Displaying the wrong flow tells someone to wait on a
  // tab that will never report back.
  // `serverFence` lets the UI say something TRUE about the token count: the
  // test runs WITHOUT the gate (see `serverFenced`), so for this entry the
  // measurement is a **ceiling**, and a lower tier will cost less than that.
  // Staying silent here would leave the user reading a correct number for a
  // config they didn't choose.
  return ALL.map((a) => {
    let host: string | undefined;
    if (a.spec.kind === 'http') {
      try {
        host = new URL(a.spec.url).hostname;
      } catch {
        // A broken URL in the catalog is our mistake, but it must NOT crash
        // the entire catalog — losing one hint beats losing the whole picker.
      }
    }
    return {
      ...localise(a),
      transport: transportOf(a),
      needsLogin: needsOAuth(a),
      deviceLogin: a.auth?.kind === 'device',
      serverFence: serverFenced(a),
      ...(host ? { host } : {}),
    };
  });
}

