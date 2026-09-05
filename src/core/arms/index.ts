/**
 * THE CATALOGUE IS A LIST, NOT ONE ENORMOUS FILE. (settled 28/08)
 *
 * > *"I customise these providers quite a lot to fit each one. Could you
 * >  rearrange it? … so later changes are easy to make"*
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ THIS FILE STAYS PUT — it is allowed to be an array and nothing else.    │
 * │                                                                           │
 * │ The coming temptation is to drop "the bits several vendors share" in      │
 * │ here: a small header builder, a defaults table, one `if`. Don't. What is  │
 * │ shared lives in the TYPES AND BUILDERS (`catalog.ts`); what belongs to a  │
 * │ vendor lives in THAT VENDOR'S FILE. Leave one place in the middle and     │
 * │ nobody guards it, and it grows until it is the 900-line file we just      │
 * │ finished splitting up.                                                    │
 * │                                                                           │
 * │ ⚠ THE ORDER HERE IS THE ORDER PEOPLE SEE in the "Available services"      │
 * │ grid. It is also the BUILD ORDER settled in §4e: no keys → HTTP/OAuth     │
 * │ ready → OAuth that needs an app registered by hand.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { CatalogArm } from '../catalog.js';

import { BROWSER_ARM } from './browser.js';
import { FILES_ARM } from './files.js';
import { GITHUB_ARM } from './github.js';
import { LINEAR_ARM } from './linear.js';
import { NOTION_ARM } from './notion.js';

/**
 * ⚠ `browser` comes SECOND, not last — this is the BUILD order (§4e: no keys →
 * static keys → OAuth ready → OAuth you register yourself), and this entry needs
 * exactly ZERO keys typed, same as `files`. Putting it after `github` would be
 * ordering by the date it was written rather than by the rule.
 */
/**
 * ⚠ `linear` sits NEXT TO `notion`, before `github` — again the §4e build order
 * rather than the writing order. Measured 29/08: Linear opens DCR and accepts
 * `auth_method: none` exactly like Notion ⇒ SAME "zero hands" tier. GitHub costs
 * one manual app registration, so it comes after, despite being older.
 */
export const CATALOG: CatalogArm[] = [FILES_ARM, BROWSER_ARM, NOTION_ARM, LINEAR_ARM, GITHUB_ARM];
