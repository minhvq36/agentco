/**
 * App-wide state. A hand-written store over `useSyncExternalStore` — no library.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE PERFORMANCE CONSTRAINT: node coordinates DURING A DRAG never pass    │
 * │ through this store. The canvas writes `transform` straight onto the DOM  │
 * │ through a ref and commits to the store once, on pointer up. One          │
 * │ `setState` per drag frame = re-rendering the whole React tree 60 times a │
 * │ second, and the "Performance" bar asks for 60fps EVEN WHILE the company  │
 * │ is working (i.e. while SSE events are arriving continuously).            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { useSyncExternalStore } from 'react';

import { api, ApiError } from './api';
import type {
  AgentEvent,
  CanvasEdge,
  CanvasState,
  CompanyView,
  Energy,
  OfficeState,
  PlanStep,
  StepStatus,
  Usage,
  Locale,
  WorkPlace,
} from './types';
import { plural, resolveLocale, setLocale, t } from '@i18n';

import { mergeUserEcho } from './chat-echo';
import { replayable } from './replay';
import { applyTheme, bootTheme, type Theme } from './theme';

export interface ChatMessage {
  id: number;
  /**
   * 'user' · 'assistant' · **or AN EMPLOYEE's id**.
   *
   * The third case since 19/08: a `deliver: reply` task sends the answer straight
   * from the employee to the user, not through the assistant. The chat panel only
   * separates 'user' out; every other role shares the left-hand bubble and differs
   * only in the name label, looked up with `labelFor(role)`.
   * → docs/SPEC-offices.md §6
   */
  role: string;
  text: string;
  at: number;
  /**
   * VERIFIED artifact paths riding along with the message (relative to the office
   * directory).
   *
   * Present only on messages `whereBlock` assembles — i.e. built by CODE, not by
   * the model. This is the only list allowed to become clickable; see `FileLinks`
   * in ChatPanel.
   */
  files?: string[];
  /**
   * Drawn before the server confirmed it, and not yet settled by the echo.
   *
   * Only ever set on a `role: 'user'` bubble this tab just sent. The key is
   * REMOVED once the echo arrives, so "pending" is never a stale label sitting
   * on a message that really did land. → `mergeUserEcho`
   */
  pending?: boolean;
}

/** An agent's live state. Kept outside the DOM so it survives every render. */
export interface LiveAgent {
  status: 'working' | 'done' | 'error';
  say: string;
  /**
   * Where this person's last tool call landed, straight off `task.progress`.
   * → docs/SPEC-office-animation.md §6
   *
   * ⚠ `undefined` means NO PLACE — a turn that called no tool. The office view
   * must leave that person exactly where they are; substituting a default here
   * would turn "we did not observe a place" into "they went to the desk", and
   * the picture would be stating something nobody saw.
   */
  at?: WorkPlace;
  /** Which arm, when `at === 'arm'`. */
  arm?: string;
  /**
   * How many files the finished task produced. Set ONLY on `task.done`.
   *
   * It is the difference between a worker walking to the filing desk to put
   * something down and one that has nothing to put down — a `deliver: reply`
   * task answers and lands no file.
   */
  artifacts?: number;
}

export type PanelId =
  | 'chat'
  | 'plans'
  | 'overview'
  | 'knowledge'
  | 'library'
  | 'artifacts'
  | 'settings';

export interface AppState {
  /**
   * INTERFACE language. Lives in state ONLY so React re-renders on a change —
   * the real value is `getLocale()` in `src/i18n/`, and the server's
   * `company.yaml` is what persists it.
   *
   * ⚠ Never passed to the backend as part of a task, a message, or anything a
   * model reads. It says what the screen shows, not what language the user
   * speaks. → docs/CLAUDE.md §Language
   */
  locale: Locale;
  /**
   * LIGHT · DARK · FOLLOW THE MACHINE. → `lib/theme.ts`
   *
   * ⚠ Here ONLY so the radio group in Settings can draw a dot next to the right
   * row. What the screen actually looks like is decided by an attribute on
   * `<html>` and the stylesheet — nothing in React reads this to paint.
   *
   * ⚠ And unlike `locale`, the server never hears about it: this is one
   * browser's view state, the same class as `agentco:view`. Two machines
   * looking at one company are allowed to disagree about the lights.
   */
  theme: Theme;
  loading: boolean;
  /**
   * The daemon was shut down FROM THIS SCREEN, and the user confirmed it.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ IT MUST OUTRANK `fatal`, AND THAT IS THE WHOLE POINT OF THE FLAG.        │
   * │                                                                          │
   * │ Shutting down kills the SSE stream a beat later, so `es.onerror` sets    │
   * │ `fatal: "lost connection to the company"` — an alarm, with a Retry       │
   * │ button, for something the user just asked for on purpose. Without a way  │
   * │ to tell the two apart, the last thing anyone sees when they close the    │
   * │ company down is an error screen.                                         │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  poweredOff: boolean;
  /** A company-level error (daemon lost, config broken). It blocks the whole screen. */
  fatal: string | null;
  /** A passing error — shown as a toast, blocking nothing. */
  toast: { text: string; kind: 'error' | 'info' } | null;

  company: CompanyView | null;
  officeId: string | null;

  canvas: CanvasState | null;
  officeState: OfficeState;
  plan: { plan_id: string; request: string; steps: PlanStep[] } | null;

  messages: ChatMessage[];
  /** How many messages have been read. The "new message" dot must tell the truth, or drop it entirely. */
  seenMessages: number;
  live: Record<string, LiveAgent>;
  cost: (Usage & { tasks: number }) | null;
  /**
   * The Claude ACCOUNT limit. → src/core/energy.ts
   *
   * ⚠ It sits right next to `cost` and has the OPPOSITE lifetime, which is where
   * this goes wrong most easily: `cost` is one office's spend in this session, so
   * switching offices clears it; `energy` is a limit shared with the user's own
   * Claude Code and claude.ai, so switching offices must NOT clear it. Clearing it
   * deletes a fact that is still true and leaves the header blank until the next
   * run.
   */
  energy: Energy | null;
  sending: boolean;

  /**
   * THE DRAFT being typed in the chat box. It LIVES outside the component, and has
   * a copy on disk.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ FIXED BUG (20/08): type half a request, open the Library tab to check a  │
   * │ path, come back — ALL GONE.                                              │
   * │                                                                          │
   * │ The sidebar mounts panels with `{panel === 'chat' && <ChatPanel />}`, so │
   * │ a tab switch is an **unmount**, and a draft held in that component's     │
   * │ `useState` dies with it. That is exactly the thing people do most while  │
   * │ composing a long request: go look up a filename and come back.           │
   * │                                                                          │
   * │ It belongs to the project's worst class of bug — **losing the user's     │
   * │ work, silently**. No message of any kind, and they only notice when they │
   * │ look at the empty box.                                                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Fixed at the STATE LAYER rather than by keeping the panel mounted
   * (`hidden`): hiding means every other panel has to live forever too, and we
   * would have traded one bug for six component trees that are never torn down.
   *
   * The `localStorage` copy covers the second case — **F5, a tab crash, closing
   * the wrong window**. The same pain, and fixing only the in-memory half teaches
   * the user a false rule ("switching tabs is safe") until they lose the lot on an
   * accidental reload.
   */
  draft: string;
  /**
   * A sentence describing what is happening, shown inside the chat frame.
   *
   * Without it, the gap between pressing Send and the assistant answering is 5–15
   * seconds of silence and the user cannot tell whether the system received
   * anything. This is the same thing Telegram calls "typing…" — see
   * SPEC-offices.md §9.
   */
  activity: string | null;

  /**
   * Incremented whenever the library changes. → docs/SPEC-library.md §10
   *
   * Text extraction runs in the background and takes seconds for a thick PDF, so
   * the panel cannot load once on open. A counter rather than the list itself in
   * the store: the list has exactly one reader, while the store has every
   * component listening — pushing it in here re-renders the whole tree because one
   * row changed state.
   */
  libraryVersion: number;

  /**
   * How many documents are being extracted RIGHT NOW. → docs/SPEC-library.md §10
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE LIBRARY'S STATE, NOT THE CONVERSATION'S STATE.                       │
   * │                                                                          │
   * │ The previous version put "Reading N documents…" into `activity` — the    │
   * │ chat box's status line. Two mistakes at once:                            │
   * │                                                                          │
   * │  1. WRONG PLACE. The user just dropped a file into the library and asked │
   * │     the assistant nothing, yet the chat box reports itself busy. Work    │
   * │     happening in the library shows in the library.                       │
   * │  2. IT NEVER TURNS OFF. When `busy` reaches 0 that branch stops setting  │
   * │     `activity` — it simply writes nothing, so the old string sits on     │
   * │     screen until the user happens to send a message and overwrite it.    │
   * │     The same class as "/help's dots spin forever": switchable on, not    │
   * │     off.                                                                 │
   * │                                                                          │
   * │ A NUMBER, not a flag: the interface has to be able to say "3 files left" │
   * │ rather than only "busy".                                                 │
   * │                                                                          │
   * │ What the chat REALLY needs to know is untouched and does not come        │
   * │ through here: when a run has to wait for extraction, `office.run()`      │
   * │ emits its own `office.state` saying "Reading document X…". That is the   │
   * │ moment where silence misleads.                                           │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  libraryBusy: number;

  /**
   * Incremented whenever the knowledge store changes.
   *
   * ⚠ Before 19/08 `KnowledgePanel` watched `canvas.knowledge.total` — a COUNT,
   * not an event. It only reloaded when the number of nodes changed, so every
   * change that kept the count was invisible until the user pressed F5: editing a
   * note's body, one node superseding another, pruning one and adding one.
   * Counting is not knowing that something changed.
   */
  knowledgeVersion: number;

  /**
   * Incremented whenever a new artifact appears. → docs/SPEC-artifacts.md
   *
   * No dedicated server event is needed: artifacts only appear when a job
   * finishes, and `task.done` / `plan.finished` have already arrived. Adding
   * another event to say the same thing adds another place that can disagree.
   */
  artifactsVersion: number;

  /**
   * The shared arm ledger just changed — plugged in · withdrawn · deleted for good
   * · **a sign-in completed**. The connect dialog watches this number to reload the
   * list of OAuth accounts.
   */
  armsVersion: number;

  /**
   * The OAuth account name saved by the sign-in that caused the latest
   * `armsVersion` bump — `null` when the bump came from anything else
   * (plugging in, withdrawing, deleting).
   *
   * It rides alongside `armsVersion` rather than being derived later because
   * it is the ONE thing the dialog cannot work out for itself: re-authorising
   * an account that already exists adds no new name to the list, so a
   * list-diff cannot tell **which** account was just repaired — and gets it
   * wrong precisely when someone signs in as a different account by mistake.
   */
  linkedAccount: string | null;

  /**
   * Files just dropped onto the library node, waiting for the panel to take them.
   *
   * The canvas does NOT upload. The whole upload flow — asking on a name clash,
   * the per-extension refusals, extraction state — lives in exactly ONE place,
   * `LibraryPanel`. This field is the conveyor between two entrances, not a second
   * copy of the logic: with two copies, the day the name-clash rule changes one
   * gets fixed and the other is forgotten.
   */
  pendingDocs: File[] | null;

  /**
   * An artifact the user just clicked in the chat, waiting for the Results panel to
   * open it.
   *
   * Same shape as `pendingDocs` and for the same reason: the whole preview flow —
   * fetching the content, three format groups, the 2MB cap, the download button —
   * lives in exactly ONE place, `ArtifactsPanel`. This field is the conveyor
   * between two entrances, not a second copy of that logic.
   */
  revealArtifact: string | null;

  panel: PanelId | null;
  /** The node selected on the canvas (a node id, not a role id). */
  selected: string | null;

  /**
   * WHICH VIEW of the office is open — the diagram, or the room.
   * → docs/SPEC-office-animation.md §11a
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ `localStorage`, NOT the server. Identical reasoning to `agentco:office`:  │
   * │ two tabs on two views is perfectly legal, and putting this on the server  │
   * │ has one tab kicking the other. What the SERVER holds is a different       │
   * │ question — `company.officeView` says whether this door exists at all.     │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * Defaults to the diagram: a new office is an empty room, and the diagram is
   * where a company gets built. The choice sticks once made.
   */
  view: 'diagram' | 'office';

  /**
   * The assistant's HIDDEN WORKER is running, and which shape it is.
   * → `SPEC-offices.md` §6c · SPEC-office-animation §6c②
   *
   * Read straight off `office.activity.reading`, never inferred from the
   * presence of `note` — which is a localized sentence and would make this
   * work in exactly the language it was tested in.
   */
  assistantReading: 'library' | 'web' | null;
}

/**
 * 🔴 EVERY KEY A `boot*()` READS IS DECLARED HERE, ABOVE `initial`. DO NOT MOVE
 * THEM BACK DOWN BESIDE THE FUNCTION THAT USES THEM.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MEASURED 07/09, IN THE BUILT BUNDLE — BOTH PREFERENCES WERE DEAD.        │
 * │                                                                          │
 * │ `initial` calls `bootLocale()` and `bootView()` while the object literal │
 * │ is being built. Both key constants used to be declared 80 and 110 lines  │
 * │ BELOW it. A function declaration hoists; a `const` initialiser does not, │
 * │ and the bundler emits these as `var`, so at call time the key was        │
 * │ `undefined` — not an error, just `localStorage.getItem(undefined)`,      │
 * │ which reads a key named `"undefined"`, finds nothing, and falls back.    │
 * │                                                                          │
 * │ ⚠ SO `agentco:view` WAS WRITTEN CORRECTLY AND NEVER READ. Reproduced     │
 * │ cold: set the key, load the page, land on the diagram — the switch       │
 * │ looked like it did not remember anything. `agentco.locale` had exactly   │
 * │ the same wound; it was invisible because `/api/company` corrects the     │
 * │ language a moment later, so the only symptom was a flash.                │
 * │                                                                          │
 * │ ⚠ AND THE `try/catch` IS WHAT HID IT. It was written for "the browser    │
 * │ blocks site data", and it swallowed a completely different failure into  │
 * │ the same silent fallback. Nothing threw; there was simply nothing to     │
 * │ throw. A `catch` is where a wrong premise hides.                         │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const LOCALE_KEY = 'agentco.locale';
const VIEW_KEY = 'agentco:view';

const initial: AppState = {
  locale: bootLocale(),
  // ⚠ `bootTheme` STAMPS the attribute as it reads — see the box in `theme.ts`.
  // Its key lives in that module, which is why it is not in the pair above.
  theme: bootTheme(),
  loading: true,
  poweredOff: false,
  fatal: null,
  toast: null,
  company: null,
  officeId: null,
  canvas: null,
  officeState: 'idle',
  plan: null,
  messages: [],
  seenMessages: 0,
  live: {},
  cost: null,
  energy: null,
  sending: false,
  draft: '',
  activity: null,
  libraryVersion: 0,
  libraryBusy: 0,
  knowledgeVersion: 0,
  artifactsVersion: 0,
  armsVersion: 0,
  linkedAccount: null,
  pendingDocs: null,
  revealArtifact: null,
  panel: null,
  selected: null,
  view: bootView(),
  assistantReading: null,
};

let state: AppState = initial;
const listeners = new Set<() => void>();
let msgSeq = 0;

/**
 * The draft on disk — ONE SLOT PER OFFICE.
 *
 * Share one key and a half-written request in the Accounting office turns up in
 * someone else's chat box after a hop to Content. Offices being fully independent
 * is the product's founding rule; it has to hold in small places like this too.
 *
 * Every call swallows its error: `localStorage` throws when the quota is full or
 * when the browser blocks cookies/storage. A draft that fails to save is a shame;
 * a white screen because of one is not acceptable.
 */
const draftKey = (officeId: string): string => `agentco:draft:${officeId}`;

/**
 * The office currently open — remembered across F5 and across closing the tab.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ BUG 21/08: `officeId` lived only IN MEMORY.                               │
 * │                                                                           │
 * │ `bootstrap` keeps the previous choice (`state.officeId`) — but after F5   │
 * │ the state has reset, `officeId` is `null`, so it always falls back to     │
 * │ `company.offices[0]` = the alphabetically first office. The user leaves   │
 * │ from "Contract review" and comes back to "Localisation", every time.      │
 * │                                                                           │
 * │ The same class as "the model remembers, the screen forgets": state living │
 * │ in RAM is gone the moment things close, and the user has no way to know   │
 * │ why.                                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `localStorage`, not the server: this is one specific browser's VIEW STATE. Two
 * tabs open on two different offices is perfectly legal, and putting this on the
 * server has one tab kicking the other.
 */
/**
 * Interface language, mirrored into the browser SO THE FIRST PAINT IS RIGHT.
 *
 * The authority is `company.yaml`, read over `GET /api/company` — but that is a
 * round trip, and until it lands the app has already drawn a sidebar full of
 * labels. Without this mirror every reload flashes the default language and
 * then swaps, which reads as a rendering bug, not as loading.
 *
 * Same defensive shape as every other key here: `localStorage` throws when the
 * browser blocks site data, and a language preference is never worth a white
 * screen. Missing or unreadable ⇒ fall back and let the fetch correct it.
 */
function bootLocale(): Locale {
  let locale: Locale;
  try {
    locale = resolveLocale([localStorage.getItem(LOCALE_KEY), navigator.language], 'vi');
  } catch {
    locale = resolveLocale([], 'vi');
  }
  // The catalogue is module state, not React state: set it here or the very
  // first render reads a different language from the one this function chose.
  setLocale(locale);
  return locale;
}

/** Apply a locale everywhere at once: the catalogue, the mirror, and React. */
function applyLocale(locale: Locale): void {
  setLocale(locale);
  try {
    localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    /* blocked storage — the server still knows, so only the first paint suffers */
  }
  set({ locale });
}

/**
 * The view chosen last time. Same class of state as `agentco:office` and stored
 * the same way — losing it on F5 would drop somebody back into the diagram every
 * time they reload, which reads as the switch not working.
 *
 * ⚠ Swallows its own error, like every other `localStorage` call in this file:
 * a private window or blocked site data must cost a preference, never a white
 * screen.
 */
function bootView(): 'diagram' | 'office' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'office' ? 'office' : 'diagram';
  } catch {
    return 'diagram';
  }
}

const LAST_OFFICE = 'agentco:office';

function readLastOffice(): string | null {
  try {
    return localStorage.getItem(LAST_OFFICE);
  } catch {
    return null;
  }
}

function writeLastOffice(id: string): void {
  try {
    localStorage.setItem(LAST_OFFICE, id);
  } catch {
    /* quota full / private mode — forgetting this is not worth crashing anything */
  }
}

function readDraft(officeId: string): string {
  try {
    return localStorage.getItem(draftKey(officeId)) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(officeId: string | null, text: string): void {
  if (!officeId) return;
  try {
    if (text) localStorage.setItem(draftKey(officeId), text);
    else localStorage.removeItem(draftKey(officeId));
  } catch {
    /* out of room or blocked — the in-memory copy still works correctly */
  }
}

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(initial),
  );
}

export function getState(): AppState {
  return state;
}

/**
 * A role's display name, so a human can read the log.
 *
 * The user names employees freely; `role.id` is the slugified form used for the
 * filename, so a display name and its id genuinely differ — "Người viết" becomes // i18n-allow-vietnamese: the pair IS the example
 * "nguoi-viet".
 * The log shows the name the user chose.
 *
 * COLOUR is still hashed from `id`, not from the name: renaming must not change
 * the colour — the eye has already tied colour to person. And old log lines for a
 * deleted role still carry the `id` to trace, so an unresolvable lookup falls back
 * to the `id` rather than to nothing.
 */
export function labelFor(roleId: string): string {
  if (roleId === 'user') return t('chat.you');
  if (roleId === 'assistant') {
    const node = state.canvas?.nodes.find((n) => n.kind === 'assistant');
    // The node label is the name THE USER gave their assistant — never
    // translated. `t()` only supplies the fallback for an office with no canvas.
    return node?.label ?? t('chat.assistant');
  }
  const node = state.canvas?.nodes.find((n) => n.role === roleId);
  return node?.label ?? roleId;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'error' | 'info' = 'error'): void {
  set({ toast: { text, kind } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), 6000);
}

/**
 * Wraps every API call. The backend already returned a sentence that explains
 * itself — the job here is to show it, not swallow it. Losing the daemon blocks
 * the whole screen because every next action is meaningless; any other error is
 * reported and that is all.
 */
async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof ApiError && err.status === 0) set({ fatal: msg });
    else toast(msg);
    return undefined;
  }
}

/** The pending `setTint` write. 0 = nothing scheduled. → `actions.setTint` */
let tintTimer = 0;

// ───────────────────────────────────────────────────────────────── actions

export const actions = {
  async boot(): Promise<void> {
    const company = await guard(() => api.company());
    if (!company) {
      set({ loading: false });
      return;
    }
    set({ company, fatal: null });
    // `company.yaml` is the authority; the browser mirror was only a guess to
    // get the first paint right. Correct it now, silently, if they disagree.
    if (company.language && company.language !== state.locale) applyLocale(company.language);

    if (company.offices.length === 0) {
      set({ loading: false, officeId: null, canvas: null });
      return;
    }
    /**
     * Three fallbacks in order: the office OPEN now → the office open LAST →
     * the first one.
     *
     * The second is new (21/08) and is what saves the F5 case: after a reload the
     * first always misses, because state has reset. It still has to be checked
     * against the real list — an office may have been deleted or archived in a
     * previous session, and opening an id that no longer exists is a white screen.
     */
    const wanted = [state.officeId, readLastOffice()].find(
      (id) => id && company.offices.some((o) => o.id === id),
    );
    await actions.openOffice(wanted ?? company.offices[0]!.id);
    set({ loading: false });
  },

  /** Open an office. Clears the previous office's state entirely — never mix two streams. */
  async openOffice(id: string): Promise<void> {
    // Write it IMMEDIATELY, before the load finishes: if the user closes the tab
    // mid-load they must still come back to the office they just chose.
    writeLastOffice(id);
    set({
      officeId: id,
      canvas: null,
      plan: null,
      messages: [],
      seenMessages: 0,
      live: {},
      cost: null,
      // ⚠ `energy` is DELIBERATELY absent here. The limit belongs to the ACCOUNT,
      // not to an office — clearing it on a switch deletes a fact that is still
      // true and leaves the header blank until the next run. → `AppState.energy`
      selected: null,
      // The library is PER OFFICE. Without clearing this, opening another office
      // still shows "reading 2 documents" from the one just left.
      libraryBusy: 0,
      // The draft is per office too: read back the slot belonging to the office
      // just opened, never carry a sentence being composed elsewhere into it.
      draft: readDraft(id),
      activity: null,
      loading: true,
    });

    const [canvas, detail] = await Promise.all([
      guard(() => api.canvas(id)),
      guard(() => api.office(id)),
    ]);
    if (!canvas || !detail) {
      set({ loading: false });
      return;
    }

    set({
      canvas,
      officeState: detail.state,
      plan: detail.plan,
      loading: false,
    });
    /**
     * Replay IN EXACTLY THIS ORDER, and never mix the two sources:
     *
     *  1. `chat`    — the conversation read from disk. This is what survives the
     *                 daemon stopping, and what makes the screen match what the
     *                 assistant still remembers.
     *  2. `history` — the daemon's in-memory ring buffer, for LIVE state (a plan
     *                 in flight, who is doing what). What it may NOT apply is
     *                 `replayable`'s list, and it is a list rather than the one
     *                 `e.type === 'master.message'` test it used to be: an
     *                 `office.cleared` still sitting in that buffer emptied the
     *                 chat pane on every reload, hours after the `/clear` that
     *                 caused it. → `replay.ts`
     */
    for (const e of detail.chat ?? []) applyEvent(e, false);
    for (const e of detail.history) {
      if (!replayable(e.type)) continue;
      applyEvent(e, false);
    }
  },

  /**
   * Reload the office list — and SELF-HEAL if the open office has vanished.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THIS IS WHAT SAVES THE "OTHER TAB" CASE, which a PATCH response cannot   │
   * │ reach.                                                                   │
   * │                                                                          │
   * │ Renaming an office can change its `id` (the directory moves with it). The│
   * │ tab that PRESSED the button gets the new `id` in the response and updates│
   * │ itself. But **a second tab** open on the same office calls nothing — it  │
   * │ only listens to SSE, and its `state.officeId` is still the old id. From  │
   * │ then on every call 404s, and the user sees a toast *"No such office …"*  │
   * │ for an action that succeeded.                                            │
   * │                                                                          │
   * │ So the invariant has to be: **`officeId` never points at an id the       │
   * │ server does not have.** Checked here because this is the ONLY place that │
   * │ knows the real list just changed — and it runs in every tab, not just the│
   * │ one that clicked.                                                        │
   * │                                                                          │
   * │ `hint` is `company.offices`'s `event.office`: it carries the NEW id, so  │
   * │ the other tab goes straight to the right office instead of falling back  │
   * │ to the first in the list.                                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  async refreshCompany(hint?: string): Promise<void> {
    const company = await guard(() => api.company());
    if (!company) return;
    set({ company });

    const id = state.officeId;
    if (!id || company.offices.some((o) => o.id === id)) return;
    // The open office is no longer in the list: either its id just changed (a
    // rename that moved the directory), or it was deleted in another tab. Both
    // have to move on; neither may sit on a dead id.
    const next = hint && company.offices.some((o) => o.id === hint) ? hint : company.offices[0]?.id;
    if (next) await actions.openOffice(next);
    else set({ officeId: null, canvas: null });
  },

  async refreshCanvas(): Promise<void> {
    const id = state.officeId;
    if (!id) return;
    const canvas = await guard(() => api.canvas(id));
    if (canvas) set({ canvas });
  },

  async createOffice(name: string): Promise<boolean> {
    const res = await guard(() => api.createOffice(name));
    if (!res) return false;
    const company = await guard(() => api.company());
    if (company) set({ company });
    await actions.openOffice(res.id);
    return true;
  },

  /**
   * Rename an office.
   *
   * The server returns the updated office list too, so no extra `GET /api/company`
   * round trip is needed; the picker at the top of the screen renames immediately.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE OFFICE ID CAN CHANGE WITH IT — hold on to `res.id`. (22/08)           │
   * │                                                                           │
   * │ Since 22/08, a rename whose new name yields a real slug **moves the       │
   * │ directory** and changes the `id` (`Company.renameTarget`). The previous   │
   * │ version of this block said *"the id is unchanged — nothing to reopen"*    │
   * │ and never touched `officeId`.                                             │
   * │                                                                           │
   * │ Without the fix, `state.officeId` still points at the OLD id: every call  │
   * │ after it (chat, canvas, library) goes to an office that no longer exists  │
   * │ and 404s — the user renames something and the screen dies, with nothing   │
   * │ explaining why.                                                           │
   * │                                                                           │
   * │ `writeLastOffice` has to follow as well, or reopening the app returns to  │
   * │ the id that just disappeared.                                             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  async renameOffice(name: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.patchOffice(id, { name }));
    if (!res) return false;
    const moved = res.id !== id;
    if (moved) writeLastOffice(res.id);
    set({
      ...(moved ? { officeId: res.id } : {}),
      canvas: res.canvas,
      company: state.company ? { ...state.company, offices: res.offices } : state.company,
    });
    return true;
  },

  /**
   * Change this office's assistant tier. `null` = follow the company default.
   *
   * Conversational memory is NOT lost: the session transcript is on disk and
   * independent of the model. What is lost is the prompt cache — the next turn
   * rewrites it once.
   */
  async setAssistantTier(tier: string | null): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.patchOffice(id, { assistant_tier: tier }));
    if (!res) return false;
    set({ canvas: res.canvas });
    return true;
  },

  /**
   * Change the assistant's display name. → `Office.renameAssistant`
   *
   * It differs from `setAssistantTier` in price even though the two buttons sit
   * side by side: the name is in NOBODY's prompt, so it rewrites no cache, loses
   * no memory and touches no session. Rename freely.
   */
  async renameAssistant(name: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.patchOffice(id, { assistant_name: name }));
    if (!res) return false;
    set({ canvas: res.canvas });
    return true;
  },

  /** COMPANY level: this reaches every office. */
  async updateModels(models: Record<string, string>): Promise<boolean> {
    const res = await guard(() => api.updateModels(models as never));
    if (!res) return false;
    set({ company: state.company ? { ...state.company, models: res.models } : state.company });
    await actions.refreshCanvas();
    return true;
  },

  /** Only sets a flag; no file moves. */
  async archiveOffice(id: string, archived: boolean): Promise<boolean> {
    const res = await guard(() => api.patchOffice(id, { archived }));
    if (!res) return false;
    // Archiving the office currently open means switching to another one — staying
    // makes every following action fail with "read only", and the user cannot see
    // why.
    if (archived && state.officeId === id) {
      set({ company: state.company ? { ...state.company, offices: res.offices } : state.company });
      const next = res.offices.find((o) => !o.archived && !o.error);
      if (next) await actions.openOffice(next.id);
      else set({ officeId: null, canvas: null });
      return true;
    }
    set({ company: state.company ? { ...state.company, offices: res.offices } : state.company });
    return true;
  },

  /** Not recoverable — the call site must confirm first. */
  async removeOffice(id: string): Promise<boolean> {
    /**
     * SAY SO when a connection has just been orphaned — **do not block**. (02/09)
     *
     * A connection is company-level property that an office only borrows, so
     * deleting an office must NOT touch it (delete A, unplug the connection, and
     * B's wire is cut). But saying nothing leaves that debt invisible until the day
     * the user goes looking for somewhere to remove it. One sentence plus the right
     * door is enough; adding a condition to the delete button blocks a legitimate
     * action over something that does not belong to it.
     *
     * ┌──────────────────────────────────────────────────────────────────────┐
     * │ 🔴 THE DELTA, NOT THE TOTAL. (user 05/09)                            │
     * │                                                                      │
     * │ This read `arms()` only AFTER the delete and counted every orphan in  │
     * │ the company. A real company had 19 connections, most never wired to   │
     * │ anyone — so deleting ANY office announced *"17 connections are now    │
     * │ unused"*, including when that office had orphaned exactly zero.       │
     * │                                                                      │
     * │ The sentence says "**now** unused", so it is a claim about what this  │
     * │ action just did. Answering it with a standing total is the same       │
     * │ mismatch class as a `[done]` written over a `blocked` receipt: the    │
     * │ number is real, it just does not answer the question asked. Worse, a  │
     * │ toast that fires on every delete teaches the user to ignore the one   │
     * │ time it matters.                                                     │
     * │ → [[agentco-detect-fix-pair-scope]]                                  │
     * │                                                                      │
     * │ ⚠ Two reads, not one, and the BEFORE read has to happen before the    │
     * │ delete call — there is no other moment that fact still exists.        │
     * │ It costs one extra GET on an action the user takes once in a while.   │
     * └──────────────────────────────────────────────────────────────────────┘
     */
    const before = await api.arms().catch(() => null);
    const wasOrphan = new Set(before?.arms.filter((a) => a.orphan).map((a) => a.id) ?? []);

    const ok = await guard(() => api.removeOffice(id));
    if (!ok) return false;
    if (state.officeId === id) set({ officeId: null });
    await actions.boot();

    // `before === null` ⇒ we never learned the starting point, so every orphan
    // would look new. Say nothing rather than announce a number we cannot stand
    // behind — a wrong count here is what this whole box is about.
    if (before) {
      const r = await api.arms().catch(() => null);
      const n = r?.arms.filter((a) => a.orphan && !wasOrphan.has(a.id)).length ?? 0;
      if (n > 0) toast(t('toast.unusedArms', { n }));
    }
    return true;
  },

  /** Restoring returns them to the same office — they never left it. */
  async archiveAgent(role: string, archived: boolean): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.archiveAgent(id, role, archived));
    if (!res) return false;
    set({ canvas: res.canvas, ...(archived ? { selected: null } : {}) });
    void actions.refreshCompany();
    return true;
  },

  /**
   * Persist the diagram.
   *
   * `optimistic` = draw first, send after. Used for EDGES: they are discrete, one
   * at a time, and the user has just released the pointer, so the wire has to
   * appear immediately — waiting a network round trip to show it is precisely what
   * the "Smooth" bar forbids.
   *
   * Coordinates are NOT optimistic: they are already on the DOM (the canvas paints
   * them while dragging), so writing them back into the store only makes React
   * render for nothing.
   *
   * The server may amend the result (filtering out illegal wires) → always take its
   * version, and if it drops something we just drew, SAY SO rather than silently
   * rolling it back.
   */
  async saveCanvas(
    nodes: CanvasState['nodes'],
    edges: CanvasEdge[],
    optimistic = false,
  ): Promise<void> {
    const id = state.officeId;
    if (!id) return;

    if (optimistic && state.canvas) {
      const connected = new Set(edges.filter((e) => e.from === 'assistant').map((e) => e.to));
      set({
        canvas: {
          ...state.canvas,
          edges,
          nodes: state.canvas.nodes.map((n) =>
            n.kind === 'agent' ? { ...n, connected: connected.has(n.id) } : n,
          ),
        },
      });
    }

    const next = await guard(() => api.saveCanvas(id, { nodes, edges }));
    if (!next) return;

    if (optimistic && next.edges.length < edges.length) {
      toast(t('toast.badEdge'), 'error');
    }
    set({ canvas: next });
  },

  async addAgent(input: { display_name: string; pitch: string; tier: string }): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.addAgent(id, input));
    if (!res) return false;
    set({ canvas: res.canvas });
    void actions.refreshCompany();
    return true;
  },

  /**
   * Edit an employee's profile. NO autosave — the caller comes from an explicit
   * Save button.
   *
   * Editing `pitch` bumps the assistant's cacheKey (the pitch is in its roster);
   * editing `model_tier` bumps that agent's own cacheKey. Autosaving per keystroke
   * here is continuous cache churn — the same reason as skills (SPEC-ui.md §2.2).
   */
  async editAgent(
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
  ): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.editAgent(id, role, patch));
    if (!res) return false;
    set({ canvas: res.canvas });
    void actions.refreshCompany();
    return true;
  },

  /** The notebook of lessons is kept. */
  async removeAgent(role: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.removeAgent(id, role));
    if (!res) return false;
    set({ canvas: res.canvas, selected: null });
    void actions.refreshCompany();
    return true;
  },

  /**
   * DETACH an arm from THIS office — cut every wire here, leave the config and the
   * key intact at company level. It comes back through the "already plugged in
   * elsewhere" block.
   *
   * The cut happens by rewriting `edges` rather than through a dedicated route: an
   * `mcp→agent` edge lives in `roles/*.yaml`, and `LayoutStore.save` is already the
   * ONLY path that writes there. A second door would be a second copy of one rule.
   */
  async detachArm(server: string): Promise<boolean> {
    const c = state.canvas;
    if (!c) return false;
    const from = `mcp:${server}`;
    const kept = c.edges.filter((e) => e.from !== from);
    if (kept.length === c.edges.length) return true;
    await actions.saveCanvas(c.nodes, kept, true);
    set({ selected: null });
    return true;
  },

  /**
   * WITHDRAW an arm from THIS office. The shared ledger keeps the config and the
   * key, so plugging the same thing in again finds it — which is why there is no
   * longer an "archive" step.
   */
  async removeArm(server: string): Promise<boolean> {
    const id = state.officeId;
    if (!id) return false;
    const res = await guard(() => api.removeArm(server, id));
    if (!res) return false;
    set({ selected: null });
    await actions.refreshCanvas();
    return true;
  },

  /**
   * DELETE FOR GOOD from the shared ledger. → `Company.forgetArm`
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 BUG the user reported 26/08: *"deleting an MCP no office uses doesn't  │
   * │ update the state on the front end straight away — it says there is no     │
   * │ connection <id>. Only F5 clears it."*                                     │
   * │                                                                           │
   * │ The cause: `ArmDialog` called **`api.forgetArm` directly**, bypassing     │
   * │ this. So it updated exactly ONE local list inside the dialog, while the   │
   * │ store's `selected` and `canvas` still held the id that had just died —    │
   * │ and the next click touching it (rename / withdraw) asked the server about │
   * │ an id that no longer exists.                                              │
   * │                                                                           │
   * │ This is **exactly the shortcut** `office.ts` recorded back on 20/08:      │
   * │ *"two routes call the store directly, two go through `Office`. Whichever  │
   * │ door takes the shortcut is the door that forgets."* I rebuilt it three    │
   * │ days after the codebase wrote that lesson down.                           │
   * │                                                                           │
   * │ ⇒ Every state-CHANGING operation goes through `actions`, with no "but     │
   * │ this one is small" exception. `removeArm` just above already does it      │
   * │ right — this only has to look like it.                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  async forgetArm(server: string): Promise<boolean> {
    const res = await guard(() => api.forgetArm(server));
    if (!res) return false;
    // Deselect BEFORE repainting: an Inspector open on that node would read an id
    // no longer in the ledger, and its "Save" button calls `renameArm` — exactly
    // what produced the "No such connection <id>" message.
    set({ selected: null });
    await actions.refreshCanvas();
    return true;
  },

  /**
   * FORGET a linked workspace (revoke at the service, then delete the key here).
   *
   * It goes through `actions` rather than calling `api` directly, for the same
   * reason as `forgetArm` above: a node on the diagram draws its `via` sub-line
   * from the OAuth store, so forgetting a workspace without repainting the canvas
   * leaves a dead name on screen until the next F5.
   */
  async forgetAccount(name: string): Promise<boolean> {
    const res = await guard(() => api.oauthForget(name));
    if (!res) return false;
    await actions.refreshCanvas();
    return true;
  },

  /** A label is not an identity, so this is the cheapest operation in the system. */
  async renameArm(server: string, label: string): Promise<boolean> {
    const res = await guard(() => api.renameArm(server, label));
    if (!res) return false;
    await actions.refreshCanvas();
    return true;
  },

  /** Memory and disk both — see `draft`. */
  setDraft(text: string): void {
    set({ draft: text });
    writeDraft(state.officeId, text);
  },

  /**
   * Send whatever the draft holds. It takes no argument: **the chat box no longer
   * holds the text**, so `state.draft` is the only source of truth.
   */
  async say(): Promise<void> {
    const id = state.officeId;
    const text = state.draft.trim();
    if (!id || !text || state.sending) return;

    /**
     * CLEAR THE BOX AT ONCE, BUT KEEP A COPY TO HAND BACK IF SENDING FAILS.
     *
     * Clearing immediately is required by the "smooth" bar: an action must respond
     * before the server does. But the previous version cleared and that was
     * **that** — lose the network exactly as Send is pressed and the sentence just
     * typed vanishes, leaving only a red toast. People type several hundred words
     * and lose all of it to one network hiccup.
     */
    actions.setDraft('');
    /**
     * DRAWN AT ONCE, marked `pending`, settled by the server's echo.
     *
     * The echo is still the one stream every tab and the Telegram bridge read —
     * it is not dropped, it is MATCHED. What changed is that this tab no longer
     * makes the person watch a round trip to see their own sentence, which is
     * the one thing on screen the server is not the authority on.
     * → `mergeUserEcho`
     */
    const pendingId = ++msgSeq;
    const drawn = [...state.messages, { id: pendingId, role: 'user', text, at: Date.now(), pending: true }];
    set({
      sending: true,
      activity: t('activity.reading'),
      messages: drawn,
      ...(state.panel === 'chat' ? { seenMessages: drawn.length } : {}),
    });
    // `say` returns AS SOON AS the message is in the mailbox — every later update
    // arrives as an `office.activity` event, so do not clear the status line here.
    const ok = await guard(() => api.say(id, text));
    set({ sending: false });
    if (ok === undefined) {
      // The send failed, so TAKE THE BUBBLE BACK DOWN. Leaving it would be the
      // interface asserting something that did not happen — worse than the delay
      // this whole change exists to remove.
      set({ messages: state.messages.filter((m) => m.id !== pendingId) });
      // `guard` has already shown the error; the job here is **giving the text back
      // to the user**. Only if the box is still empty: they may have typed something
      // else while waiting, and overwriting that loses their work a second time.
      if (!state.draft) actions.setDraft(text);
    }
  },

  async stop(): Promise<void> {
    const id = state.officeId;
    if (!id) return;
    await guard(() => api.stop(id));
  },

  /**
   * Change the interface language. → docs/CLAUDE.md §Language
   *
   * Applied locally FIRST, then persisted. The switch is a pure display change
   * with nothing to roll back and no work in flight that depends on it, so
   * waiting for a round trip would only add a beat of nothing happening. If the
   * write fails, `guard` shows the reason and the next reload reads the file —
   * which still holds the old value, so the two ends agree again by themselves.
   */
  async setLanguage(locale: Locale): Promise<void> {
    if (locale === state.locale) return;
    applyLocale(locale);
    await guard(() => api.setLanguage(locale));
  },

  /**
   * Light · dark · follow the machine. → `lib/theme.ts`
   *
   * No round trip and nothing to await: the stylesheet has already repainted by
   * the time this returns. It is deliberately NOT stored on the server the way
   * the language is — see the note on `AppState.theme`.
   */
  setTheme(theme: Theme): void {
    if (theme === state.theme) return;
    applyTheme(theme);
    set({ theme });
  },

  /**
   * SHUT THE DAEMON DOWN — the last thing this screen ever does.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE FLAG GOES UP BEFORE THE REQUEST, NOT AFTER IT.                       │
   * │                                                                          │
   * │ The server answers `{ok:true}` and only THEN exits, 100ms later — but    │
   * │ the SSE stream can die first, and `es.onerror` writing `fatal` while     │
   * │ this call is still in flight would put an error screen over a shutdown   │
   * │ the user asked for. Raising it first means every later signal — the      │
   * │ dropped stream, the failed fetch — lands on a screen that already says   │
   * │ the right thing.                                                         │
   * │                                                                          │
   * │ ⚠ AND THE ERROR IS SWALLOWED ON PURPOSE, which is the one place in this  │
   * │ file that is allowed. A daemon that dies before finishing the response   │
   * │ is a request that fails — and it fails BECAUSE IT WORKED. Reporting it   │
   * │ would be a red toast for a successful action.                            │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  async shutdown(): Promise<void> {
    set({ poweredOff: true });
    // Close the stream ourselves rather than letting it reconnect into a dead
    // port: EventSource retries forever, and each attempt is a console error on
    // a screen whose whole job is to be quiet.
    source?.close();
    await api.shutdown().catch(() => undefined);
  },

  /**
   * RENAME THE COMPANY — the title in the top-left corner.
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ EMPTY IS A LEGAL VALUE, and it does not mean "leave it alone".           │
   * │                                                                          │
   * │ `company.yaml` starts with no `name:` at all, and the server renders     │
   * │ that as `t('company.unnamed')` — a label that follows the interface      │
   * │ switch. Clearing the box is how somebody gets back to it, so an empty    │
   * │ string is sent through rather than treated as a cancel. → `Company.      │
   * │ updateName`                                                              │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   * The response carries the name the SERVER settled on, which is not always
   * the string that was typed — trimmed, and swapped for the default label when
   * it is empty. Taking ours instead would leave the header showing a blank
   * title until the next reload.
   */
  async renameCompany(name: string): Promise<boolean> {
    const res = await guard(() => api.setCompanyName(name));
    if (!res) return false;
    set({ company: state.company ? { ...state.company, name: res.name } : state.company });
    return true;
  },

  /** Clicking the tab already open CLOSES it. That is what a tab does. */
  openPanel(panel: PanelId | null): void {
    const next = state.panel === panel ? null : panel;
    set({ panel: next, ...(next === 'chat' ? { seenMessages: state.messages.length } : {}) });
  },

  /**
   * Opens a drawer WITHOUT toggling. The entrance from the diagram.
   *
   * It differs from `openPanel` exactly where it matters: clicking the "Library"
   * node twice must mean "open, and still open" — not "open then close". Someone
   * clicking a specific thing to reach a specific place always intends OPEN. Only
   * the tab button means on/off.
   */
  showPanel(panel: PanelId): void {
    if (state.panel === panel) return;
    // The inspector on the right has to close: a store node has nothing to show
    // there, and leaving it open is an empty column beside the drawer just opened.
    set({ panel, selected: null, ...(panel === 'chat' ? { seenMessages: state.messages.length } : {}) });
  },

  /**
   * OPENS THE PANEL rather than uploading quietly in the background: the user has
   * just dropped a file and needs to see what is happening to it — is it extracted,
   * was it refused, does the name clash. An action with no visual response gets
   * performed twice next time.
   */
  dropDocs(files: File[]): void {
    if (files.length === 0) return;
    set({ panel: 'library', selected: null, pendingDocs: files });
  },

  /** Clears the slot as it hands over — otherwise reopening the panel uploads again. */
  takeDroppedDocs(): File[] {
    const files = state.pendingDocs ?? [];
    if (files.length) set({ pendingDocs: null });
    return files;
  },

  /**
   * → docs/SPEC-ui.md · docs/SPEC-artifacts.md §2.5
   *
   * Opens, never toggles: the intent here is always OPEN. Clicking two paths in a
   * row where the second closes the panel is a trap.
   */
  revealArtifact(path: string): void {
    set({ panel: 'artifacts', selected: null, revealArtifact: path });
  },

  /**
   * Clears the slot IMMEDIATELY, even when the file was not found: keeping it means
   * that the next time the user opens the Results panel for something else
   * entirely, a preview they never asked for pops open — and they will have no idea
   * where it came from.
   */
  takeRevealArtifact(): string | null {
    const p = state.revealArtifact;
    if (p) set({ revealArtifact: null });
    return p;
  },

  select(nodeId: string | null): void {
    set({ selected: nodeId });
  },

  /**
   * Diagram ⇄ room. → docs/SPEC-office-animation.md §11a
   *
   * Remembered per browser, never on the server. Everything else on screen —
   * header, sidebar, plan strip, the inspector, the selection — survives the
   * switch untouched: only the main scene swaps.
   */
  setView(view: 'diagram' | 'office'): void {
    if (state.view === view) return;
    set({ view });
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // A remembered view is a convenience; a white screen is not acceptable.
    }
  },

  /**
   * Somebody picked a different character for one person.
   * → docs/SPEC-office-animation.md §6c③ · §17k‴
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 IT SENDS THE RESOLVED CAST, AND THIS COMMENT USED TO FORBID THAT.     │
   * │                                                                          │
   * │ It read: *"sends the stored CHOICES plus this one — never the resolved   │
   * │ cast. Sending what everyone currently looks like would freeze every      │
   * │ hashed default into `layout.json`, and the 'delete it and the office     │
   * │ re-casts itself' property would be gone."* Both sentences are true. What │
   * │ they left out is what the sparse payload costs, and it was measured:     │
   * │                                                                          │
   * │   an office of 12, ONE hand pick → up to **6 of the other 11** change    │
   * │   face, and 4 change garment colour                                      │
   * │                                                                          │
   * │ Because a face is reserved before the rest are dealt, reserving one      │
   * │ cascades through everybody the probe walks past. The user saw it from    │
   * │ the other end: *"I change one person's character and the whole break     │
   * │ area moves — I expected only that character to change."* It moves        │
   * │ because a different face is a different per-sheet `scale` and a          │
   * │ different `sitLift`, so a seated figure visibly jumps.                   │
   * │                                                                          │
   * │ ⇒ Freeze what everyone looks like AT THE MOMENT SOMEBODY CHOOSES. A pick │
   * │ is a deliberate act on a screen the user is watching, and it is already  │
   * │ a write — the objection §17k raises against storing (a READ that writes  │
   * │ and emits `layout.changed`) does not apply here.                         │
   * │                                                                          │
   * │ ⚠ THE COST IS REAL AND IS NOW THE SMALLER ONE: after the first pick, the │
   * │ office's whole cast is in `layout.json`, so *"delete it and the office   │
   * │ re-casts itself"* holds only for an office nobody has ever dressed. It   │
   * │ is bounded by that first pick, and `setTint` beside this has been paying │
   * │ exactly the same price since it shipped.                                 │
   * │                                                                          │
   * │ ⚠ IT IS ALSO WHY HIRING AND FIRING STOP DISTURBING PEOPLE in a dressed   │
   * │ office: a stored face is honoured verbatim and `pruneCast` only drops    │
   * │ the leaver. That was the open hole in §17k″, half closed as a side       │
   * │ effect rather than as a second mechanism.                                │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  async setCharacter(nodeId: string, character: number): Promise<void> {
    const id = state.officeId;
    const canvas = state.canvas;
    if (!id || !canvas) return;
    /**
     * ⚠ FROM `node.character`, the value the server RESOLVED, not from
     * `canvas.cast`, which holds only what was already chosen by hand. The whole
     * point is to pin the people who never chose.
     */
    const cast: Record<string, number> = {};
    for (const n of canvas.nodes) if (typeof n.character === 'number') cast[n.id] = n.character;
    cast[nodeId] = character;

    // Optimistic: this is a costume, and waiting for a round trip to see it is
    // exactly the "responds before the server answers" bar.
    set({
      canvas: {
        ...canvas,
        cast,
        nodes: canvas.nodes.map((n) => (n.id === nodeId ? { ...n, character } : n)),
      },
    });
    markLocalSave();
    const next = await guard(() => api.saveCanvas(id, { cast }));
    if (next) set({ canvas: next });
  },

  /**
   * Somebody dragged the colour picker for one person.
   * → docs/SPEC-office-art.md §11 · SPEC-office-animation §17k
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ ⚠ REAL-TIME ON SCREEN, DEBOUNCED TO DISK — and they are not the same      │
   * │ thing dressed differently.                                                │
   * │                                                                           │
   * │ A continuous picker fires on every pixel the pointer moves. The colour    │
   * │ has to follow the finger, or the control feels broken; the SAVE must not, │
   * │ or one drag across the spectrum is two hundred writes of `layout.json`    │
   * │ and two hundred `layout.changed` events broadcast to every open tab.      │
   * │                                                                           │
   * │ ⚠ THE STORED MAP IS REBUILT FROM THE NODES, not kept as a second field.   │
   * │ `CanvasState` deliberately does not carry the tint choices (→ types.ts),  │
   * │ so the map sent up is assembled from every node that HAS a tint plus this │
   * │ change. That is a real cost, stated: a colour the server computed for a   │
   * │ face-clash gets written down the first time the user changes anybody's,   │
   * │ turning a derived value into a stored one. It is bounded — it only        │
   * │ affects people who were already tinted — and the alternative is shipping  │
   * │ a second map down the wire on every canvas read.                          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  setTint(nodeId: string, tint: string): void {
    const canvas = state.canvas;
    if (!canvas) return;
    set({
      canvas: { ...canvas, nodes: canvas.nodes.map((n) => (n.id === nodeId ? { ...n, tint } : n)) },
    });
    if (tintTimer) clearTimeout(tintTimer);
    tintTimer = window.setTimeout(() => {
      tintTimer = 0;
      const id = state.officeId;
      const now = state.canvas;
      if (!id || !now) return;
      const map: Record<string, string> = {};
      for (const n of now.nodes) if (n.tint) map[n.id] = n.tint;
      markLocalSave();
      void guard(() => api.saveCanvas(id, { tint: map })).then((next) => {
        if (next) set({ canvas: next });
      });
    }, 350);
  },

  dismissToast(): void {
    set({ toast: null });
  },
};

// ─────────────────────────────────────────────────────────── SSE

let source: EventSource | undefined;

export function connectEvents(): () => void {
  source?.close();
  const es = new EventSource('/api/events');
  source = es;

  es.onmessage = (m) => {
    let e: AgentEvent;
    try {
      e = JSON.parse(m.data as string) as AgentEvent;
    } catch {
      return;
    }
    if (e.type === 'company.offices') {
      /**
       * ⚠ This is the ONLY way to know for certain that an OAuth flow finished:
       * the callback tab is a separate navigation, the user may close it whenever
       * they like, and no DOM event in the agentco tab says anything about it.
       * Without this line the dialog still shows *"not signed in"* after signing
       * in, and the only way forward is F5 — the exact shape of "the app lies
       * about its own state".
       */
      // Set BOTH in one write, and always set `linkedAccount` — including to
      // `null`. Leaving a stale name behind would let the next bump (a withdrawal,
      // a deletion) look like a sign-in that never happened.
      set({ armsVersion: state.armsVersion + 1, linkedAccount: e.account ?? null });
      // `e.office` carries the NEW id when a rename moved the directory — forward
      // it as a hint so a tab on the old id goes straight to the right place.
      // → `refreshCompany`
      void actions.refreshCompany(e.office ?? undefined);
      return;
    }
    // Another office's events must not show up here. This is why every event is
    // required to carry an `office` field.
    if (e.office && e.office !== state.officeId) return;
    applyEvent(e, true);
  };

  es.onerror = () => {
    // The daemon we just switched off is not a daemon we lost. → `actions.shutdown`
    if (state.poweredOff) return;
    // EventSource reconnects by itself. Only report once it has closed for good.
    if (es.readyState === EventSource.CLOSED) {
      set({ fatal: t('error.lostDaemon') });
    }
  };

  return () => es.close();
}

/**
 * The timer that clears a TEMPORARY status line (`office.activity.note`).
 * → SPEC-offices.md §4.6
 *
 * One variable, not a table: there is only ever one status line on screen, so when
 * two temporary sentences overlap the later one wins — and the earlier timer has
 * to be cancelled, or it will clear the sentence now showing.
 */
let noteTimer: ReturnType<typeof setTimeout> | undefined;

let doneTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function setLive(role: string, next: LiveAgent | null): void {
  const live = { ...state.live };
  if (next) live[role] = next;
  else delete live[role];
  set({ live });
}

function applyEvent(e: AgentEvent, fromLive: boolean): void {
  switch (e.type) {
    case 'plan.created':
      set({ plan: { plan_id: e.plan_id, request: e.request, steps: e.steps }, live: {} });
      break;

    case 'plan.step': {
      const plan = state.plan;
      if (!plan) break;
      const steps = plan.steps.map((s, i) => (i === e.step ? { ...s, status: e.status as StepStatus } : s));
      set({ plan: { ...plan, steps } });
      break;
    }

    case 'plan.finished':
      // The plan stays on screen after it finishes — the user was just reading it,
      // and clearing it immediately steals the context.
      set({ live: {}, activity: null });
      break;

    /**
     * ⚠ `task.started` carries NO place, and must not inherit one. It is the
     * brief being handed over, before any tool has run — the person walks to
     * their own spot, and only a real `at` moves them anywhere else.
     */
    case 'task.started':
    case 'task.progress':
      clearTimeout(doneTimers[e.role]);
      setLive(e.role, {
        status: 'working',
        say: e.say,
        // Spread so ABSENT STAYS ABSENT: a progress turn with no tool call
        // must clear the previous place rather than leave the person standing
        // at a station they have already left.
        ...(e.type === 'task.progress' && e.at ? { at: e.at, ...(e.arm ? { arm: e.arm } : {}) } : {}),
      });
      // Who is doing what — shown in the chat frame, so nobody has to open another
      // panel to learn that the system is still alive.
      set({ activity: labelFor(e.role) + ': ' + e.say });
      break;

    case 'task.done': {
      const ok = e.status === 'done';
      // A finished task may mean new artifacts on disk. The Results panel reloads.
      if (e.artifacts.length) set({ artifactsVersion: state.artifactsVersion + 1 });
      // `artifacts` rides along because it is the difference between a worker
      // with something to put on the filing desk and one without — a
      // `deliver: reply` task answers and lands no file.
      setLive(e.role, { status: ok ? 'done' : 'error', say: e.say, artifacts: e.artifacts.length });
      clearTimeout(doneTimers[e.role]);
      doneTimers[e.role] = setTimeout(() => {
        if (state.live[e.role]?.status === 'done') setLive(e.role, null);
      }, 4500);
      break;
    }

    case 'task.blocked':
      setLive(e.role, { status: 'error', say: e.say });
      break;

    case 'master.message': {
      /**
       * Our own sentence coming back SETTLES the bubble already on screen — it
       * never adds a second one. A `role: 'user'` message with no pending match
       * is a real message from somewhere else (another tab, Telegram, the replay
       * on reload) and falls through to the append below. → `mergeUserEcho`
       */
      if (e.role === 'user') {
        const settled = mergeUserEcho(state.messages, e.say);
        if (settled) {
          set({ messages: settled, ...(state.panel === 'chat' ? { seenMessages: settled.length } : {}) });
          break;
        }
      }
      const messages = [
        ...state.messages,
        {
          id: ++msgSeq,
          role: e.role,
          text: e.say,
          at: Date.now(),
          // Forwarded INTACT, with nothing inferred. The interface never sniffs
          // paths out of `text` — see the note on `master.message` in
          // core/types.ts for why that is a hard rule.
          ...(e.files?.length ? { files: e.files } : {}),
        },
      ];
      // With the chat panel open it counts as read at once — the dot is only for
      // messages that arrive while the user is looking elsewhere.
      set({ messages, ...(state.panel === 'chat' ? { seenMessages: messages.length } : {}) });
      break;
    }

    case 'office.state':
      set({ officeState: e.state });
      break;

    // The assistant being busy and an employee being busy are TWO things. The
    // sentence shown has to name what is actually happening, or the user reads the
    // silence as a dead system.
    case 'office.activity': {
      /**
       * `note` OVERRIDES the line built from the numbers, then clears itself.
       * → SPEC-offices.md §4.6
       *
       * This is how `/clear` speaks. It does NOT enter `messages`, so after the
       * clear the chat box really is empty — the process appears and vanishes, only
       * the result stays, exactly the `…thinking` → blank shape.
       *
       * The timer is CANCELLED if another `office.activity` arrives first:
       * otherwise the old timer clears the status line of the NEW task that just
       * started.
       */
      /**
       * Written on EVERY `office.activity`, including when absent — the same
       * rule as `libraryBusy`. A conditional write is how a state gets stuck on
       * screen forever: the "no longer reading" branch would write nothing, and
       * the assistant would stand at the bookshelf until the next lookup.
       */
      set({ assistantReading: e.reading ?? null });

      if (e.note) {
        if (noteTimer) clearTimeout(noteTimer);
        noteTimer = undefined;
        set({ activity: e.note });
        /**
         * ⚠ NO `hold_ms` = HOLD UNTIL THE NEXT EVENT. There is NO default.
         *
         * FIXED BUG (20/08): the user reported *"/clear still stalls 3–5 seconds
         * saying nothing"*. The previous version read absence as `?? 4_000` — but
         * memory compaction takes 5–15 seconds, so the "Clearing…" line **turned
         * itself off at 4 seconds while the work was still running**, leaving
         * exactly the silence this whole mechanism exists to fill.
         *
         * The two kinds of `note` have opposite lifetimes and the server ALREADY
         * distinguishes them: `emitNote()` (a finished result) always sends
         * `hold_ms`; the `clearing` branch (work in flight) never does. Only the
         * client was reading it wrong.
         *
         * → core/types.ts `office.activity`
         */
        if (e.hold_ms === undefined) break;
        noteTimer = setTimeout(() => {
          noteTimer = undefined;
          // Only clear if nobody has overwritten it — otherwise this swallows the
          // status line of a task handed out right after the clear.
          if (state.activity === e.note) set({ activity: null });
        }, e.hold_ms);
        break;
      }
      if (noteTimer) {
        clearTimeout(noteTimer);
        noteTimer = undefined;
      }

      const bits: string[] = [];
      if (e.assistant === 'thinking') bits.push(t('activity.assistantThinking'));
      if (e.assistant === 'planning') bits.push(t('activity.assistantPlanning'));
      if (e.workers > 0) bits.push(plural('activity.workers', e.workers));
      if (e.queued > 0) bits.push(plural('activity.queued', e.queued));
      if (e.jobs > 0) bits.push(plural('activity.jobs', e.jobs));
      // THE THREAD MUST NOT BREAK. A `plan_id` still present means a job is still
      // running, so something has to remain on screen — including the short beats
      // where nobody is "busy" in the narrow sense (planning just finished, the
      // first task not yet launched). The silence is where a user decides the
      // system is dead and clicks again.
      if (bits.length === 0 && e.plan_id) bits.push(t('activity.running'));
      set({ activity: bits.length ? bits.join(' · ') : null });
      break;
    }

    /**
     * This event is an INSTRUCTION, not a sentence to read — so it does not enter
     * `messages`.
     *
     * The result message arrives IMMEDIATELY AFTER it as a `master.message`, and so
     * becomes the first line of the new conversation. The user sees: "Clearing…" →
     * a blank screen → "Cleared". The feeling of clearing out is REAL, because the
     * transcript behind it really was dropped.
     */
    case 'office.cleared':
      set({ messages: [], seenMessages: 0, activity: null });
      break;

    case 'cost.tick':
      set({ cost: e.totals });
      break;

    // ⚠ NOT cleared on an office switch — see the note on `AppState.energy`.
    case 'energy.tick':
      set({ energy: e.energy });
      break;

    case 'knowledge.changed':
      // Bump ALWAYS, replays from the log included: the Knowledge drawer watches
      // this number rather than the node count, so it sees changes that keep the
      // count too (an edited body, a superseded node, prune one and add one).
      set({ knowledgeVersion: state.knowledgeVersion + 1 });
      if (fromLive) void actions.refreshCanvas();
      break;

    /**
     * `libraryBusy` IS WRITTEN EVERY TIME, including when it is 0. A conditional
     * write is how a status line gets stuck on screen forever: the "no longer busy"
     * branch writes nothing, so the old value lives on. See the note on
     * `AppState.libraryBusy`.
     */
    case 'library.changed':
      set({ libraryVersion: state.libraryVersion + 1, libraryBusy: e.busy });
      // The library node on the diagram shows a document COUNT — without a reload
      // that number stands still and the diagram lies about what the user just did.
      if (fromLive) void actions.refreshCanvas();
      break;

    case 'layout.changed':
      // Ignore our own echo — `saveCanvas` already took the server's version. But
      // OTHER tabs still have to see it. Distinguished by the last local write.
      if (fromLive && Date.now() - lastLocalSave > 2000) void actions.refreshCanvas();
      break;
  }
}

let lastLocalSave = 0;
export function markLocalSave(): void {
  lastLocalSave = Date.now();
}

/** Cleanup for hot reload during development. */
export function resetTimers(): void {
  for (const t of Object.values(doneTimers)) clearTimeout(t);
  doneTimers = {};
}
