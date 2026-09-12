/**
 * The client API. The single place that talks to the daemon.
 *
 * The error rule (the "Good error handling" bar): the backend already returned a
 * sentence that explains itself — this layer's job is to NOT SWALLOW it. Every
 * error throws an `ApiError` whose `message` can go straight onto the screen.
 */

import type {
  ArchivedAgent,
  ArmCall,
  ArtifactRecord,
  CanvasState,
  CatalogArm,
  InstalledArm,
  ProbeResult,
  CompanyModels,
  CompanyView,
  KnowledgeEntry,
  LibraryDoc,
  OAuthAccount,
  OfficeDetail,
  OfficeSummary,
  PlanRecord,
  PromptLayer,
  AgentEvent,
  Locale,
} from './types';
import { t } from '@i18n';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
    });
  } catch {
    // The daemon going away mid-session WILL happen (Ctrl+C in the terminal). Say
    // what to do about it; do not leave the user looking at "Failed to fetch".
    throw new ApiError(t('error.lostDaemon'), 0);
  }

  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
  }

  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : t('error.httpStatus', { status: res.status });
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  company: () => call<CompanyView>('/api/company'),

  /**
   * Browse directories on the machine RUNNING THE DAEMON. A browser cannot hand
   * over an absolute path, and the OS dialog opens on the wrong machine when the
   * daemon is remote — so we list them ourselves. → `paths.ts §browseDirs`
   */
  /**
   * `office` = start in the **office directory** when there is no `p` yet.
   *
   * ⚠ The client sends an **office id**, never a path: paths are the server's
   * business (they differ by OS and by install location), and assembling one here
   * rebuilds exactly the *"two copies of one truth"* class of bug.
   * → `server.ts /api/browse`
   */
  browse: (p?: string, office?: string) =>
    call<{ path: string; parent: string | null; dirs: { name: string; path: string }[] }>(
      `/api/browse${p ? `?path=${enc(p)}` : office ? `?office=${enc(office)}` : ''}`,
    ),

  // ── arms (MCP). → docs/SPEC-arms.md §6
  armCatalog: () => call<{ arms: CatalogArm[] }>('/api/arms/catalog'),
  arms: () => call<{ arms: InstalledArm[] }>('/api/arms'),

  /**
   * TEST NOW — a real handshake, nothing saved yet.
   *
   * ⚠ SLOW, AND THAT IS NORMAL. The interface has to show "connecting…" — read
   * the silence as failure and every arm looks broken on its first plug-in.
   *
   * CORRECTION 24/08 (`scripts/spike-npx-cost.ts`, 10 runs): the old text here
   * said *"4 seconds once the npx cache is warm, 17.7 seconds the first time"*.
   * The real numbers with the package cached: **7.7–9.2 seconds, and the first
   * run equals the third** — there is no "faster next time". ~3.2s of that is
   * `npx`'s own overhead, measured by running `node <file>` directly (0.8s). The
   * same charge is paid on EVERY task that has an arm.
   */
  testArm: (
    id: string,
    body: {
      /**
       * REUSE an entry already in the ledger. The server takes the config, the
       * key name and **the key's value** from the shared ledger, so there is
       * nothing for the client to send along.
       *
       * ⚠ Do not replace this by pasting `config` down the "custom" path: the
       * config in the ledger keeps its `${…}` placeholders, and sending that
       * without a key is a **401** — exactly the bug the user hit on 25/08
       * carrying Notion over to a second office.
       */
      armId?: string;
      config?: unknown;
      catalogId?: string;
      folders?: string[];
      /** Task groups + the how-it-runs checkboxes — DECLARED, so the contract cannot lie. */
      groups?: string[];
      options?: string[];
      /** Needed for the <OFFICE_STATE> placeholder — see the call site in ArmDialog. */
      office?: string;
      secrets?: Record<string, string>;
      /** The OAuth key name of the chosen account. → `oauth.ts §accountName` */
      account?: string;
      /** Access level. Feeds the hash on the server — see `addArm`. */
      level?: 'read' | 'add' | 'full';
    },
  ) => call<ProbeResult>('/api/arms/test', { method: 'POST', body: JSON.stringify({ id, ...body }) }),

  // ── signing in to a service (OAuth). → docs/SPEC-arms.md §5h
  /**
   * Start a sign-in. Returns a **URL for US to open ourselves**; the daemon spawns
   * nothing.
   *
   * ⚠ That is the whole point of the design: the browser the user is sitting in
   * front of already has a Notion session; the machine's default browser might
   * not — the user hit exactly that case on their first attempt on 24/08.
   */
  oauthStart: (catalogId: string) =>
    call<{ authUrl: string; state: string }>('/api/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ catalogId }),
    }),

  /**
   * Request a DEVICE CODE. No `redirect_uri`, no callback tab.
   *
   * ⚠ Which is why this flow works even when the daemon **exposes no port at
   * all** — no authorization code is flying back anywhere. → SPEC-arms §5h·7b
   */
  oauthDeviceStart: (catalogId: string) =>
    call<{
      state: string;
      userCode: string;
      verificationUri: string;
      verificationUriComplete?: string;
      expiresAt: number;
      intervalMs: number;
    }>('/api/oauth/device/start', { method: 'POST', body: JSON.stringify({ catalogId }) }),

  /**
   * ONE poll. The interface repeats at the `intervalMs` the server returns.
   *
   * ⚠ Why the interface polls instead of holding one request open for 15 minutes:
   * a request held that long dies to everything in between (nginx, a corporate
   * proxy, a sleeping tab), and when it dies there is **no state left to tell the
   * story**. Losing one poll only loses one poll — the session still lives in the
   * daemon.
   */
  oauthDevicePoll: (state: string) =>
    call<
      | { state: 'pending'; intervalMs: number; expiresAt: number }
      | { state: 'done'; name: string; label?: string }
    >('/api/oauth/device/poll', { method: 'POST', body: JSON.stringify({ state }) }),

  /**
   * The "use your own `client_id`" field. → SPEC-arms §5h·7h
   *
   * `own: true` = this company is travelling under THEIR application identity, not
   * agentco's. The escape hatch for two risks: our app gets suspended by the
   * vendor ⇒ every customer breaks at once · an enterprise customer does not want
   * to travel under our identity.
   */
  oauthClient: (forCatalog: string) =>
    call<{ id: string; own: boolean }>(`/api/oauth/client?for=${enc(forCatalog)}`),

  /** Paste nothing = back to agentco's own client. */
  setOauthClient: (catalogId: string, clientId: string) =>
    call<{ id: string; own: boolean }>('/api/oauth/client', {
      method: 'PUT',
      body: JSON.stringify({ catalogId, clientId }),
    }),

  /**
   * LOOK UP THE APP INSTALLATION — which repos the vendor actually lets this arm
   * touch. → §5h·7o
   *
   * ⚠ `failed: true` is NOT `installed: []`, and the interface must treat them
   * oppositely:
   *   `installed: []`  → the lookup worked, and the answer is **no repo installed
   *                      yet** ⇒ block
   *   `failed: true`   → **the lookup did not work** (network, the vendor changed
   *                      the tool) ⇒ let it through and say so honestly
   * Merging the two either blocks someone who did install, or waves through
   * someone who did not.
   */
  armRepos: (catalogId: string, account: string) =>
    call<{ login: string; installed: string[]; seen: number } | { failed: true }>(
      '/api/arms/repos',
      { method: 'POST', body: JSON.stringify({ catalogId, account }) },
    ),

  /** Workspaces linked for one catalogue entry. NAME + LABEL, never a token. */
  oauthAccounts: (forCatalog?: string) =>
    call<{ accounts: OAuthAccount[] }>(
      `/api/oauth/accounts${forCatalog ? `?for=${enc(forCatalog)}` : ''}`,
    ),

  /**
   * Forget a workspace. The server revokes at the service (if the service accepts
   * that) and then deletes the key on this machine — and **refuses** while any
   * connection is still using it.
   */
  oauthForget: (name: string) =>
    call<{ accounts: OAuthAccount[] }>(`/api/oauth/accounts/${enc(name)}`, { method: 'DELETE' }),

  /**
   * Plug in an arm. Do NOT send an `id` — the identity is a **hash of the
   * config**, generated by the server. The client only sends the display name.
   * → `catalog.ts §armHash`
   */
  addArm: (body: {
    label?: string;
    /** Reuse an entry already in the ledger — see `testArm`. Label and key both come from it. */
    armId?: string;
    /** Send the config directly (the "custom" path)… */
    config?: unknown;
    /** …or let the SERVER build it from the catalogue — the package version lives in one place. */
    catalogId?: string;
    folders?: string[];
    secrets?: Record<string, string>;
    /** The chosen OAuth account — a key name, carrying the `workspace_id`. */
    account?: string;
    /**
     * Access level. **It feeds `armHash`** ⇒ a different level is a DIFFERENT
     * arm, and that is precisely what makes "change the level in this office"
     * leave every other office alone.
     */
    level?: 'read' | 'add' | 'full';
    office?: string;
    groups?: string[];
    options?: string[];
    /** Who it is granted to — in the SAME request as plugging it in, see `Office.grantArm`. */
    grantTo?: string[];
  }) => call<{ id: string; arms: InstalledArm[]; canvas?: CanvasState }>('/api/arms', {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  /**
   * Open an ORDINARY browser window on the office's profile so the user can sign
   * in themselves. Not through Playwright — see core/browser-login.ts.
   */
  browserLogin: (office: string, url?: string) =>
    call<{ ok: true; profile: string }>('/api/browser-login', {
      method: 'POST',
      body: JSON.stringify({ office, ...(url ? { url } : {}) }),
    }),

  /** Rename — touches only the label in the shared ledger: no key change, no migration. */
  renameArm: (id: string, label: string) =>
    call<{ label: string }>(`/api/arms/${enc(id)}`, { method: 'PATCH', body: JSON.stringify({ label }) }),

  /** Withdraw from ONE office. The shared ledger is untouched — plug it in again and it is there. */
  removeArm: (id: string, office: string) =>
    call<{ arms: InstalledArm[] }>(`/api/arms/${enc(id)}?office=${enc(office)}`, { method: 'DELETE' }),

  /**
   * DELETE FOR GOOD from the shared ledger — **not recoverable**. Only for
   * `orphan` entries.
   *
   * ⚠ It does not delete the key: keys live BY NAME in `.state/secrets.json`,
   * independent of the ledger. Plugging in again from the catalogue is three
   * clicks; going back for a token is not.
   */
  forgetArm: (id: string) =>
    call<{ arms: InstalledArm[] }>(`/api/arms/${enc(id)}?forget=1`, { method: 'DELETE' }),

  createOffice: (name: string) =>
    call<{ id: string }>('/api/office', { method: 'POST', body: JSON.stringify({ name }) }),

  /** DELETE the whole directory. The "archive" step is `patchOffice({ archived: true })`. */
  removeOffice: (id: string) => call<{ ok: true }>(`/api/office/${enc(id)}`, { method: 'DELETE' }),

  archivedAgents: (id: string) =>
    call<{ agents: ArchivedAgent[] }>(`/api/office/${enc(id)}/archived`),

  /** Archive or bring back an employee. The yaml file does not move. */
  archiveAgent: (id: string, role: string, archived: boolean) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived }),
    }),

  office: (id: string) => call<OfficeDetail>(`/api/office/${enc(id)}`),

  /**
   * Rename the office and/or change the assistant's model tier. Both live in
   * office.yaml. `assistant_tier: null` = drop the override and fall back to the
   * company default.
   */
  patchOffice: (
    id: string,
    patch: {
      name?: string;
      assistant_tier?: string | null;
      /** The assistant's display name. In no prompt → it cannot break the cache. */
      assistant_name?: string;
      archived?: boolean;
    },

  ) =>
    call<{
      id: string;
      name: string;
      archived: boolean;
      canvas: CanvasState;
      offices: OfficeSummary[];
    }>(`/api/office/${enc(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  /** Which tier runs which model — company-level, affecting EVERY office. */
  updateModels: (models: Partial<CompanyModels>) =>
    call<{ models: CompanyModels }>('/api/company', {
      method: 'PATCH',
      body: JSON.stringify({ models }),
    }),

  /**
   * The company's own name — the title in the top-left corner.
   *
   * ⚠ Sending `''` is a real instruction, not a no-op: it returns the title to
   * the default label. The reply carries what the server settled on (trimmed,
   * or the default when empty), which is what the header must draw.
   * → `Company.updateName`
   */
  setCompanyName: (name: string) =>
    call<{ name: string }>('/api/company', {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),

  /**
   * Interface language. → docs/CLAUDE.md §Language
   *
   * ⚠ Interface only. Nothing here reaches a prompt, and it must stay that way:
   * the assistant follows the language the user writes in, which this setting
   * cannot know.
   */
  setLanguage: (language: Locale) =>
    call<{ language: Locale }>('/api/company', {
      method: 'PATCH',
      body: JSON.stringify({ language }),
    }),

  canvas: (id: string) => call<CanvasState>(`/api/office/${enc(id)}/canvas`),

  /**
   * Every key is optional and ABSENT MEANS "leave it alone" — the server
   * distinguishes absent from empty. That is what lets a costume change send
   * only `cast`, and a node drag send only `nodes`/`edges`, without either one
   * wiping the other. → `src/core/layout.ts §save`
   */
  saveCanvas: (
    id: string,
    payload: { nodes?: unknown; edges?: unknown; cast?: unknown; tint?: unknown },
  ) =>
    call<CanvasState>(`/api/office/${enc(id)}/canvas`, { method: 'PUT', body: JSON.stringify(payload) }),

  addAgent: (id: string, input: { display_name: string; pitch: string; tier: string }) =>
    call<{ id: string; canvas: CanvasState }>(`/api/office/${enc(id)}/agent`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  editAgent: (
    id: string,
    role: string,
    patch: {
      display_name?: string;
      avatar?: string;
      pitch?: string;
      model_tier?: string;
      /** `0` = no limit. */
      max_usd?: number;
      max_turns?: number;
      /** Turn on `Bash` — buys file metadata (size · modified date) and running scripts. */
      bash?: boolean;
    },
  ) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  /** DELETE the roles/<id>.yaml file. The "archive" step is `archiveAgent`. */
  removeAgent: (id: string, role: string) =>
    call<{ canvas: CanvasState }>(`/api/office/${enc(id)}/agent/${enc(role)}`, { method: 'DELETE' }),

  say: (id: string, message: string) =>
    call<{ intent: string; reply: string }>(`/api/office/${enc(id)}/say`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  stop: (id: string) => call<{ ok: true }>(`/api/office/${enc(id)}/stop`, { method: 'POST' }),

  knowledge: (id: string) => call<{ nodes: KnowledgeEntry[] }>(`/api/office/${enc(id)}/knowledge`),

  /**
   * Edit or delete one note. The id travels in the BODY, not in the path — an id
   * contains `/` (`k/agents/assistant/…`), and putting that in a path means
   * several layers of encoding, one of which eventually gets forgotten.
   */
  editKnowledge: (id: string, nodeId: string, patch: { body?: string; remove?: boolean }) =>
    call<{ nodes: KnowledgeEntry[] }>(`/api/office/${enc(id)}/knowledge`, {
      method: 'PATCH',
      body: JSON.stringify({ id: nodeId, ...patch }),
    }),

  // ── the library → docs/SPEC-library.md §13

  /** Rescan the directory and return the list. No watcher — see SPEC §9.1. */
  library: (id: string) => call<{ docs: LibraryDoc[] }>(`/api/office/${enc(id)}/library`),

  /**
   * Upload one document. The body is the RAW content; the name rides on the query
   * string.
   *
   * DELIBERATELY not `FormData`/multipart: that forces the server to parse
   * boundaries, decode the filename and handle chunks split across a boundary —
   * i.e. another library, for something we do not need. Here one request is one
   * file, and that is the entire protocol.
   *
   * `replace` is a CONSCIOUS decision by the user after seeing the question; it is
   * never set automatically.
   */
  uploadDoc: (id: string, file: File, replace = false) =>
    call<{ doc: LibraryDoc; docs: LibraryDoc[] }>(
      `/api/office/${enc(id)}/library?name=${enc(file.name)}${replace ? '&replace=1' : ''}`,
      { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } },
    ),

  /**
   * Re-extract a document that is not usable yet. → SPEC-library.md §4.5
   *
   * It exists because `state` is a record of THE PAST while the cause is
   * fixable: a PDF stuck at `unindexed` because the machine had no reader must be
   * re-extractable once the reader is there, instead of making the user delete
   * and re-drop their own file.
   */
  libraryReextract: (id: string, name: string) =>
    call<{ docs: LibraryDoc[] }>(
      `/api/office/${enc(id)}/library/reextract?name=${enc(name)}`,
      { method: 'POST' },
    ),

  /** Delete for good. One step only — a document is the user's own file (SPEC §6). */
  removeDoc: (id: string, name: string) =>
    call<{ docs: LibraryDoc[] }>(`/api/office/${enc(id)}/library?name=${enc(name)}`, {
      method: 'DELETE',
    }),

  docUrl: (id: string, name: string) => `/api/office/${enc(id)}/library/file?name=${enc(name)}`,

  // ── artifacts → docs/SPEC-artifacts.md
  //
  // DELIBERATELY no `upload`. This is not a second library: there is no path from
  // the interface that turns an artifact back into an input for an employee. To
  // reuse one, the user hands it over themselves.

  /**
   * Scan the artifacts directory. No catalogue — the files are written by
   * employees while they work.
   *
   * `artifacts` is the **newest 500 by `mtime`**; `total` is the real count. The
   * two are separate because the server truncates the payload, not the truth: the
   * interface has to be able to say *"showing 500 of 712"*. `capped` = the
   * directory is so large that even the scan had to stop (≥ 20,000 files) — at
   * which point `total` is a floor, not a total.
   */
  artifacts: (id: string) =>
    call<{ artifacts: ArtifactRecord[]; total: number; capped: boolean }>(
      `/api/office/${enc(id)}/artifacts`,
    ),

  /**
   * The office directory's path — and the server OPENS it when the browser is on
   * the same machine as the daemon.
   *
   * `opened: false` is the NORMAL case over a remote connection (VPS, Docker), not
   * an error: "open the folder" would open it on THE HOST rather than the machine
   * being looked at, so the server deliberately does nothing. The interface falls
   * back to copying the path.
   */
  revealOffice: (id: string) =>
    call<{ dir: string; opened: boolean }>(`/api/office/${enc(id)}/reveal`, { method: 'POST' }),

  /**
   * An artifact's URL. `download` separates VIEWING from DOWNLOADING, and the
   * difference is real: viewing is size-capped and carries the right
   * `content-type` so the browser renders it; downloading is always
   * `octet-stream` + `content-disposition`.
   */
  artifactUrl: (id: string, p: string, download = false) =>
    `/api/office/${enc(id)}/artifacts/file?path=${enc(p)}${download ? '&download=1' : ''}`,

  /** Delete for good. One step — but unlike the library, THIS IS THE ONLY COPY. */
  removeArtifact: (id: string, p: string) =>
    call<{ artifacts: ArtifactRecord[]; total: number; capped: boolean }>(
      `/api/office/${enc(id)}/artifacts?path=${enc(p)}`,
      { method: 'DELETE' },
    ),

  /**
   * Empty the Results panel. `all=1` is EXPLICIT — the server deliberately does
   * not read "no path" as "delete everything". Only this panel has this button;
   * the library and the knowledge store do not. → `artifacts.ts §removeAll`
   */
  clearArtifacts: (id: string) =>
    call<{ removed: number; artifacts: ArtifactRecord[]; total: number; capped: boolean }>(
      `/api/office/${enc(id)}/artifacts?all=1`,
      { method: 'DELETE' },
    ),

  /**
   * ONE arm's AUDIT LOG — every MCP call, with its arguments.
   * → `core/audit.ts` · SPEC-arms §6k
   *
   * This is what **replaces** per-call approval: drop the gate and the log has to
   * be complete, or we have just dropped both.
   */
  armLog: (id: string, server: string) =>
    call<{ calls: ArmCall[] }>(`/api/office/${enc(id)}/arm-log?server=${enc(server)}`),

  plans: (id: string) => call<{ plans: PlanRecord[] }>(`/api/office/${enc(id)}/plans`),

  plan: (id: string, planId: string) =>
    call<{ plan: PlanRecord; log: AgentEvent[] }>(`/api/office/${enc(id)}/plans/${enc(planId)}`),

  prompt: (id: string, who: string) =>
    call<{ layers: PromptLayer[]; editable: boolean }>(`/api/office/${enc(id)}/prompt/${enc(who)}`),

  savePromptLayer: (id: string, who: string, layer: string, text: string) =>
    call<{ layers: PromptLayer[] }>(`/api/office/${enc(id)}/prompt/${enc(who)}/${enc(layer)}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),

  cost: () =>
    call<{
      text: string;
      byOffice: Array<{
        office: string;
        name: string;
        tasks: number;
        costUSD: number;
        turns: number;
        /** The office is still there, but archived. */
        archived: boolean;
        /** The office is gone from disk, or the record predates offices being separate. */
        gone: boolean;
      }>;
    }>('/api/cost'),

  /** Purge `gone` entries from the cost ledger. Returns exactly what was lost, so it can be said. */
  purgeGoneCost: () =>
    call<{ offices: number; tasks: number; costUSD: number }>('/api/cost/purge', {
      method: 'POST',
    }),

  shutdown: () => call<{ ok: true }>('/api/shutdown', { method: 'POST' }),
};
