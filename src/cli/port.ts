/**
 * Which port a company listens on, and what to say when it cannot have one.
 *
 * → docs/SPEC-cli.md §1
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 EVERY COMPANY USED TO BE BORN ON 7317. (found 16/09/2026, by walking   │
 * │ the npm door as a first-time user)                                       │
 * │                                                                          │
 * │ `companyTemplate` wrote `port: 7317` as a literal, so the SECOND company  │
 * │ on a machine collided with the first by construction — not by bad luck.   │
 * │ The packaged installer keeps a company at `<install>\company`; anyone     │
 * │ who then ran `agentco init` anywhere else got                            │
 * │ `listen EADDRINUSE 127.0.0.1:7317` with no idea what was holding it.      │
 * │                                                                          │
 * │ The fix is at INIT, not at START: pick a free port once, write it into    │
 * │ `company.yaml`, and the collision never happens. Choosing at start-up     │
 * │ instead would mean the config says 7317 while the daemon listens on 7318  │
 * │ and the Linux `.desktop` entry points at the number the config names      │
 * │ (`smoke-npm.ts` asserts exactly that) — one number, three answers.        │
 * │                                                                          │
 * │ ⚠ The cost, accepted: something holding 7317 at the moment of `init`      │
 * │ pushes that company to 7318 permanently. That is visible in              │
 * │ `company.yaml` and editable; a silent drift at every start would not be.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import net from 'node:net';

/** Where the search starts when nothing else says otherwise. */
export const DEFAULT_PORT = 7317;

/**
 * How many ports `init` will try before giving up.
 *
 * ⚠ A BOUND, NOT A SCAN. Twenty companies on one machine is already far past
 * anything real; past that the honest answer is "say so" rather than to keep
 * knocking on doors, which is the behaviour a firewall reads as a port scan.
 */
export const PORT_SCAN_MAX = 20;

/**
 * Can we listen here right now?
 *
 * ⚠ Answered by BINDING, not by connecting. A refused connection says nothing
 * about whether the port is bindable — a socket held by another user's process,
 * or bound to a different interface, refuses us and still takes the port.
 */
export function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, host);
  });
}

/** The first free port at or after `start`, or `undefined` after `tries` of them. */
export async function findFreePort(
  start: number,
  host: string,
  tries: number = PORT_SCAN_MAX,
): Promise<number | undefined> {
  for (let port = start; port < start + tries; port++) {
    if (await isPortFree(port, host)) return port;
  }
  return undefined;
}

/**
 * The version of the agentco holding this port, or `undefined` for anything else.
 *
 * ⚠ ONE REQUEST, to the port we already know about — never a sweep. The answer
 * only ever improves an error message, so it is allowed to fail: a timeout, a
 * stranger's service and a wrong shape all mean the same thing here, which is
 * "cannot say", and the caller prints the shorter sentence.
 */
export async function agentcoOnPort(port: number, host: string): Promise<string | undefined> {
  try {
    const res = await fetch(`http://${host}:${port}/healthz`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { ok?: boolean; version?: string };
    if (body.ok !== true || typeof body.version !== 'string') return undefined;
    return body.version;
  } catch {
    return undefined;
  }
}
