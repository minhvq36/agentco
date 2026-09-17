/**
 * The daemon's token, as the interface sees it. → docs/SPEC-deploy.md §3.1
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ 🔴 THE TOKEN NEEDS TWO SHAPES, AND THAT IS NOT A CONVENIENCE.
 * │
 * │ `server.ts §593` refuses to bind anywhere but loopback without a token, and
 * │ a container has to bind `0.0.0.0` for `-p` to reach it. So under Docker the
 * │ token is mandatory, and every `/api/` request has to carry it.
 * │
 * │ A header would be the obvious answer, and it covers `call()` — but three
 * │ things the interface already does CANNOT send a header at all:
 * │
 * │   `new EventSource('/api/events')`   the live event stream
 * │   `<img src>` · `<video src>` · `<object data>`   artifact previews
 * │   `<a href download>`                             the download link
 * │
 * │ Those are the browser fetching a URL on its own behalf, and the only place
 * │ to put a secret in a URL is the query string. `server.ts §708` already
 * │ accepts both — `x-agentco-token` OR `?token=` — so nothing on the server
 * │ has to change; what was missing was the interface ever sending either.
 * └──────────────────────────────────────────────────────────────────────────
 *
 * ⚠ ON LOOPBACK THERE IS NO TOKEN, AND THAT IS THE NORMAL CASE. `authHeaders`
 * then adds nothing and `withToken` returns the URL untouched, so the ordinary
 * desktop install sends exactly the bytes it sent before this file existed.
 *
 * ⚠ The value is stamped into `index.html` by the server that is serving it
 * (`src/server/static.ts`), not stored. Nothing survives the tab, nothing lands
 * in browser history, and a reload re-reads it from a daemon that has to be
 * reachable anyway for the page to load.
 */

declare global {
  interface Window {
    __AGENTCO_TOKEN__?: string;
    __AGENTCO_SAME_MACHINE__?: boolean;
  }
}

/**
 * Read once, at module load. The page was served with the token already in it,
 * so there is no moment where this is racing anything — and a getter that read
 * `window` on every call would invite somebody to think it can change.
 */
export const AUTH_TOKEN: string =
  typeof window !== 'undefined' && typeof window.__AGENTCO_TOKEN__ === 'string' ? window.__AGENTCO_TOKEN__ : '';

/**
 * Is the browser on the same machine as the daemon — **the server's answer**,
 * read from the socket address of the request that served this page.
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ 🔴 THE INTERFACE USED TO ANSWER THIS ITSELF, FROM ITS OWN ADDRESS BAR:
 * │
 * │     /^(127\.|localhost$|\[::1\]$)/.test(window.location.hostname)
 * │
 * │ Under Docker you open `127.0.0.1:7319`, so that says "same machine" — and
 * │ it is not. The daemon is in a container; it sees the bridge gateway and
 * │ refuses. The user met the disagreement as an error AFTER clicking a
 * │ checkbox that was offered to them, pre-ticked. (18/09/2026)
 * │
 * │ A hostname describes the URL. A socket address describes who connected.
 * │ Only the second is the question being asked, and only the daemon can see
 * │ it. → `src/server/static.ts §BootFacts`
 * └──────────────────────────────────────────────────────────────────────────
 *
 * ⚠ ABSENT ⇒ `true`, and that is exact rather than optimistic. Nothing is
 * injected when there is no token, and a daemon with no token is bound to
 * loopback (`server.ts §593` refuses otherwise) — so every connection it can
 * serve at all is local. The desktop install keeps the behaviour it had.
 *
 * ⚠ It is still only about the INTERFACE. The real gate is `server.ts
 * §armConfig`, which re-reads the socket on the request that matters. Checking
 * here keeps a button from being a riddle; checking there keeps it from being
 * decoration.
 */
export const SAME_MACHINE: boolean =
  typeof window !== 'undefined' && typeof window.__AGENTCO_SAME_MACHINE__ === 'boolean'
    ? window.__AGENTCO_SAME_MACHINE__
    : true;

/**
 * Merge the token into whatever headers a caller already has.
 *
 * ⚠ The caller's own headers WIN. Passing a token explicitly is how a test says
 * "use this one", and silently overriding it would make that test lie.
 */
export function authHeaders(init?: HeadersInit): HeadersInit | undefined {
  if (!AUTH_TOKEN) return init;
  return { 'x-agentco-token': AUTH_TOKEN, ...init };
}

/**
 * Put the token in the query string, for URLs the BROWSER fetches by itself.
 *
 * ⚠ ONLY `/api/` PATHS. The gate covers nothing else (`server.ts §707`), so
 * adding it to a static asset would leak the token into a request that never
 * needed it — and into any cache or log sitting in front of those assets.
 */
export function withToken(url: string): string {
  if (!AUTH_TOKEN || !url.startsWith('/api/')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(AUTH_TOKEN)}`;
}
