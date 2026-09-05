/**
 * ONE CATALOGUE ENTRY = ONE FILE. → `../catalog.ts` · docs/SPEC-arms.md §4e
 *
 * This file is DATA, not code: no functions, no branches, no imports beyond the
 * type. Changing this entry means opening this file and nothing else — which is
 * the entire reason it was split out (user, 27/08: *"I customise these providers
 * quite a lot to fit each one… rearrange it"*).
 */

import type { CatalogArm } from '../catalog.js';

/**
 * ⚠ PIN THE VERSION, NEVER `@latest`. → SPEC-arms.md §11d
 *
 * `npx -y <package>` downloads and runs a stranger's code on the customer's
 * machine, with the customer's permissions and the customer's keys. `@latest`
 * means a stranger's update runs there with nobody reviewing it. Once an entry
 * appears in OUR CATALOGUE, "it is third-party code" stops being a sufficient
 * warning — CHOOSING ON SOMEONE'S BEHALF IS VOUCHING ON THEIR BEHALF.
 *
 * The constant lives HERE and not in `catalog.ts`: it belongs to this entry
 * alone, and a shared constant with a single user is an invitation for a second
 * one to borrow it.
 */
const FILESYSTEM_PKG = '@modelcontextprotocol/server-filesystem@2026.7.10';

export const FILES_ARM: CatalogArm = {
  id: 'files',
  name: 'armCat.files.name',
  icon: '📁',
  blurb: 'armCat.files.blurb',
  price: 'none',
  spec: { kind: 'stdio', command: 'npx', args: ['-y', FILESYSTEM_PKG], appendFolders: true },
  secrets: [],
  folders: {
    label: 'armCat.files.folders.label',
    help: 'armCat.files.folders.help',
  },
  // MCP's own reference server ⇒ NO third-party brand at all. This is the only
  // entry in the v1 catalogue with zero trademark risk.
  //
  // `mark` left empty ⇒ the interface draws by TYPE (a folder). That is the
  // right meaning: this entry has no vendor whose logo could be drawn.
  // → `ArmIcon.tsx`
  brand: { owner: null, guidelineUrl: null, checkedOn: null },
};
