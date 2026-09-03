/**
 * ONE CATALOGUE ENTRY = ONE FILE. → `../catalog.ts` · docs/SPEC-arms.md §4e
 *
 * ⚠ Notion NO LONGER goes through `npx`, and that absence is a decision (25/08).
 *
 * The old version pinned `@notionhq/notion-mcp-server@2.5.1` — a LOCAL, FIRST-
 * PARTY package. But the first party let go of it: 🌐 *"We may sunset this local
 * MCP server repository"* + *"issues and pull requests here are not actively
 * monitored"*.
 *
 * ⇒ The lesson worth keeping for every later entry: A PINNED VERSION IS NOT A
 * MAINTAINED ONE. §11d pins so a stranger's code cannot change under the
 * customer's feet; it does not save us from freezing something nobody patches.
 */

import type { CatalogArm } from '../catalog.js';

export const NOTION_ARM: CatalogArm = {
  id: 'notion',
  name: 'armCat.notion.name',
  icon: '📝',
  /**
   * ⚠ THIS SENTENCE HAS TO STATE THE RADIUS, and it runs against intuition. → §5h·3
   *
   * Notion's OAuth INHERITS THE SIGNED-IN PERSON'S ENTIRE PERMISSIONS: 🌐 *"MCP
   * tools act with your full Notion permissions"*, and the metadata declares
   * `scopes_supported: ["default"]` — ONE scope, not divisible.
   *
   * So it is WIDER than a static token, which sees nothing by default until
   * someone adds the connection to each page themselves. Hiding that is
   * OVER-PROMISING, and §11a-bis settled it: *over-warning makes people switch
   * off what they need; over-promising makes them switch on to buy something
   * that does not exist — the second is worse.* "Read only" here is OUR cut (the
   * permission tier), not a narrow grant from Notion.
   */
  blurb: 'armCat.notion.blurb',
  price: 'login',
  /**
   * FIRST-PARTY HOSTED MCP, Streamable HTTP. Three things it drops versus the
   * old version: no stranger's code downloaded to the customer's machine
   * (supply-chain risk §11d = ZERO), no `npx` on the hot path, and no dependency
   * on a package that has been let go.
   *
   * ⚠ `${OAUTH}` is a NAMED PLACEHOLDER, not a real key name. `buildConfig`
   * replaces it with the name of the account just signed in
   * (`NOTION_OAUTH_<8 hex workspace_id>`) — which is how TWO NOTION WORKSPACES
   * PRODUCE TWO DIFFERENT HASHES despite sharing a URL.
   * → §OAUTH_SLOT · `oauth.ts §accountName`
   *
   * After substitution, `company.yaml` holds an ordinary named slot: the user
   * CAN READ where a key goes without reading the key.
   * → `secrets.ts §injectSecrets`
   */
  spec: {
    kind: 'http',
    url: 'https://mcp.notion.com/mcp',
    headers: { Authorization: 'Bearer ${OAUTH}' },
  },
  /**
   * Three tiers, resolved from `annotations` at plug-in time. Measured 25/08: 28
   * actions — 14 READ · 11 ADD · 3 EDIT/DELETE, and 28/28 declare annotations.
   *
   * ⚠ This replaces the `readOnly: true` of the 25/08 version. That was correct
   * but RIGID: someone wanting Notion to write had no route except editing yaml
   * — a §6a ALARM BELL. A tier is something they choose, and it goes into the
   * hash, so "change the tier" is a different arm rather than an edit in
   * place. → §6j
   *
   * 📌 NO `readOnlyHeaders`: Notion does not cut actions by header, so the
   * `read` tier is enforced by our own `allowedTools` layer. That is also why
   * this entry AVOIDS the §6g-quater trap (a fence eating the tier picker).
   */
  tiered: true,
  /**
   * EMPTY — and that is the whole point of `price: 'login'`.
   *
   * This entry's key IS BORN FROM THE SIGN-IN FLOW; nobody types it. Its name is
   * not knowable in advance either (it carries the `workspace_id`), so declaring
   * one here would be declaring a string that turns out wrong.
   */
  secrets: [],
  /**
   * ⚠⚠ `checkedOn: null` WITH a non-empty `mark` = AN OPEN DEBT. → §11c
   *
   * §11c settled it: no logo until the brand guidelines have been read. The
   * vendor logos were asked for on 27/08 (*"try to use each provider's icon"*)
   * and we shipped them — so the debt has to sit RIGHT NEXT TO WHAT IT IS ABOUT,
   * not in a mapping table under the web folder that nobody walks past during a
   * trademark review.
   *
   * The path is a monochrome N glyph, `currentColor`, no background, no brand
   * colour. `guidelineUrl` + `checkedOn` must be filled in before any public
   * release.
   */
  brand: {
    owner: 'Notion Labs, Inc.',
    guidelineUrl: null,
    checkedOn: null,
    // ⚠ ONE STRING, NEVER CONCATENATED — the reason is in `github.ts §brand.mark`.
    // prettier-ignore
    mark: 'M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.727l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z',
  },
};
