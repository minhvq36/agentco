/**
 * Daemon: HTTP + SSE.
 *
 * → docs/SPEC-offices.md §8, docs/SPEC-cli.md §1
 *
 * ONE process owns everything. The cache priming gate's warmSet and every
 * Assistant's session MUST live in memory — spawning a separate process per
 * CLI command falls straight back into the `claude -p` trap: lose the
 * warmSet, lose the session, lose the cache.
 *
 * Binds 127.0.0.1. Binding 0.0.0.0 (VPS mode) REQUIRES a token — the daemon
 * refuses to run without one, because opening this port to the network means
 * letting a stranger run commands on your machine.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Company } from '../core/company.js';
import { LibraryError, docView } from '../library/store.js';
import { PREVIEW_MAX_BYTES, mimeOf } from '../core/artifacts.js';
import { RunError } from '../core/types.js';
import { serveStatic } from './static.js';
import { openFolder } from '../cli/daemonfile.js';
import { browseDirs } from '../core/paths.js';
import { appVersion } from '../core/version.js';
import {
  checkForUpdate,
  compareVersions,
  installKind,
  manifestUrls,
  packageRoot,
  readManifest,
  UPDATE_FIRST_CHECK_MS,
  UPDATE_TICK_MS,
  updateStatus,
  verifyManifest,
} from '../core/update-check.js';
import { MANIFEST_URL } from '../core/update-links.js';
import { applyLayer } from '../core/update-apply.js';
import { buildConfig, catalogForUi, defaultOptions, findArm, normRepo } from '../core/catalog.js';
import { baselineTokens, probeArm, toolsAtTier, type Tier } from '../core/probe.js';
import { callTool, httpTarget } from '../core/mcp-http.js';
import { cliToolNames, isCliArm, parseCliArm } from '../core/cli-arm.js';
import { grantFor, injectSecrets, missingSecretRefs, readSecrets } from '../core/secrets.js';
import { companyFingerprint, companyPaths, officeDir, officePaths } from '../core/paths.js';
import { endLogin, startLogin } from '../core/browser-login.js';
import { getLocale, t } from '../i18n/index.js';
import {
  REFRESH_TICK_MS,
  oauthAccounts,
  oauthCallback,
  oauthDevicePoll,
  oauthDeviceStart,
  oauthForget,
  oauthStart,
  oneSweepAtATime,
  redirectBase,
  refreshDue,
  scanRepos,
  deviceClientId,
  setDeviceClientId,
} from './oauth-routes.js';

/**
 * Does this request come from the very machine running the daemon?
 *
 * Reads ONLY the SOCKET address — `Host` and `X-Forwarded-For` are sent by
 * the client, so they can be spoofed. IPv4-mapped (`::ffff:127.0.0.1`) is the
 * form Node returns when a socket listens on IPv6 but receives an IPv4
 * connection; missing it would wrongly block the local machine itself under
 * most default configurations.
 */
export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

/**
 * The config for the arm about to be used: either the client sends it
 * directly (`config`), or the SERVER BUILDS IT from a catalog entry
 * (`catalogId` + `folders`).
 *
 * ⚠ The second path exists so that **the package's version number lives in
 * ONE place**. The previous version had the client assemble
 * `npx -y @…/server-filesystem@2026.7.10 <dirs>` itself — meaning the pinned
 * version string lived in both `catalog.ts` and `ArmDialog.tsx`. Two copies
 * of the same constant is something that has already burned this project
 * once (`agentSlot` vs `arrange`, see `layout-geometry.ts`): they drift, and
 * nobody notices until it breaks.
 */
/**
 * Facts **the server knows** that come with an arm-plugging request — kept in
 * one place so the two routes don't each compute their own version.
 *
 * ⚠ `loopbackOk` is read from the **socket address**, not `Host`: a client can
 * send any `Host` it wants, but a socket address can't be spoofed. The same
 * guard already used for the 📂 button (`isLoopback`) — the fourth place
 * checking the same fact, not a second mechanism.
 *
 * 📌 `stateDir` is NO LONGER here (removed 08/29). The path does **not** go
 * into the config — the roster keeps a placeholder `<OFFICE_STATE>`,
 * `injectSecrets` fills it in at spawn time. Full reasoning in
 * `secrets.ts §injectSecrets.dirs`. The block below is kept because it
 * records **the correct place to fill it in**, which is still valid:
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ Target = **`<office>/.state/browser`** — and this spot satisfies TWO       │
 * │ conditions at once, which is why it beat the two alternatives I tried       │
 * │ before:                                                                  │
 * │                                                                          │
 * │  ① **PER OFFICE** — a catalog entry is a blueprint, an office clones its    │
 * │     own copy of it (user corrected this 08/29). Two offices plugging in     │
 * │     the same entry get two separate profiles, not stepping on each other.   │
 * │  ② **behind `guardedZone`** — `paths.ts §guardedZone` guards **both** the     │
 * │     company's `.state` **and** the office's. This matters because a          │
 * │     browser profile holds a customer's **login cookies**: leaving it            │
 * │     somewhere a worker can read is leaving the key right next to the lock.        │
 * │                                                                          │
 * │ ⚠ A GAP STILL OPEN, noted so it isn't forgotten: the **reuse** roster lets     │
 * │ one office adopt an arm plugged in by another office. In that case the old        │
 * │ config is used as-is (the `armId` path doesn't rebuild it), so the path            │
 * │ still points at the **old office**. Not patched yet — needs either excluding       │
 * │ entries with `dirs` from the reuse roster, or rebuilding the path on adoption.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DOES THIS ENTRY NEED THE TOOL LIST RESOLVED — or is granting the whole      │
 * │ server fine?                                                            │
 * │                                                                          │
 * │ 🔴 ALMOST SHIPPED A HOLE 08/29, and it was completely silent: the browser      │
 * │ entry switched to `tiered: false` (because the `read` tier couldn't even       │
 * │ open a page — Test 18 C-1). The old condition only asked `readOnly ||          │
 * │ tiered` ⇒ this entry fell into the `tools: []` branch = **GRANT THE ENTIRE       │
 * │ SERVER** ⇒ `scopedTools` never ran ⇒ **`neverTools` never got applied**, and     │
 * │ `browser_evaluate` (runs arbitrary JS) got granted.                         │
 * │                                                                          │
 * │ No symptom at all: the arm worked better than before, just broader than          │
 * │ what we declared. Exactly the family *"breaks in the direction of MORE           │
 * │ PERMISSION, no symptom"* (§5t).                                          │
 * │                                                                          │
 * │ ⇒ Check all THREE clauses. Adding a new restriction mechanism and forgetting     │
 * │ its clause here reopens this exact hole under a different name.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function needsToolList(arm?: { readOnly?: boolean; tiered?: boolean; neverTools?: readonly string[] }): boolean {
  return Boolean(arm?.readOnly || arm?.tiered || arm?.neverTools?.length);
}

/**
 * The tier used to resolve the tool list. An entry **with tiers** defaults to
 * `read` (safe when nobody has chosen yet); an entry **without tiers** has
 * nothing to choose, so `full` — its limits come from `neverTools`, not from
 * a tier.
 */
function tierFor(arm: { tiered?: boolean } | undefined, level?: Tier): Tier {
  return level ?? (arm?.tiered ? 'read' : 'full');
}

function armCtx(req: http.IncomingMessage): { loopbackOk: boolean } {
  return { loopbackOk: isLoopback(req.socket.remoteAddress) };
}

/** The real target of the `<OFFICE_STATE>` placeholder — shared by both probing and runtime. */
export function officeStateDir(companyDir: string, office: string): string {
  return path.join(officePaths(officeDir(companyPaths(companyDir), office)).state, 'browser');
}

/**
 * The pair of paths that `probeArm` and `pickMcp` **both** need — one
 * function so the two entry points can't drift apart. `officeDir` is where a
 * CLI arm's child process is allowed to live; without it `prepareArm`
 * **deliberately doesn't build the server** rather than guess a `cwd` and let
 * a child process run loose in the daemon's own directory.
 */
export function armDirs(companyDir: string, office: string): { officeState: string; officeDir: string } {
  return {
    officeState: officeStateDir(companyDir, office),
    officeDir: officeDir(companyPaths(companyDir), office),
  };
}

export function armConfig(body: {
  config?: Record<string, unknown>;
  catalogId?: string;
  folders?: string[];
  account?: string;
  groups?: string[];
  level?: string;
  /**
   * 🔴 DISCOVERY ⇒ **DROP THE TIER**, whether or not `level` is present in
   * `body`.
   *
   * This flag is HERE, not at the call site, and that's the lesson from a
   * broken 08/27 patch: the call site wrote
   * `armConfig({ ...body, ...(discovery ? {} : { level }) })` — but
   * `...body` **had already brought in `body.level`**, so the conditional
   * spread only *overwrote*, never *removed*. The patch changed nothing, and
   * the user reported the exact same thing again.
   *
   * ⇒ One flag, read in exactly one place, right next to where the tier gets
   * used. The call site has no way left to get it wrong.
   * → `catalog.ts §serverFenced`
   */
  discovery?: boolean;
  /**
   * IDs of the checkboxes the user turned on (`CatalogArm.options`).
   * → `catalog.ts §ArmOption`
   *
   * ⚠ `undefined` = *"the client said nothing"* ⇒ fall back to **on by
   * default**. An **empty** array = *"the user unchecked everything"* ⇒
   * respect it, don't fall back to the default. Merging these two cases turns
   * an explicit choice into a click that does nothing.
   */
  options?: string[];
}, /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠⚠ A SEPARATE PARAMETER, NOT STUFFED INTO `body` — and this is a          │
   * │ SECURITY matter.                                                        │
   * │                                                                          │
   * │ `body` comes from the client. The call site writes                          │
   * │ `armConfig({ ...body, … })`, so ANY field sitting inside `body` is           │
   * │ **something the client can send**. A `loopbackOk` flag living in there        │
   * │ would be a **self-declared** flag: anyone can turn it on, and the gate         │
   * │ "only open a window on the same machine" becomes decoration.               │
   * │                                                                          │
   * │ This is exactly the failure class §5t already stepped in: `...body`           │
   * │ **had already brought in `body.level`**, so a patch meant to remove it          │
   * │ only overwrote it. Anywhere the client can write is a place that can't          │
   * │ hold a server decision.                                                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  ctx: {
    /** `isLoopback(req.socket.remoteAddress)` — the SOCKET address, not `Host`. */
    loopbackOk?: boolean;
    /** The office's `.browser` directory, for whichever mode needs to write a profile. */
  } = {},
): Record<string, unknown> | undefined {
  if (body.config) return body.config;
  const arm = body.catalogId ? findArm(body.catalogId) : undefined;
  if (!arm) return undefined;
  /**
   * ⚠ Any group that's NOT checked doesn't get into the config, and an entry
   * with `groups` that the client sends nothing for falls back to **the
   * groups on by default** — NOT to "grant the whole server". For GitHub,
   * "the whole server" is ≈30,000 tokens per turn (§5h·7e): a careless
   * default here is the customer's bill, not a minor detail.
   */
  const groups =
    body.groups ?? (arm.groups ? arm.groups.filter((g) => g.on).map((g) => g.id) : undefined);
  // The tier only enters the config when building the RUNTIME version. See `discovery` above.
  const level = body.discovery ? undefined : body.level;

  /**
   * Mode: the id the client sends → the matching object. No id matches ⇒ fall
   * back to the **default**, do NOT throw — an unrecognized id is an old UI's
   * problem, and the default is the narrowest mode, so falling back to it errs
   * toward safety.
   *
   * 🔴 But `loopbackOnly` THROWS, it doesn't fall back: a user chose "show the
   * window" and we silently hand them a headless run instead — they'd sit
   * waiting for a window that **never appears**, with no way to understand
   * why. Rejecting with a reason is the only honest option.
   */
  const options = arm.options
    ? body.options
      ? arm.options.filter((o) => body.options?.includes(o.id))
      : defaultOptions(arm)
    : undefined;

  for (const o of options ?? []) {
    if (o.loopbackOnly && !ctx.loopbackOk) {
      throw new RunError(t('srv.loopbackOption', { label: t(o.label) }), 'other');
    }
  }

  return buildConfig(arm.spec, {
    folders: body.folders ?? [],
    ...(body.account ? { account: body.account } : {}),
    ...(groups ? { groups } : {}),
    ...(level ? { level } : {}),
    ...(options ? { options } : {}),
  });
}

/**
 * THREE ENTRY PATHS, ONE RETURN SHAPE. The single place that decides "what is
 * this arm".
 *
 *   `armId`     reuse an entry already in the roster → the ROSTER is the source (credentials included)
 *   `catalogId` a catalog entry                       → the CATALOG is the source of credential names
 *   `config`    the user pasted it themselves (path B) → credential names inferred from the placeholder itself
 *
 * ⚠ The third path: credential names come from `${…}` inside the config they
 * pasted, **not** from `Object.keys(body.secrets)`. The two can drift —
 * typing an extra field, or leaving one blank — and `secretNames` feeds
 * directly into the HASH, so a drift produces a different arm. The source of
 * truth must be what the MCP server actually reads: the placeholder itself.
 */
function resolveArm(
  company: Company,
  body: {
    armId?: string;
    config?: Record<string, unknown>;
    catalogId?: string;
    folders?: string[];
    secrets?: Record<string, string>;
    /** OAuth credential name of the selected account. → `oauth.ts §accountName` */
    account?: string;
    /** Permission tier the user chose. Goes into the hash. → §6j */
    level?: Tier;
    /** Checked tool groups. Goes into `headers` ⇒ into the HASH. → `catalog.ts §toolsetHeader` */
    groups?: string[];
  },
  /**
   * 🔴 DISCOVERY, NOT RUNTIME — builds a config **without the tier gate**.
   *
   * Only the "Try now" button uses this flag. Full reasoning in
   * `catalog.ts §serverFenced`; in short: the `read` tier sends
   * `X-MCP-Readonly` to GitHub ⇒ the server only returns read tools ⇒
   * `offeredTiers` sees all three tiers as equal ⇒ **the tier selector never
   * shows up** ⇒ the user gets permanently locked at the lowest tier. "Try"
   * is asking *"what's the most this can do"*, so it has to ask while the
   * door is still open.
   *
   * ⚠ Does NOT grant more permission: the returned `level` is unchanged, the
   * SAVED version still builds with the gate, and `scopedTools` at save time
   * still asks the server again at the correct tier.
   */
  discovery = false,
  /** See the comment block of the same name in `armConfig` — this must be a PARAMETER, not a field of `body`. */
  ctx: { loopbackOk?: boolean } = {},
): {
  config: Record<string, unknown>;
  secretNames: string[];
  secrets: Record<string, string>;
  /** Tools granted, if already known. `undefined` = must be resolved at plug-in time. */
  tools?: string[];
  label?: string;
  catalog?: string;
  level?: Tier;
} | undefined {
  if (body.armId) {
    const r = company.reuseArm(body.armId);
    return {
      config: r.config,
      secretNames: r.secretNames,
      secrets: r.secrets,
      ...(r.level ? { level: r.level } : {}),
      // Already resolved at first plug-in — reuse that same list. Resolving
      // it AGAIN would open the door to two offices holding two different
      // lists for the same arm (the provider added a tool today, and the
      // office that plugs in today gets more).
      tools: r.tools,
      label: r.label,
      ...(r.catalog ? { catalog: r.catalog } : {}),
    };
  }
  const fromCatalog = body.catalogId ? findArm(body.catalogId) : undefined;
  /**
   * ⚠ THE TIER MUST BE SETTLED **BEFORE** BUILDING THE CONFIG, not after.
   *
   * For an entry with `readOnlyHeaders`, the tier **changes the config
   * itself** (adds the server's gate header). Building the config and only
   * then inferring the default tier ⇒ a plug-in that doesn't choose a tier
   * would write `level: 'read'` to the roster while the config **is missing
   * the gate** — two sources telling two different stories about the same
   * arm, and the wrong one is the one actually running. Exactly the §15i
   * failure family (*"reading the RUNTIME config by mistake instead of the
   * DECLARED one"*).
   */
  // The tier still gets computed and still goes into the ROSTER as before.
  // Dropping it from the CONFIG during discovery is `armConfig`'s job — one
  // flag, read in exactly one place.
  const level = fromCatalog?.tiered ? (body.level ?? 'read') : body.level;
  const config = armConfig({ ...body, ...(level ? { level } : {}), discovery }, ctx);
  if (!config) return undefined;
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 THE STRICT-PARSE GATE FOR A CLI DECLARATION — wired in 09/01.           │
   * │                                                                          │
   * │ Before today, `parseCliArm` **had a test, was exported, and no path             │
   * │ called it** — meaning a user pasting `failWhen` (camelCase) sailed right           │
   * │ through, exactly what that function exists to block. Rung three of the             │
   * │ ladder: *the spec says it's done · the code exists · HAS ANYONE ACTUALLY           │
   * │ CLICKED IT*. → [[agentco-spec-says-done]]                                    │
   * │                                                                          │
   * │ Placed in `resolveArm`, not in each route: this is the SHARED gate for            │
   * │ **both the Try button and the Done button**. Placing it in one route would         │
   * │ patch one door and leave the other with the old behavior — the exact kind          │
   * │ of patch that has burned this project before. [[agentco-finish-completely]]        │
   * │                                                                          │
   * │ ⚠ ONLY checks when `type: 'cli'`. Every other MCP config passes through            │
   * │ **without a single character changed** — that schema belongs to the                │
   * │ PROVIDER, we don't own it, so we don't get to be strict about it.                  │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  if (isCliArm(config)) {
    const parsed = parseCliArm(config);
    if (!parsed.ok) throw new RunError(parsed.error, 'other');
  }

  /**
   * Credential names come from the CATALOG, not from the client: the client
   * sends values, but the variable name has to match exactly what the MCP
   * server reads — that's our source of truth.
   *
   * Path B COMBINES two sources: the `${…}` placeholder (an HTTP server's
   * entry point) and a key the client sends (a stdio server's `env` entry
   * point, where there's no placeholder to read).
   *
   * 🔴 AND AN OAUTH ACCOUNT MUST BE IN THIS LIST. (bug reported by the user
   * 08/26)
   *
   * Notion declares `secrets: []` — correctly, since its credential name is
   * generated at login. But ignoring `body.account` leaves `secretNames`
   * empty, causing **two** failures, and the second one is far quieter:
   *   ① `probeArm` has no credential ⇒ the placeholder is left unfilled ⇒
   *      *"Missing credential"* right at the Try button — this is the one the
   *      user sees.
   *   ② `grantArm` writes `role.secrets` from this list. Empty ⇒ `pickMcp`
   *      injects nothing ⇒ the arm gets **401 on the first worker that uses
   *      it**, after the UI already reported ✓. The exact §5i failure class,
   *      through a new door.
   */
  const secretNames = fromCatalog
    ? [...fromCatalog.secrets.map((s) => s.name), ...(body.account ? [body.account] : [])]
    : [...new Set([...missingSecretRefs(config), ...Object.keys(body.secrets ?? {})])].sort();

  /**
   * 🔴 CREDENTIAL VALUES MUST BE READ FROM THE STORE, NOT ONLY ACCEPTED FROM
   * THE CLIENT. (same bug)
   *
   * The old code here was `secrets: body.secrets ?? {}` — meaning it only
   * knew about credentials the user **just typed into this dialog**. With
   * OAuth there's nothing to type: the credential lives in
   * `.state/secrets.json` from the moment login finished. `reuseArm` already
   * reads the store (it calls `grantFor`), but the plug-in-fresh path didn't
   * — two paths for the same question, and the newer path is the one that
   * forgot.
   *
   * ⚠ The client overwrites the store, not the other way around: when a user
   * is typing a NEW credential, what they just typed is the correct value —
   * the store still holds the old one.
   */
  const { env } = grantFor(readSecrets(companyPaths(company.dir)), secretNames);

  return {
    config,
    // An entry with tiers makes the tier REQUIRED — default `read`, safe when
    // none has been chosen.
    ...(level ? { level } : {}),
    secretNames,
    secrets: { ...env, ...(body.secrets ?? {}) },
    ...(needsToolList(fromCatalog) ? {} : { tools: [] }),
    ...(body.catalogId ? { catalog: body.catalogId } : {}),
  };
}

/**
 * Resolves a catalog entry's `readOnly` flag into a LIST OF TOOL NAMES, by
 * asking the server.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY ASK THE SERVER INSTEAD OF ACCEPTING IT FROM THE CLIENT — even though      │
 * │ the client just clicked "Try now" and is already holding that list.           │
 * │                                                                          │
 * │ Same logic as the note right below (*"credential names come from the           │
 * │ CATALOG, not the client"*): what decides **which tools an agent gets          │
 * │ called with** has to be a fact from the server, not a JSON array that            │
 * │ traveled over HTTP. This is a privilege boundary, and a privilege boundary        │
 * │ must not trust whatever's on the other side of it — even when the other           │
 * │ side today is our own UI on localhost.                                    │
 * │                                                                          │
 * │ Cost: one more round trip when clicking Done. Paid once, while the user           │
 * │ is still standing there and knows they're waiting — the same logic that            │
 * │ keeps `ensureInstalled` inside `probeArm` (§6c).                                 │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠ DENY BY DEFAULT. `levelOf` files a tool that doesn't declare `readOnly`
 * under `write_external` ⇒ it does **NOT** make the list. Missing annotations
 * is not a safety signal. And a failed probe ⇒ returns `[]` ⇒ `armGrants`
 * grants **the entire server** — 🔴 that's the WRONG direction, so the caller
 * must treat an empty array as an **error**, not "unrestricted". See where
 * `readOnlyTools` is used below.
 */
async function scopedTools(
  config: Record<string, unknown>,
  secrets: Record<string, string> | undefined,
  tier: Tier,
  /**
   * Tools a catalog entry bans outright — see `catalog.ts §neverTools`. CUTS
   * ONLY. Placed **after** `tier` rather than folded into `tier`: a tier is
   * something the user chooses, this is something we decide on their behalf,
   * and the two must not blur together.
   */
  never: readonly string[] = [],
  /** Paths `probeArm` needs — see `server.ts §armDirs`. */
  dirs?: { officeState: string; officeDir: string },
): Promise<string[]> {
  const r = await probeArm({ arm: config as never }, undefined, secrets, dirs);
  if (r.status !== 'connected') {
    throw new RunError(t('srv.probeListFailed', { reason: r.error ?? r.status }), 'other');
  }
  const granted = toolsAtTier(r.tools, tier).filter((n) => !never.includes(n));
  if (!granted.length) {
    /**
     * 🔴 AN EMPTY ARRAY MEANS THE WRONG DIRECTION, NOT "UNRESTRICTED".
     *
     * `armGrants` reads `tools: []` as **GRANT THE ENTIRE SERVER**. So an
     * empty result here has to be an **error**, not a value that's safe to
     * pass along. A real case: the server declares no `annotations` at all ⇒
     * every tool falls into the `full` tier ⇒ selecting `read` yields 0
     * tools. The UI should already have prevented choosing that tier
     * (`offeredTiers`), but the real enforcement has to live here — a client
     * can skip past it.
     */
    throw new RunError(t('srv.noToolsAtTier', { n: r.tools.length }), 'other');
  }
  return granted;
}

/**
 * File extensions NEVER rendered in the browser, always forced to download.
 *
 * `.svg` and `.html` are text, look harmless, and can run JavaScript. They're
 * generated by the MODEL — not written by the user — and the daemon serves
 * them from the same origin as the company control UI itself, which has no
 * authentication beyond "same machine". Previewing one of these is letting it
 * run inside the house.
 */
const RISKY = new Set(['svg', 'html', 'htm', 'xhtml']);

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 THE ONE PATH UNDER `/api/` THAT DOES NOT GO THROUGH THE TOKEN GATE — and   │
 * │ it has to be this way. (found 08/26 when the user asked *"if a VPS is         │
 * │ secured, does OAuth still work?"*)                                          │
 * │                                                                          │
 * │ A provider returns an authorization code via a **302 to the user's browser**,  │
 * │ and the browser follows that redirect like an ordinary navigation: it            │
 * │ does **NOT** attach `x-agentco-token`, and we can't stuff a token into            │
 * │ `redirect_uri` (it has to match, character for character, what's registered,       │
 * │ and it would end up in the provider's own logs). ⇒ In VPS mode, the token gate       │
 * │ would return **401** at the very last step, **every single time**, until this        │
 * │ exclusion existed.                                                       │
 * │                                                                          │
 * │ ⚠ Not a security loosening: this path's authentication is **`state`** —           │
 * │ 128 random bits, lives ≤10 minutes, used exactly once, and a mismatch means           │
 * │ **nothing happens at all**. That's OAuth's actual CSRF gate; stacking the             │
 * │ daemon's token on top of it adds nothing, and just breaks the flow.                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const OAUTH_CALLBACK = '/api/oauth/callback';

export interface ServeOptions {
  company: Company;
  port: number;
  host?: string;
  token?: string;
  onShutdown?(): void;
  /**
   * A new version is on disk and `current` points at it. The CALLER closes the
   * server and starts the new one — it holds the listening socket and knows the
   * port, and handing those facts into here would be a second copy of them.
   * → cli/index.ts `cmdStart` · SPEC-packaging §3.7.4
   */
  onRestart?(version: string): void;
  /**
   * The npm door's button. The caller spawns the same detached helper
   * `agentco update` uses — the daemon cannot run npm against the package it is
   * running from, and the CLI already owns that dance.
   *
   * Returns `undefined` when the work was handed off, or A SENTENCE saying why
   * it was not — in which case nothing has been stopped.
   *
   * ⚠ IT USED TO RETURN A BOOLEAN, and the screen said "no npm" for every
   * refusal. On 18/09 a real machine refused for a different reason entirely
   * (a full disk, `cli/update-run.ts §checkSpace`), and a boolean has no room
   * to say so. The reason is the whole value of refusing early.
   * → cli/update-run.ts · SPEC-packaging §3.7.5
   */
  onHandOffUpdate?(): string | undefined;
}

export interface Daemon {
  port: number;
  url: string;
  close(): Promise<void>;
}

export async function serve(opts: ServeOptions): Promise<Daemon> {
  const host = opts.host ?? '127.0.0.1';
  const { company } = opts;

  if (host !== '127.0.0.1' && host !== 'localhost' && !opts.token) {
    throw new Error(t('srv.bindRefused', { host }));
  }

  /**
   * The port ACTUALLY listening. Declared here instead of reading the
   * `const port` further down: the socket starts accepting connections the
   * moment `listen`'s callback fires, which is BEFORE the line
   * `const port = …` runs. A request landing in that gap would hit `const`'s
   * temporal dead zone and throw a `ReferenceError` — rare, and being rare is
   * exactly why nobody would be able to reproduce it while hunting for it.
   */
  let boundPort = opts.port;

  /** One update at a time. A second click while the first is unpacking would
   *  extract two trees into the same directory. */
  let updating = false;

  /**
   * A version already on disk and committed, which this process has NOT
   * restarted into because an office was working when the moment came.
   * → `core/update-links.ts §pendingRestart`
   */
  let pendingRestart: string | undefined;

  /**
   * Fetch the manifest fresh, verify it, and apply the `app` layer.
   *
   * ⚠ VERIFY, THEN READ — the same order as §3.2's check, and for the same
   * reason: a manifest with a bad signature is an attack, not a download we
   * could not check, so not one field of it is parsed.
   *
   * ⚠ It logs its own failures. This runs with nobody waiting on a response;
   * the page is polling `/healthz` and will say "nothing changed" on its own,
   * so the detail has to land somewhere a person can still find it.
   */
  async function runUpdate(): Promise<void> {
    const get = async (u: string): Promise<Uint8Array> => {
      const r = await fetch(u, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
      if (!r.ok) throw new Error(`${u} answered ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    };

    try {
      const urls = manifestUrls();
      const [body, sig] = await Promise.all([get(urls.manifest), get(urls.signature)]);
      if (!verifyManifest(body, Buffer.from(sig).toString('utf8'))) {
        console.error('[update] manifest signature did not verify — nothing applied');
        return;
      }
      const manifest = readManifest(body);
      const layer = manifest?.layers?.app;
      if (!manifest || !layer) {
        console.error('[update] the manifest names no app layer — nothing to apply');
        return;
      }
      if (compareVersions(layer.version, appVersion()) <= 0) {
        console.error(`[update] ${layer.version} is not newer than ${appVersion()}`);
        return;
      }

      // `<install>/app/<version>` → `<install>`. The applier writes beside it.
      const root = path.dirname(path.dirname(packageRoot()));
      const outcome = await applyLayer({ root }, layer);
      if (!outcome.ok) {
        console.error(`[update] ${outcome.reason}: ${outcome.detail}`);
        return;
      }
      /**
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ 🔴 ASK AGAIN. The gate on `POST` proved nobody was working WHEN THE │
       * │ BUTTON WAS PRESSED; this is a minute later, and the daemon has been │
       * │ serving the whole time — downloading and probing do not stop it. So │
       * │ a task can be handed out during the download and be killed by the   │
       * │ restart, which `healStale()` then records as `failed`. The check at │
       * │ the start and the check here are NOT the same check.               │
       * │                                                                    │
       * │ ⚠ SKIPPING THE RESTART LOSES NOTHING. `applyLayer` ends with        │
       * │ `writeCurrent()`, so by this line the new layer is probed, on disk, │
       * │ and already pointed at. Only the process is stale.                  │
       * │                                                                    │
       * │ ⚠ AND IT IS NOT RESCHEDULED. Restarting later, once the office goes │
       * │ quiet, would close the app on somebody minutes after they last      │
       * │ touched it — a surprise at a moment they did not choose. The next   │
       * │ start is theirs to pick, and the page is told so.                    │
       * │ → `pendingRestart`, which exists because `/healthz` would go on     │
       * │ reporting the old number and the page would say "nothing changed".  │
       * └────────────────────────────────────────────────────────────────────┘
       */
      const busy = company.workingOffices();
      if (busy.length) {
        pendingRestart = outcome.version;
        console.log(
          `[update] ${outcome.version} is in place — not restarting while ${busy.join(', ')} is working; it takes effect on the next start`,
        );
        return;
      }

      console.log(`[update] ${outcome.version} is in place — restarting`);
      opts.onRestart?.(outcome.version);
    } catch (err) {
      console.error(`[update] ${String((err as Error).message ?? err)}`);
    }
  }

  /**
   * The deployer's actual domain, inferred ONCE from `runtime.public_url`.
   *
   * Left blank (running on your own machine) ⇒ `undefined` ⇒ `hostAllowed`
   * behaves exactly like before, unchanged. A garbage URL ⇒ also `undefined`:
   * the Host gate **must narrow when in doubt**, never widen. The error
   * message for a garbage URL already exists in `redirectBase`, where the
   * user is actually clicking.
   */
  const publicHost = (() => {
    const raw = company.config.runtime.public_url?.trim();
    if (!raw) return undefined;
    try {
      return new URL(raw).hostname;
    } catch {
      return undefined;
    }
  })();

  const sseClients = new Set<http.ServerResponse>();
  const unsubscribe = company.on((event) => {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) res.write(payload);
  });

  const server = http.createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      // RunError = we anticipated this and have an explanation for the user.
      // 500 is for what we didn't anticipate.
      const status = err instanceof RunError ? 400 : 500;
      json(res, status, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    const segments = url.pathname.split('/').filter(Boolean);

    // Blocks DNS rebinding: an attacker's domain pointing at 127.0.0.1 would
    // send that domain as `Host`, not localhost. The deployer's ACTUAL domain
    // gets through because of their own declaration. → `hostAllowed`
    if (!hostAllowed(req.headers.host, host, publicHost)) {
      return json(res, 403, { error: t('srv.hostNotAllowed') });
    }

    if (opts.token && url.pathname.startsWith('/api/') && url.pathname !== OAUTH_CALLBACK) {
      const given = req.headers['x-agentco-token'] ?? url.searchParams.get('token');
      if (given !== opts.token) return json(res, 401, { error: t('srv.badToken') });
    }

    // Blocks CSRF. Without this step, ANY web page the user has open could
    // POST into the daemon: hand out token-burning tasks, delete offices,
    // disconnect every wire. A browser always sends Sec-Fetch-Site; a CLI or
    // a bridge sends none of these, so this check doesn't affect a
    // non-browser client.
    if (method !== 'GET' && method !== 'HEAD' && !sameSite(req)) {
      return json(res, 403, { error: t('srv.crossOrigin') });
    }

    // ── company level
    if (url.pathname === '/healthz') {
      // `company` is a fingerprint of the folder, never the folder — it exists
      // so `start` can tell "my own daemon, whose daemon.json went missing"
      // apart from "a different company", and move only for the second.
      // → core/paths.ts §companyFingerprint · cli/index.ts `cmdStart`
      return json(res, 200, {
        ok: true,
        version: appVersion(),
        offices: company.size,
        company: companyFingerprint(company.dir),
      });
    }
    // Anything that isn't /api/ is the UI — including a SPA's sub-paths.
    if (!url.pathname.startsWith('/api/') && (method === 'GET' || method === 'HEAD')) {
      // The token rides in the HTML, because the interface has no way to ask for
      // it: any endpoint serving it would sit behind the very gate it unlocks.
      // Undefined on loopback ⇒ nothing is injected. → server/static.ts
      // `sameMachine` rides along for the same reason and by the same route: it
      // is read from the SOCKET, which only the daemon can see, and the
      // interface used to guess it from its own address bar — wrong under
      // Docker, where the bridge is not loopback. → static.ts §BootFacts
      serveStatic(req, res, url.pathname, {
        token: opts.token,
        sameMachine: isLoopback(req.socket.remoteAddress),
      });
      return;
    }
    if (url.pathname === '/api/company' && method === 'GET') {
      return json(res, 200, {
        // Empty = nobody named it ⇒ the label follows the switch. → types.ts
        name: company.config.name || t('company.unnamed'),
        offices: company.list(),
        allowCorePromptEdit: company.config.allow_core_prompt_edit,
        // Does the office view exist at all. A matter of taste, declared at the
        // company because it answers "does this door exist", not "which view am
        // I in" — that one stays in the browser.
        // → docs/SPEC-office-animation.md §11c
        officeView: company.config.ui.office_view,
        // Which tier runs which model — the UI needs to say this out loud, or
        // "standard" is just a word and the user doesn't know what they're
        // paying for.
        models: company.config.models,
        // Interface language. NOT the language the assistant replies in — that
        // follows the human. → docs/CLAUDE.md §Language
        language: getLocale(),
      });
    }
    if (url.pathname === '/api/company' && method === 'PATCH') {
      const body = await readJson<{ models?: Record<string, string>; language?: string; name?: string }>(req);
      if (body.language !== undefined) {
        return json(res, 200, { language: company.updateLanguage(body.language) });
      }
      /**
       * ⚠ `!== undefined`, never a truthiness test. An EMPTY name is a real
       * instruction — "go back to the default label" — and `if (body.name)`
       * would drop it on the floor and fall through to the models branch,
       * answering a rename with *"missing field: models"*. → `Company.updateName`
       */
      if (body.name !== undefined) {
        const saved = company.updateName(String(body.name));
        // Answer with what the SCREEN should show, so an empty name comes back
        // as the label rather than as a blank title. The same `|| t()` the GET
        // above uses — one rule, applied in both doors.
        return json(res, 200, { name: saved || t('company.unnamed') });
      }
      if (!body.models) return json(res, 400, { error: t('srv.missingField', { field: 'models' }) });
      return json(res, 200, { models: company.updateModels(body.models) });
    }
    if (url.pathname === '/api/office' && method === 'POST') {
      const body = await readJson<{ name?: string; id?: string }>(req);
      const office = company.createOffice(body);
      return json(res, 201, { id: office.id, offices: company.list() });
    }
    if (url.pathname === '/api/events' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      sseClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        sseClients.delete(res);
      });
      return;
    }
    if (url.pathname === '/api/cost' && method === 'GET') {
      return json(res, 200, {
        text: company.costText(),
        report: company.costReport(),
        byOffice: company.costByOffice(),
      });
    }
    /**
     * Sweep the "no longer exists" entries out of the cost ledger.
     * → `Company.purgeGoneUsage`
     *
     * POST, not DELETE: it does NOT delete any resource at this address — it
     * appends a cutoff marker to the ledger. Using DELETE would have the verb
     * promise one thing (`/api/cost` disappears) while the server does
     * another.
     */
    if (url.pathname === '/api/cost/purge' && method === 'POST') {
      return json(res, 200, company.purgeGoneUsage());
    }
    // ── arms (MCP) — COMPANY level. → docs/SPEC-arms.md §6
    //
    // At the company level because `mcpServers` is company-scoped: plug it in
    // once, every office can reuse it without declaring the credential a
    // second time. WHO GETS TO USE it is the office's business — it goes
    // through a canvas connection, not through here.
    /**
     * Browse a directory for the picker. Lists the DAEMON's filesystem —
     * exactly what an arm will see, not the one belonging to whoever is
     * sitting in front of the screen. Only returns directory NAMES, reads no
     * content. → `paths.ts §browseDirs`
     */
    if (url.pathname === '/api/browse' && method === 'GET') {
      /**
       * ⭐ `?office=<id>` — OPEN AT THE OFFICE DIRECTORY. (added 09/01 for the
       * CLI tab)
       *
       * The CLI tab's picker defaults to standing at the office directory,
       * and **the client must not know that path**: it's the server's
       * business, and it changes with the OS and the install location. A
       * client concatenating a string here would rebuild exactly the *"two
       * copies of the same fact"* bug `buildConfig` went to the trouble of
       * fixing.
       *
       * ⚠ Doesn't exist ⇒ **falls back to root**, doesn't throw: a stale
       * office id should only make the picker open at the drive level, not
       * break the whole dialog.
       */
      const at = url.searchParams.get('path');
      const office = url.searchParams.get('office');
      if (!at && office) {
        const dir = officeDir(companyPaths(company.dir), office);
        if (fs.existsSync(dir)) return json(res, 200, browseDirs(dir));
      }
      return json(res, 200, browseDirs(at ?? undefined));
    }
    if (url.pathname === '/api/arms/catalog' && method === 'GET') {
      return json(res, 200, { arms: catalogForUi() });
    }
    /**
     * ── LOG IN TO A SERVICE. → `server/oauth-routes.ts`
     *
     * ⚠ `/start` returns a **URL for the web UI to open itself**, the daemon
     * does NOT spawn a browser: the browser the user is currently sitting in
     * already has a Notion session, the machine's default browser might not.
     * (lesson from 08/24)
     */
    if (url.pathname === '/api/oauth/start' && method === 'POST') {
      const body = await readJson<{ catalogId?: string }>(req);
      if (!body.catalogId) return json(res, 400, { error: t('srv.missingField', { field: 'catalogId' }) });
      /**
       * `redirect_uri` has to match, CHARACTER FOR CHARACTER, what was
       * registered — and it must NOT be inferred from the `Host` header (a
       * client can spoof it, and this is where the authorization code comes
       * back to). Three branches, including one that REFUSES when the daemon
       * binds outward without anyone having declared the real address.
       * → `oauth-routes.ts §redirectBase`
       */
      const origin = redirectBase({
        host,
        port: boundPort,
        publicUrl: company.config.runtime.public_url,
      });
      return json(res, 200, await oauthStart(company, body.catalogId, origin));
    }
    /**
     * Notion calls back here. NOT `/api/` in the usual sense — it returns
     * HTML for a browser tab, not JSON for the UI.
     *
     * ⚠ Ahead of the `sameSite` gate? Not needed: this is `GET`, and that
     * gate only applies to state-changing methods. But it DOES change real
     * state (saves a credential) — safe because of `state`: no `state`
     * matching a round we just opened means nothing happens at all. That's
     * OAuth's actual CSRF gate, not a browser header.
     */
    if (url.pathname === OAUTH_CALLBACK && method === 'GET') {
      const done = await oauthCallback(company, url.searchParams, res);
      if (done) {
        /**
         * The UI is waiting in the OTHER TAB — notify it so it updates its own
         * state instead of forcing the user to hit F5. This is the entire
         * point of redirecting back to the daemon: the tab that just finished
         * isn't the tab that has agentco open.
         *
         * ⚠ Only the NAME and LABEL. A token never travels this path — SSE is
         * a broadcast channel to every listening client.
         */
        /**
         * ⚠ `account` carries the name that was ACTUALLY SAVED, and the
         * interface needs it to be a fact rather than a guess.
         *
         * Without it the dialog has to infer which account was just linked by
         * looking for a name that was not in its list before — and that
         * inference is silently wrong in the case that matters most: signing in
         * again to an account that ALREADY EXISTS (repairing a refused
         * credential) adds no new name, so the selection does not move. The
         * user presses "sign in again" on account A, authorises as B by
         * mistake, watches B's warning clear, and is left with A selected and
         * still dead. The device-code path never had this problem — its poll
         * result carries the name. → `ArmDialog §loadAccounts`
         */
        const payload = `data: ${JSON.stringify({
          type: 'company.offices',
          say: t('srv.connected', { name: done.label ?? done.name }),
          account: done.name,
          office: '',
          plan_id: null,
        })}\n\n`;
        for (const c of sseClients) c.write(payload);
      }
      return;
    }
    /**
     * ── LOG IN VIA DEVICE CODE — for a provider that doesn't offer dynamic
     * registration. → §5h·7
     *
     * ⚠ There's NO `/callback` on this path, and that's its greatest strength:
     * no authorization code ever comes flying back, so `redirectBase` ·
     * `public_url` · nginx · Docker · VPS are **all irrelevant**. An arm
     * using this path works in every kind of deployment, even one where the
     * daemon never opens a port outward at all.
     */
    if (url.pathname === '/api/oauth/device/start' && method === 'POST') {
      const body = await readJson<{ catalogId?: string }>(req);
      if (!body.catalogId) return json(res, 400, { error: t('srv.missingField', { field: 'catalogId' }) });
      return json(res, 200, await oauthDeviceStart(company, body.catalogId));
    }
    /**
     * One POLLING beat. The UI calls it repeatedly, spaced by the
     * `intervalMs` the server returns.
     *
     * ⚠ Why the UI polls instead of the server holding a request open: a
     * request held open for 15 minutes dies because of everything in between
     * (nginx, a corporate proxy, a sleeping browser), and once it dies
     * **there's no state left to report**. A short polling loop just loses
     * one beat.
     *
     * The session lives in the DAEMON, not in the tab — closing the tab
     * doesn't kill the login attempt.
     */
    if (url.pathname === '/api/oauth/device/poll' && method === 'POST') {
      const body = await readJson<{ state?: string }>(req);
      if (!body.state) return json(res, 400, { error: t('srv.missingField', { field: 'state' }) });
      const r = await oauthDevicePoll(company, body.state);
      if (r.state === 'done') {
        // Same notification path as the web flow: the UI updates state, nobody hits F5.
        const payload = `data: ${JSON.stringify({
          type: 'company.offices',
          say: t('srv.connected', { name: r.label ?? r.name }),
          // Same field as the web flow, for the same reason — see the callback
          // route. This path also returns the name to its own caller, so here it
          // only serves OTHER tabs watching the same company.
          account: r.name,
          office: '',
          plan_id: null,
        })}\n\n`;
        for (const c of sseClients) c.write(payload);
      }
      return json(res, 200, r);
    }
    if (url.pathname === '/api/oauth/accounts' && method === 'GET') {
      return json(res, 200, {
        accounts: oauthAccounts(company, url.searchParams.get('for') ?? undefined),
      });
    }
    /** Disconnect a workspace: revoke it at the service (if it accepts that) then delete the credential locally. */
    if (segments[0] === 'api' && segments[1] === 'oauth' && segments[2] === 'accounts' && segments[3] && method === 'DELETE') {
      await oauthForget(company, decodeURIComponent(segments[3]));
      return json(res, 200, { accounts: oauthAccounts(company) });
    }
    if (url.pathname === '/api/arms' && method === 'GET') {
      return json(res, 200, { arms: company.listArms() });
    }

    /**
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ THE MANUAL LOGIN DOOR — opens a REGULAR browser window into the office's    │
     * │ profile. Not a task, doesn't go through Playwright.                       │
     * │ → `core/browser-login.ts` (full reasoning at the top of that file)          │
     * │                                                                      │
     * │ ⚠ `isLoopback(socket)` — the **socket address**, not `Host`. The window       │
     * │ opens on the machine running the daemon; viewing the UI remotely and          │
     * │ clicking this button would pop it up somewhere nobody's looking. The           │
     * │ **fifth** place checking the same fact (the 📂 button · the OAuth redirect ·   │
     * │ the "show window" checkbox · and this one).                              │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    if (url.pathname === '/api/browser-login' && method === 'POST') {
      const body = await readJson<{ office?: string; url?: string }>(req);
      // `url` OPTIONAL: opening the office's browser is enough, they can type the address themselves.
      if (!body.office) return json(res, 400, { error: t('srv.missingField', { field: 'office' }) });
      if (!isLoopback(req.socket.remoteAddress)) {
        return json(res, 400, {
          error: t('srv.browserLoginLocalOnly'),
        });
      }
      let working: boolean;
      try {
        working = company.get(body.office).currentState === 'working';
      } catch {
        return json(res, 404, { error: t('srv.noOffice') });
      }
      try {
        const r = startLogin({
          office: body.office,
          officeStateDir: officeStateDir(company.dir, body.office),
          ...(body.url ? { url: body.url } : {}),
          working,
        });
        return json(res, 200, { ok: true, profile: r.profile });
      } catch (e) {
        // `LoginError` is already human-readable — pass it through verbatim, don't re-wrap it.
        return json(res, 400, { error: (e as Error).message });
      }
    }

    if (url.pathname === '/api/browser-login' && method === 'DELETE') {
      const office = url.searchParams.get('office');
      if (!office) return json(res, 400, { error: t('srv.missingField', { field: 'office' }) });
      return json(res, 200, { closed: endLogin(office) });
    }
    /**
     * TRY NOW — an actual handshake with an unsaved config.
     *
     * ⚠ This is the SLOWEST route in the whole server: measured at 4s with a
     * warm `npx` cache, **17.7s** the first time it has to download the
     * package. The UI MUST show "connecting…" — silence must not be read as
     * a failure. → SPEC-arms.md §3a
     */
    if (url.pathname === '/api/arms/test' && method === 'POST') {
      const body = await readJson<{
        id?: string;
        armId?: string;
        config?: Record<string, unknown>;
        catalogId?: string;
        folders?: string[];
        secrets?: Record<string, string>;
        /**
         * ⚠ THESE FOUR FIELDS MUST BE DECLARED, even though yesterday they
         * worked fine undeclared.
         *
         * `readJson<T>` is a TYPE ASSERTION, not a filter — an unrecognized
         * field still passes through at runtime. So `level` has worked ever
         * since 08/26 while the type here never once mentioned it: **correct
         * code, a lying contract**. This is the exact same trap that once
         * swallowed `tools` (`company.ts §addArm`), just in the opposite
         * direction — and the next time someone adds a type-based filter,
         * this would silently drop out.
         */
        account?: string;
        level?: Tier;
        groups?: string[];
        /** Declared for the reason right above: `readJson` asserts a type, it doesn't filter. */
        office?: string;
        mode?: string;
      }>(req);
      // `true` = DISCOVERY. See resolveArm's `discovery` parameter — without
      // it, an entry with a server-side gate locks itself at the lowest tier,
      // with no error message.
      const arm = resolveArm(company, body, true, armCtx(req));
      if (!arm) return json(res, 400, { error: t('srv.armFieldsMissing') });
      const config = arm.config;
      const base = await baselineTokens();
      /**
       * ⚠ INJECT CREDENTIALS INTO THE TEST, or the Try button **tests
       * something different from what will actually run** — exactly the
       * failure class this project keeps catching. A worker receives
       * credentials through `pickMcp`; the probe has to receive that same
       * set, or an arm that needs a credential reports ✓ here and then fails
       * during real work.
       */
      const r = await probeArm(
        { [body.id || 'thu']: config as never },
        base,
        arm.secrets,
        body.office ? armDirs(company.dir, body.office) : undefined,
      );
      return json(res, 200, r);
    }
    /**
     * CHECK INSTALLED ACCESS — its own route, NOT folded into `/test`. → §5h·7o
     *
     * Two different questions, and merging them would force the fast one to
     * wait on the slow one: `/test` asks *"does this config work"* (~8–20
     * seconds, needs `baselineTokens` too), while this one asks *"which repos
     * has the provider given us access to"* (only needs a credential, runs
     * immediately after login, before the user has even chosen a tier or a
     * tool group).
     *
     * Splitting them means the UI fires this one **the moment an account is
     * selected**, and the user reads the result while still configuring
     * other things.
     */
    /**
     * The "use your own `client_id`" field — read and write. → SPEC-arms §5h·7h
     *
     * GET returns `own` so the UI knows whose identity it's traveling under,
     * rather than just showing an empty field: an empty field can't tell
     * apart *"nobody's pasted one yet"* from *"one's pasted but we don't show
     * it back"*.
     */
    if (url.pathname === '/api/oauth/client' && method === 'GET') {
      const id = url.searchParams.get('for');
      if (!id) return json(res, 400, { error: t('srv.missingField', { field: 'for' }) });
      return json(res, 200, deviceClientId(company, id));
    }
    if (url.pathname === '/api/oauth/client' && method === 'PUT') {
      const body = await readJson<{ catalogId?: string; clientId?: string }>(req);
      if (!body.catalogId) return json(res, 400, { error: t('srv.missingField', { field: 'catalogId' }) });
      setDeviceClientId(company, body.catalogId, body.clientId ?? '');
      return json(res, 200, deviceClientId(company, body.catalogId));
    }
    if (url.pathname === '/api/arms/repos' && method === 'POST') {
      const body = await readJson<{ catalogId?: string; account?: string }>(req);
      if (!body.catalogId || !body.account) {
        return json(res, 400, { error: t('srv.catalogOrAccountMissing') });
      }
      const scan = await scanRepos(company, body.catalogId, body.account);
      // `null` = COULDN'T CHECK, completely different from "checked and got
      // nothing". The UI handles these two cases in opposite directions, so
      // don't collapse them into one empty array.
      return json(res, 200, scan ?? { failed: true });
    }
    if (url.pathname === '/api/arms' && method === 'POST') {
      const body = await readJson<{
        label?: string;
        armId?: string;
        config?: Record<string, unknown>;
        catalogId?: string;
        folders?: string[];
        secrets?: Record<string, string>;
        office?: string;
        grantTo?: string[];
        /** See the comment block of the same name on the `/api/arms/test` route right above. */
        account?: string;
        level?: Tier;
        groups?: string[];
        mode?: string;
      }>(req);
      const arm = resolveArm(company, body, false, armCtx(req));
      if (!arm) return json(res, 400, { error: t('srv.armFieldsMissing') });
      // Resolve the `readOnly` flag BEFORE writing to the roster: if this
      // fails, throw, and no arm gets created. Creating first and resolving
      // second would leave behind an arm labeled "read-only" with
      // `tools: []` — i.e. GRANTS THE ENTIRE SERVER. Order here is security.
      // The ban list follows the CATALOG ENTRY, so it can only be looked up
      // when the entry is known. Plugging in via a hand-typed `config` (path
      // B) has no entry ⇒ no ban list — correct: that path is the user
      // declaring their own server, we don't curate on their behalf.
      const never = body.catalogId ? (findArm(body.catalogId)?.neverTools ?? []) : [];
      /**
       * ⚠ A CLI DECLARATION DOES NOT GO THROUGH `scopedTools` — and this is a
       * decision, not a shortcut.
       *
       * `scopedTools` exists to ask **someone else's server** *"what tools do
       * you have, which ones are read-only"* and then cut by tier. For CLI,
       * both halves are meaningless: the tool list **is stated by the
       * declaration itself** (there's no second source to drift from it),
       * and there **is no tier** — the user settled 08/30 that CLI is
       * all-or-nothing, and the remaining gate is *who gets wired to it* +
       * `confirm` on each action.
       *
       * Running it through anyway would mean paying for a `query()` round
       * trip to ask a question we already know the answer to, then forcing
       * the result through `tierFor` — running the tier machinery on
       * something that has no tiers is exactly where a fake tier gets born.
       * → SPEC-arms §16f box ③
       */
      const tools = isCliArm(arm.config) ? cliToolNames(arm.config) : arm.tools ?? (await scopedTools(
          arm.config,
          arm.secrets,
          tierFor(body.catalogId ? findArm(body.catalogId) : undefined, arm.level),
          never,
          body.office ? armDirs(company.dir, body.office) : undefined,
        ));
      const id = company.addArm({
        config: arm.config,
        secretNames: arm.secretNames,
        ...(arm.level ? { level: arm.level } : {}),
        ...(tools.length ? { tools } : {}),
        // The client's label is used ONLY on creation. On reuse the label
        // already belongs to the user (`addArm` keeps the old one) — sending
        // it along would just create the illusion it's editable.
        ...(body.armId ? {} : body.label ? { label: body.label } : {}),
        ...(arm.catalog ? { catalog: arm.catalog } : {}),
        // Reuse: the credential is ALREADY in `.state/secrets.json`, writing
        // it again would overwrite it with itself. Only write when the
        // client actually sends a new credential.
        ...(body.armId ? {} : body.secrets ? { secrets: body.secrets } : {}),
        ...(body.office ? { office: body.office } : {}),
      });

      // Who it's granted to — the SAME request, deliberately. Splitting this
      // into two calls opens a window where the arm exists but nobody can use
      // it yet, and if the second call fails the user is left with exactly
      // the DEAD NODE step 3 exists to prevent. → Office.grantArm
      /**
       * ⚠ CALLED EVEN WHEN `grantTo` IS EMPTY — a bug the user reported twice.
       *
       * The old condition was `body.grantTo?.length`, so "plug it in without
       * assigning it to anyone" did NOT run `grantArm` ⇒ never wrote
       * `office.arms` ⇒ **clicking Done did nothing at all**: the arm entered
       * the shared roster, but the diagram stayed empty.
       *
       * `grantArm` with an empty list still has work to do — it records
       * PRESENCE. That's exactly what splitting these two concepts apart
       * makes possible.
       */
      let canvas: unknown;
      if (body.office) {
        canvas = company.get(body.office).grantArm(id, body.grantTo ?? []);
      }
      return json(res, 201, { id, arms: company.listArms(), canvas });
    }
    /** Rename — only touches the label in the shared roster. No key change, no migration. */
    if (segments[0] === 'api' && segments[1] === 'arms' && segments[2] && method === 'PATCH') {
      const body = await readJson<{ label?: string }>(req);
      const label = company.renameArm(decodeURIComponent(segments[2]), body.label ?? '');
      return json(res, 200, { label, arms: company.listArms() });
    }
    /**
     * Unplug from ONE office (`?office=`), or from every office if none is
     * given. The shared roster isn't touched — plugging back in finds it
     * again. → `Company.removeArm`
     */
    if (segments[0] === 'api' && segments[1] === 'arms' && segments[2] && method === 'DELETE') {
      /**
       * `?forget=1` = PERMANENTLY DELETE from the shared roster, unrecoverable.
       * Explicit, exactly like the Results panel's `?all=1`: never infer a
       * destructive command from a **missing** parameter. `Company.forgetArm`
       * blocks itself if anyone still holds it, and **doesn't touch
       * credentials** — that's where the expensive part of plugging in lives.
       */
      if (url.searchParams.get('forget') === '1') {
        company.forgetArm(decodeURIComponent(segments[2]));
        return json(res, 200, { arms: company.listArms() });
      }
      const office = url.searchParams.get('office') ?? undefined;
      company.removeArm(decodeURIComponent(segments[2]), office);
      return json(res, 200, { arms: company.listArms() });
    }

    // From the cache only — this request never reaches the network.
    // → core/update-check.ts §updateStatus · SPEC-packaging §3.6
    if (url.pathname === '/api/update' && method === 'GET') {
      // `applying` comes from here and nowhere else: the page cannot remember
      // it across a remount, and a button that reappears mid-update is a button
      // somebody presses twice. → update-links.ts §UpdateView
      return json(
        res,
        200,
        updateStatus({
          paths: company.paths,
          enabled: company.config.updates.check,
          applying: updating,
          ...(pendingRestart ? { pendingRestart } : {}),
        }),
      );
    }

    if (url.pathname === '/api/shutdown' && method === 'POST') {
      json(res, 200, { ok: true });
      setTimeout(() => opts.onShutdown?.(), 100);
      return;
    }

    /**
     * ┌────────────────────────────────────────────────────────────────────────
     * │ 🔴 IT ANSWERS BEFORE IT STARTS, AND THAT IS THE DESIGN.
     * │ → SPEC-packaging §3.7.4
     * │
     * │ Applying an update takes a minute and ends by killing this server — so
     * │ there is no connection left to report progress on, and nothing to hold
     * │ open. The page that clicked is already in the browser; it switches to
     * │ its own "updating…" state and polls `/healthz` until a version answers.
     * │ Anything else would be a spinner served by a process that is trying to
     * │ stop existing.
     * │
     * │ ⚠ `packaged` ONLY. The npm door replaces the package this code is
     * │ running from, which needs a process outside it — that is
     * │ `agentco update`, and it already exists. One mechanism per door.
     * │
     * │ ⚠ The manifest is fetched FRESH rather than read from the 24-hour
     * │ cache: somebody just clicked a button, so a request is expected, and
     * │ the cache holds a version number while this needs a URL and a hash.
     * └────────────────────────────────────────────────────────────────────────
     */
    if (url.pathname === '/api/update' && method === 'POST') {
      /**
       * ┌────────────────────────────────────────────────────────────────────
       * │ 🔴 FOUR 409s LEAVE THIS ROUTE AND ONLY ONE OF THEM MEANS "IT IS
       * │ RUNNING". (user, 19/09/2026 — real case on 0.2.4, npm door)
       * │
       * │ This one: an update really is in flight, so the page is right to
       * │ keep saying "Updating…" and go on watching for the restart. The
       * │ three below — an office is busy, no npm handler, a refusal from
       * │ `handOffUpdate` — all mean NOTHING WILL HAPPEN, and a page that
       * │ shows "Updating…" for them tells a lie and then, five minutes
       * │ later, tells a second one: "the update failed", when it was never
       * │ allowed to start.
       * │
       * │ ⚠ `reason` GOES ON THIS BRANCH ALONE. The other three already carry
       * │ a human sentence naming what is wrong — the busy one even names the
       * │ offices (`company.ts §workingOffices` returns names, not a boolean)
       * │ — so the client shows those verbatim and needs no code to tell them
       * │ apart. Tagging all four would be a second mechanism doing the job
       * │ the sentences already do. → [[agentco-count-mechanisms]]
       * └────────────────────────────────────────────────────────────────────
       */
      if (updating) return json(res, 409, { error: t('srv.updateBusy'), reason: 'in-flight' });

      /*
       * ⚠ NOT WHILE SOMEBODY IS WORKING. Applying an update ends by killing
       * this process, and a task dying with it comes back marked `failed` by
       * `healStale()` on the next start — so the log blames the work for what
       * the update did, and nobody reading it can tell.
       *
       * ⚠ THE GATE IS HERE, not in the interface. Whatever a button does or
       * does not do, this is the request that ends the process. Same lesson as
       * `sameMachine` earlier today: a client-side check is a courtesy, and the
       * server is the fence. → `company.ts §workingOffices`
       */
      const busy = company.workingOffices();
      if (busy.length) {
        return json(res, 409, { error: t('srv.updateOfficeBusy', { offices: busy.join(', ') }) });
      }

      updating = true;

      /*
       * ⚠ TWO DOORS, ONE BUTTON, AND THEY DO NOT SHARE MACHINERY. The packaged
       * tree is replaced beside itself and committed by a pointer; an npm
       * install is replaced BY npm, from outside the package, which is what
       * `agentco update` already does. Making one of them pretend to be the
       * other is how a second copy of a mechanism gets born.
       */
      if (installKind() === 'packaged') {
        json(res, 202, { ok: true });
        void runUpdate().finally(() => {
          updating = false;
        });
        return;
      }

      /*
       * ⚠ NO HANDLER AND A HANDLER THAT SAID YES BOTH LOOK LIKE `undefined`
       * through `?.()`, and they are opposite answers. Ask whether the handler
       * exists first, then ask what it said. → [[agentco-absent-means-what-per-field]]
       */
      if (!opts.onHandOffUpdate) {
        updating = false;
        return json(res, 409, { error: t('srv.updateNoNpm') });
      }
      const refused = opts.onHandOffUpdate();
      if (refused !== undefined) {
        updating = false;
        return json(res, 409, { error: refused || t('srv.updateNoNpm') });
      }
      json(res, 202, { ok: true });
      setTimeout(() => opts.onShutdown?.(), 100);
      return;
    }

    // ── office level:  /api/office/:id/...
    if (segments[0] === 'api' && segments[1] === 'office' && segments[2]) {
      const officeId = decodeURIComponent(segments[2]);
      const rest = segments.slice(3);

      // DELETE now has exactly one meaning: PERMANENT DELETE. The "put away"
      // tier is PATCH archived — two very different intents shouldn't share
      // one verb distinguished only by a query-string flag, because that
      // flag is easy to forget and the consequence is unrecoverable.
      if (rest.length === 0 && method === 'DELETE') {
        company.removeOffice(officeId);
        return json(res, 200, { ok: true, offices: company.list() });
      }

      /**
       * ⚠ This handle is only valid up until the FIRST mutation that can
       * change an office's identity. As of today exactly one operation does
       * that — a rename that moves the directory — and the PATCH branch
       * re-fetches the handle after every step (`cur()`). Adding another
       * operation that moves/replaces the instance must follow that same
       * pattern.
       */
      const office = company.get(officeId);

      if (rest.length === 0 && method === 'GET') {
        return json(res, 200, {
          id: office.id,
          name: office.name,
          state: office.currentState,
          plan: office.plan ?? null,
          pending: office.readPending().tasks.length,
          // An unfinished session that CAN BE RESUMED — different from
          // `pending` in that it's already checked the preconditions (has a
          // `plan_id`, has `plan.json` on disk). The UI invites, it doesn't
          // auto-run.
          resumable: office.resumable() ?? null,
          knowledge: office.knowledge.size,
          // Two sources, two different roles — don't merge them:
          //   `chat`    = the conversation WRITTEN TO DISK, survives every
          //               daemon restart.
          //   `history` = an in-memory ring buffer, so a tab that opens late
          //               can catch up on LIVE state (what's running, who's
          //               doing what).
          chat: office.readChat(),
          history: company.history(officeId),
        });
      }
      // Rename an office / change the Assistant's model tier. Both live in
      // office.yaml, so they share one route.
      if (rest.length === 0 && method === 'PATCH') {
        const body = await readJson<{
          name?: string;
          assistant_tier?: string | null;
          /** The Assistant's display name. Doesn't appear in any prompt → doesn't break the cache. */
          assistant_name?: string;
          archived?: boolean;
        }>(req);
        /**
         * ┌──────────────────────────────────────────────────────────────────┐
         * │ A RENAME CAN CHANGE `id` TOO — so a handle must NOT be held onto.       │
         * │ (bug reported by the user 08/22)                                        │
         * │                                                                  │
         * │ `const office` at the top of the route is fetched ONCE. But                 │
         * │ `renameOffice` moves the directory and **swaps out the instance                │
         * │ entirely** in the map (`Company.moveOffice`), so from that line on              │
         * │ the old handle is a ghost: `office.id` is still the old id,                     │
         * │ `office.loaded.dir` points at a directory that no longer exists.               │
         * │                                                                  │
         * │ Two consequences, and the second is heavier than the symptom the user           │
         * │ actually sees:                                                          │
         * │                                                                  │
         * │  1. The response returns the OLD `id` ⇒ the client thinks nothing               │
         * │     changed ⇒ every call after that 404s until F5. This is what the             │
         * │     user sees.                                                       │
         * │  2. `setAssistantTier` / `renameAssistant` in the SAME request would            │
         * │     write `office.yaml` to the **stale, already-moved path**. The                │
         * │     UI doesn't send both in one request today, but the route                    │
         * │     allows it — a trap waiting to happen.                                  │
         * │                                                                  │
         * │ Fixed in ONE place, both are solved: track `curId` and RE-FETCH the             │
         * │ office after every mutation that can change identity. Any new mutation           │
         * │ added later gets this correct automatically, as long as it goes                 │
         * │ through `cur()`.                                                       │
         * └──────────────────────────────────────────────────────────────────┘
         */
        let curId = officeId;
        const cur = () => company.get(curId);

        // `archived` goes FIRST: restore before touching anything else.
        // Otherwise "restore and rename in one request" would get blocked by
        // the read-only guard itself, and the user wouldn't understand why.
        if (typeof body.archived === 'boolean') company.archiveOffice(curId, body.archived);
        if (typeof body.name === 'string') curId = company.renameOffice(curId, body.name).id;
        if (body.assistant_tier !== undefined) {
          cur().setAssistantTier(body.assistant_tier ?? undefined);
        }
        if (typeof body.assistant_name === 'string') cur().renameAssistant(body.assistant_name);

        const after = cur();
        return json(res, 200, {
          id: after.id,
          name: after.name,
          archived: after.archived,
          canvas: after.canvas(),
          offices: company.list(),
        });
      }

      /**
       * Office directory: ALWAYS returns the path, and ONLY opens it when the
       * browser is running on this exact machine. → `cli/daemonfile.ts §openFolder`
       *
       * ┌────────────────────────────────────────────────────────────────────┐
       * │ ⚠ "OPEN FOLDER" OPENS ON THE SERVER, NOT THE MACHINE THE VIEWER IS ON.     │
       * │                                                                    │
       * │ On a personal machine those two are the same, which is why this          │
       * │ button feels convenient. But agentco will run on a VPS and inside          │
       * │ Docker, and there it's entirely wrong: a user clicks the button in            │
       * │ Hanoi, an Explorer window pops up on a server in Singapore that              │
       * │ nobody is looking at. Best case, nothing happens; worse, an orphaned          │
       * │ process spawns on every click.                                           │
       * │                                                                    │
       * │ `AGENTCO_HEADLESS=1` correctly blocked the Docker case — but that's         │
       * │ something a deployer has to REMEMBER TO SET. An invariant that                │
       * │ depends on someone remembering isn't an invariant.                          │
       * │                                                                    │
       * │ The real gate: ask the socket itself. A request coming from loopback         │
       * │ means the browser and the daemon are on the same machine — that's           │
       * │ the ONLY condition that makes "open folder" meaningful. Not loopback           │
       * │ ⇒ just return the path.                                                    │
       * │                                                                    │
       * │ ⚠ Don't trust `Host`/`X-Forwarded-For`: both are sent by the client.         │
       * │ A socket address can't be spoofed remotely. A reverse proxy running          │
       * │ on the SAME machine slips through (it's loopback too) — accepted:            │
       * │ worst case, one `spawn` call does nothing on a machine with no screen.       │
       * └────────────────────────────────────────────────────────────────────┘
       *
       * `officeId` already passed through `isSafeId`, and `office.dir` is
       * built by us from `companyDir` — no user-typed string ever reaches
       * `spawn`.
       */
      if (rest[0] === 'reveal' && method === 'POST') {
        const local = isLoopback(req.socket.remoteAddress);
        if (local) openFolder(office.dir);
        return json(res, 200, { dir: office.dir, opened: local });
      }

      if (rest[0] === 'canvas' && method === 'GET') return json(res, 200, office.canvas());
      if (rest[0] === 'canvas' && method === 'PUT') {
        // `cast` = which character each person is drawn as in the office view,
        // `tint` = what colour their recolourable garment is. Both are pure view
        // state, so they ride on the diagram's own PUT rather than earning an
        // endpoint each. Absent leaves them untouched. → `layout.ts §save`
        const body = await readJson<{
          nodes?: unknown;
          edges?: unknown;
          cast?: unknown;
          tint?: unknown;
        }>(req);
        return json(res, 200, office.saveCanvas(body));
      }
      if (rest[0] === 'agent' && method === 'POST') {
        const body = await readJson<{ id?: string; display_name?: string; pitch?: string; tier?: string }>(req);
        const id = office.addAgent(body);
        return json(res, 201, { id, canvas: office.canvas() });
      }
      if (rest[0] === 'agent' && rest[1] && method === 'PATCH') {
        const body = await readJson<Record<string, unknown>>(req);
        const role = decodeURIComponent(rest[1]);
        // Archive / restore is separate: it doesn't edit profile CONTENT, it
        // changes whether this person exists on the diagram at all.
        if (typeof body['archived'] === 'boolean') {
          return json(res, 200, { canvas: office.archiveAgent(role, body['archived']) });
        }
        return json(res, 200, { canvas: office.editAgent(role, body as never) });
      }
      // PERMANENTLY DELETES the yaml file. The "put away" tier is PATCH { archived } above.
      if (rest[0] === 'agent' && rest[1] && method === 'DELETE') {
        office.removeAgent(decodeURIComponent(rest[1]));
        return json(res, 200, { ok: true, canvas: office.canvas() });
      }
      if (rest[0] === 'archived' && method === 'GET') {
        return json(res, 200, { agents: office.archivedAgents() });
      }
      if (rest[0] === 'say' && method === 'POST') {
        const body = await readJson<{ message?: string }>(req);
        const message = body.message?.trim();
        if (!message) return json(res, 400, { error: t('srv.missingField', { field: 'message' }) });
        return json(res, 200, await office.say(message));
      }
      if (rest[0] === 'run' && method === 'POST') {
        const body = await readJson<{ request?: string }>(req);
        const request = body.request?.trim();
        if (!request) return json(res, 400, { error: t('srv.missingField', { field: 'request' }) });
        // Return immediately, run in the background — the work takes far longer than one HTTP request.
        void office.run(request).catch(() => {});
        return json(res, 202, { accepted: true });
      }
      if (rest[0] === 'stop' && method === 'POST') {
        office.stop();
        return json(res, 200, { ok: true });
      }
      if (rest[0] === 'knowledge' && method === 'GET') {
        return json(res, 200, { nodes: office.knowledge.list() });
      }
      // A node id has a `/` in it (`k/agents/assistant/…`), so it travels in
      // the BODY, not the path — putting it in the URL means multiple layers
      // of encode/decode, and sooner or later one layer gets forgotten.
      if (rest[0] === 'knowledge' && method === 'PATCH') {
        const body = await readJson<{ id?: string; body?: string; remove?: boolean }>(req);
        if (!body.id) return json(res, 400, { error: t('srv.missingField', { field: 'id' }) });
        office.editKnowledge(body.id, { body: body.body, remove: body.remove === true });
        return json(res, 200, { nodes: office.knowledge.list() });
      }
      if (rest[0] === 'plans' && !rest[1] && method === 'GET') {
        return json(res, 200, { plans: office.plans.list() });
      }
      /**
       * ⚠ THERE'S NO `DELETE /plans` — and that's a decision, not an oversight.
       *
       * The task log is the only place linking `plan_id` in
       * `logs/usage.jsonl` to a readable NAME. Deleting a record leaves the
       * money still in the ledger with nobody knowing what task it belongs
       * to — and "(unknown)" in the cost ledger from then on carries TWO
       * meanings (a v0 record, or a user-deleted one), i.e. it's no longer
       * explainable. → SPEC-offices.md §6 · SESSIONS_MEMORY §5i
       *
       * What a user actually wants to clean up is a session stuck at
       * `running` after a crash — `healStalePlans()` fixes exactly that
       * without losing a single line of history.
       */
      if (rest[0] === 'plans' && rest[1] && method === 'GET') {
        const planId = decodeURIComponent(rest[1]);
        const record = office.plans.get(planId);
        if (!record) return json(res, 404, { error: t('srv.noPlan') });
        return json(res, 200, { plan: record, log: office.plans.readLog(planId) });
      }
      if (rest[0] === 'prompt' && rest[1] && method === 'GET') {
        const layers = office.describePrompt(decodeURIComponent(rest[1]));
        if (layers.length === 0) return json(res, 404, { error: t('srv.noRole') });
        return json(res, 200, { layers, editable: company.config.allow_core_prompt_edit });
      }
      if (rest[0] === 'prompt' && rest[1] && rest[2] && method === 'PUT') {
        const body = await readJson<{ text?: string }>(req);
        if (typeof body.text !== 'string') return json(res, 400, { error: t('srv.missingField', { field: 'text' }) });
        return json(res, 200, {
          layers: office.savePromptLayer(
            decodeURIComponent(rest[1]),
            decodeURIComponent(rest[2]),
            body.text,
          ),
        });
      }
      // ── document cabinet → docs/SPEC-library.md §13
      if (rest[0] === 'library' && !rest[1] && method === 'GET') {
        // Scan HERE, don't use a watcher: a watcher fires events mid-copy of
        // a large file and we'd extract a half-written version.
        // → SPEC-library.md §9.1
        return json(res, 200, { docs: office.library.scan().map(docView) });
      }
      if (rest[0] === 'library' && !rest[1] && method === 'POST') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: t('srv.missingField', { field: 'name' }) });
        const maxBytes = Math.round(company.config.library.max_file_mb * 1024 * 1024);
        // The cap has to enforce PER CHUNK while receiving, not after
        // buffering the whole thing into RAM — otherwise a 2GB file crashes
        // the daemon before it ever reaches the check. → SPEC-library.md §13
        const data = await readBody(req, maxBytes);
        try {
          // `office.addDocument`, NOT `library.add` directly: the document
          // cabinet's listing sits in the Assistant's prefix and must reload
          // IMMEDIATELY. Skip that step and a user who uploads a file and
          // asks about it right away — the single most natural action in the
          // whole product — gets told the Assistant sees no file by that name.
          const doc = office.addDocument(decodeURIComponent(name), data, {
            replace: url.searchParams.get('replace') === '1',
            maxBytes,
          });
          return json(res, 201, { doc: docView(doc), docs: office.library.list().map(docView) });
        } catch (err) {
          if (err instanceof LibraryError) {
            // 409 is reserved for a NAME COLLISION: the UI has to tell apart
            // "ask whether to replace it" from "this file wasn't accepted" —
            // two entirely different messages.
            return json(res, err.kind === 'duplicate' ? 409 : 400, { error: err.message });
          }
          throw err;
        }
      }
      // Re-extract a document that isn't usable yet. → SPEC-library.md §4.5
      if (rest[0] === 'library' && rest[1] === 'reextract' && method === 'POST') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: t('srv.missingField', { field: 'name' }) });
        if (!office.library.reextract(decodeURIComponent(name))) {
          return json(res, 404, { error: t('srv.noDocOrOriginal') });
        }
        // Return the list IMMEDIATELY, don't wait for extraction to finish:
        // the document goes to `pending` and the UI shows "reading…" —
        // extraction runs in the background, exactly like when the file was
        // first dropped.
        return json(res, 202, { docs: office.library.list().map(docView) });
      }
      if (rest[0] === 'library' && rest[1] === 'file' && method === 'GET') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: t('srv.missingField', { field: 'name' }) });
        const abs = office.library.originalPath(decodeURIComponent(name));
        if (!abs) return json(res, 404, { error: t('srv.noDoc') });
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
        });
        fs.createReadStream(abs).pipe(res);
        return;
      }
      if (rest[0] === 'library' && !rest[1] && method === 'DELETE') {
        const name = url.searchParams.get('name');
        if (!name) return json(res, 400, { error: t('srv.missingField', { field: 'name' }) });
        // `office.removeDocument`, NOT `library.remove` directly: deleting a
        // document has to cascade to every note that depends on it
        // (`depends_on`). Calling the store directly skips exactly that
        // constraint.
        const gone = office.removeDocument(decodeURIComponent(name));
        if (!gone.removed) return json(res, 404, { error: t('srv.noDoc') });
        return json(res, 200, { docs: office.library.list().map(docView), droppedNotes: gone.droppedNotes });
      }

      /**
       * ARM AUDIT LOG. → `core/audit.ts` · SPEC-arms §6k
       *
       * `?server=<hash>` filters by one arm — that's how the UI uses it,
       * because the question is always shaped like *"what has THIS
       * connection done"*, not *"what has the office called overall"*.
       */
      if (rest[0] === 'arm-log' && method === 'GET') {
        const server = url.searchParams.get('server') ?? undefined;
        const limit = Number(url.searchParams.get('limit') ?? 200);
        return json(res, 200, {
          calls: office.audit.list({
            ...(server ? { server } : {}),
            limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 1000) : 200,
          }),
        });
      }

      // ── results (artifacts) → docs/SPEC-artifacts.md
      if (rest[0] === 'artifacts' && !rest[1] && method === 'GET') {
        // Scans the disk every time, no cataloging: WORKERS write these files
        // while running, so any cached listing goes stale mid-session.
        //
        // `total`/`capped` travel with the list, not a separate route:
        // truncating without saying the total would let the UI show 500 rows
        // with no way for the user to know how many more exist.
        // → `Office.artifactList`
        const listed = office.artifactList();
        return json(res, 200, {
          artifacts: listed.items,
          total: listed.total,
          capped: listed.capped,
        });
      }
      if (rest[0] === 'artifacts' && !rest[1] && method === 'DELETE') {
        const rel = url.searchParams.get('path');
        /**
         * DELETE EVERYTHING — must be stated explicitly with `?all=1`, NEVER
         * by omitting `path`. Inferring "no file named" as "delete
         * everything" turns a programming mistake (forgot to build the
         * query string) into a destructive command. A missing `path` is
         * still a plain 400 as before. → `Office.clearArtifacts`
         */
        if (!rel && url.searchParams.get('all') === '1') {
          const removed = office.clearArtifacts();
          const after = office.artifactList();
          return json(res, 200, {
            removed,
            artifacts: after.items,
            total: after.total,
            capped: after.capped,
          });
        }
        if (!rel) return json(res, 400, { error: t('srv.missingField', { field: 'path' }) });
        // Goes through `Office` so the Results listing in the Assistant's
        // prefix reloads — otherwise it still names a file the user just
        // deleted. → `removeArtifact`
        if (!office.removeArtifact(rel)) return json(res, 404, { error: t('srv.noArtifact') });
        const after = office.artifactList();
        return json(res, 200, { artifacts: after.items, total: after.total, capped: after.capped });
      }
      /**
       * Read a result — VIEW or DOWNLOAD.
       *
       * ⚠ The previous version (`GET /artifact`) read with
       * `readFileSync(abs, 'utf8')` and always returned `text/plain`. That
       * works for markdown; for an image or a PDF it **corrupts the data** —
       * UTF-8-decoding a binary byte string loses information that can't be
       * recovered. Nobody had hit this because until today every result was
       * markdown; that's exactly the cheapest moment to fix it.
       *
       * Also no size cap: a 50MB `.csv` a worker produces would get loaded
       * entirely into the daemon's memory. Now it streams instead.
       */
      if (rest[0] === 'artifacts' && rest[1] === 'file' && method === 'GET') {
        const rel = url.searchParams.get('path');
        if (!rel) return json(res, 400, { error: t('srv.missingField', { field: 'path' }) });
        const abs = office.artifacts.resolve(rel);
        if (!abs) return json(res, 404, { error: t('srv.noArtifact') });

        const ext = path.extname(abs).slice(1);
        const download = url.searchParams.get('download') === '1';
        const stat = fs.statSync(abs);
        if (!download && stat.size > PREVIEW_MAX_BYTES) {
          return json(res, 413, {
            error: t('srv.previewTooBig', { mb: Math.round(stat.size / 1024 / 1024) }),
          });
        }
        res.writeHead(200, {
          // A model-generated `svg` or `html` file COULD contain a script.
          // Forcing a download instead of rendering is the only gate blocking
          // it from running in the same origin as the daemon — and the
          // daemon has no authentication beyond "same machine".
          'content-type': download || RISKY.has(ext.toLowerCase()) ? 'application/octet-stream' : mimeOf(ext),
          'content-length': String(stat.size),
          ...(download
            ? {
                'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
              }
            : {}),
        });
        fs.createReadStream(abs).pipe(res);
        return;
      }
    }

    return json(res, 404, { error: t('srv.noRoute') });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  boundPort = port;

  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE CREDENTIAL REFRESH LOOP — **THE ONE PLACE IN THE ENTIRE SYSTEM**, and    │
   * │ this is it.                                                             │
   * │                                                                          │
   * │ `refresh_token` ROTATES (measured 08/25): every refresh returns both a         │
   * │ new credential AND a new refresh token, the old one dies immediately.          │
   * │ Two processes refreshing at once means the slower one sends an ALREADY-        │
   * │ DEAD refresh token and overwrites the good version with a broken one.          │
   * │ No lock fixes this — only "exactly one place does it" fixes it.                │
   * │                                                                          │
   * │ `unref()` so it does NOT keep the process alive: a daemon that should            │
   * │ have already shut down but hangs around because of a `setInterval` is             │
   * │ something a user has to go hunt down and kill.                               │
   * │                                                                          │
   * │ Runs ONCE right at startup, doesn't wait for the first tick: a machine            │
   * │ waking up after 10 hours asleep means credentials have already expired,           │
   * │ and making the user wait another 15 minutes for it to wake up itself             │
   * │ means they hit a broken arm on their very first task.                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /**
   * ⚠ `oneSweepAtATime` — "one call site" was never the same thing as "one
   * sweep at a time". A sweep outliving its own interval used to have a second
   * one start on top of it, both sending the SAME rotating refresh token, and
   * the service killing the credential for whichever arrived second. Measured
   * on 09/03, three services, four seconds. → `oauth-routes.ts §oneSweepAtATime`
   */
  const tick = oneSweepAtATime(() =>
    refreshDue(company).catch((e: unknown) => {
      // A broken background loop must NOT crash the daemon. The user will
      // see the consequence where they're actually looking — an error
      // message when using the arm.
      process.emitWarning(`key refresh loop broke: ${e instanceof Error ? e.message : String(e)}`);
    }),
  );
  const refreshTimer = setInterval(tick, REFRESH_TICK_MS);
  refreshTimer.unref();
  tick();

  /**
   * The update check. → core/update-check.ts · SPEC-packaging §3.4, §3.6
   *
   * ⚠ NEVER ON THE STARTUP PATH: the first look waits 30 s, then every 6 h the
   * daemon asks — and the 24 h cadence lives in the cache, so a restart is not
   * a request. `unref` for the same reason as the loop above.
   *
   * ⚠ The config is read at EACH tick, so `updates.check: false` saved while
   * the daemon runs takes effect at the next one, with no request in between.
   */
  /**
   * ⚠ AND THEN TELL THE PAGE. Without this the answer is written to a cache
   * file that only `boot()` ever reads, so the "new version" dot is as old as
   * the tab — see `types.ts §update.available` for what that cost. The emit is
   * here, on the TICK, and not inside `checkForUpdate` (core, also used by the
   * CLI) and not inside `GET /api/update` (a read must not announce a change).
   *
   * ⚠ `enabled: false` emits nothing at all, on purpose: off means off, and a
   * `{ available: false }` would be an answer to a question we did not ask.
   */
  const checkUpdates = (): void => {
    void checkForUpdate({ paths: company.paths, enabled: company.config.updates.check })
      .then((cache) => {
        if (!cache) return;
        const view = updateStatus({ paths: company.paths, enabled: true });
        company.emit({
          type: 'update.available',
          available: view.available,
          ...(view.latest ? { latest: view.latest } : {}),
          office: '',
          plan_id: null,
        });
      })
      .catch((e: unknown) => {
        process.emitWarning(`update check broke: ${e instanceof Error ? e.message : String(e)}`);
      });
  };
  const firstUpdateCheck = setTimeout(checkUpdates, UPDATE_FIRST_CHECK_MS);
  firstUpdateCheck.unref();
  const updateTimer = setInterval(checkUpdates, UPDATE_TICK_MS);
  updateTimer.unref();

  return {
    port,
    url: `http://${host}:${port}`,
    async close() {
      clearInterval(refreshTimer);
      clearTimeout(firstUpdateCheck);
      clearInterval(updateTimer);
      unsubscribe();
      for (const res of sseClients) res.end();
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Only accepts a request from the same origin.
 *
 * `Sec-Fetch-Site` is set by the BROWSER, a web page can't overwrite it —
 * that's why it can be trusted. A non-browser client (CLI, Telegram bridge)
 * sends none of these three headers, and is let through.
 */
function sameSite(req: http.IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin' || site === 'none';

  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Host must be exactly what we're bound to. Blocks an attacker's domain
 * pointing at 127.0.0.1.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 HARD-BLOCKED BEHIND A REVERSE PROXY — found 08/26 when the user asked      │
 * │ about VPS/domains.                                                       │
 * │                                                                          │
 * │ Behind nginx, `Host` is the **company's own domain**                          │
 * │ (`agentco.company.com`), while we bind `0.0.0.0`. The old function compared        │
 * │ those two strings and returned `false` ⇒ **403 for EVERY request**, not             │
 * │ just OAuth. In other words: as of today agentco simply **cannot run behind          │
 * │ a domain** at all, and nobody knew because nobody had set it up yet.               │
 * │                                                                          │
 * │ ⚠ The fix must NOT be "let every Host through" — this gate exists to block         │
 * │ DNS rebinding, and removing it reopens that exact hole. So a valid domain           │
 * │ has to be something **the deployer DECLARES**, and they already do:                │
 * │ `runtime.public_url`. The same declaration decides both `redirect_uri` and          │
 * │ the Host gate — one source, two uses, can't drift apart.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
export function hostAllowed(given: string | undefined, bound: string, publicHost?: string): boolean {
  if (!given) return true;
  const hostname = given.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  if (publicHost && hostname === publicHost.toLowerCase()) return true;
  return hostname === bound.toLowerCase();
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new RunError(t('srv.bodyNotJson'), 'other');
  }
}

/**
 * Reads a BINARY body, cutting off the moment it exceeds the cap.
 *
 * → docs/SPEC-library.md §13
 *
 * This is the system's first route to receive binary data, and the trap sits
 * in the easiest place to overlook: checking the size AFTER
 * `Buffer.concat`-ing is already too late — a 2GB file exhausts the daemon's
 * memory before it ever reaches the check. Has to accumulate chunk by chunk
 * and throw the moment it goes over.
 *
 * DELIBERATELY not using `multipart/form-data`: parsing multipart correctly
 * (boundaries, filename encoding, a chunk split mid-boundary) is a whole
 * library, whereas here the filename travels on the query string and the
 * body is the content, unmodified. Less code, fewer places to get it wrong.
 */
async function readBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      req.destroy();
      throw new RunError(t('srv.uploadTooBig', { mb: Math.round(maxBytes / 1024 / 1024) }), 'other');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

// `pkgVersion` moved to `core/version.ts §appVersion` on 10/09 — the CLI needs the
// same number for `daemon.json`, and it had been carrying a hand-typed one.


