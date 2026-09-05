/**
 * SHARED TYPES FOR THE PER-VENDOR BLOCKS. → `../ArmDialog.tsx`
 *
 * Here rather than redeclared in each file: every block is a piece of the SAME
 * dialog, and three copies of one shape are three places to drift — a class of
 * bug that has burned this project more than once (`agentSlot` vs `arrange`).
 *
 * ⚠ The shape has to match `lib/api.ts` — this is data ABOUT THE WIRE, not a
 * model of the interface. Change the API and forget this file, and TypeScript
 * complains at the call site instead of failing quietly.
 */

/** A device-code sign-in currently in flight. → `api.oauthDeviceStart` */
export interface DeviceLogin {
  state: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  intervalMs: number;
}

/**
 * The result of checking where the app is installed. → `api.armRepos` · SPEC-arms §5h·7o
 *
 * ⚠ THREE states, not two. `null` = not checked yet; `{ failed }` = COULD NOT
 * check; `installed: []` = checked, and the answer is NOT INSTALLED. Merging the
 * last two either blocks someone who has installed it, or waves through someone
 * who has not.
 */
export type RepoScanState =
  | { login: string; installed: string[]; seen: number }
  | { failed: true }
  | null;

/** The door through to the vendor's own scope screen. → `catalog.ts §scope` */
export interface ArmScope {
  say: string;
  url: string;
}
