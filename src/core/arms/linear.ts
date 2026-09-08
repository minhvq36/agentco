/**
 * ONE CATALOG ENTRY = ONE FILE. → `../catalog.ts` · docs/SPEC-arms.md §4e
 *
 * Every number below was **measured on 29/08 with a real key, a real account**
 * (`scripts/spike-linear-oauth.ts`), not read off documentation.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE FIRST ENTRY SINCE NOTION THAT DOESN'T CREATE ANY DEBT IN `oauth.ts`. │
 * │                                                                          │
 * │   POST /register  client_name="agentco" auth="none"  → 201, 0 secret     │
 * │   token_endpoint_auth_methods_supported: [basic, post, **none**]         │
 * │   ⇒ public client + PKCE, the exact path Notion already takes. All four  │
 * │     steps `discover → register → authorizeUrl → exchangeCode` run through│
 * │     the real functions, **0 lines changed**.                             │
 * │                                                                          │
 * │ Worth comparing to see why that's good news: Figma returns **403 with an │
 * │ empty body** for `client_name="agentco"` (it filters by client name);    │
 * │ Slack + Google **have no `none`** ⇒ they demand a confidential client,   │
 * │ which we don't have yet (§4 debt 0d).                                    │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { CatalogArm } from '../catalog.js';

/**
 * ⚠ Two URLs, and this pair is **the entire reason Linear was worth more work
 * than Notion**. Pulled into a constant because `identity` has to ask at the
 * **full URL** — asking for identity is a READ, but it runs before the tier is
 * known, so it must not go through `/readonly`.
 */
const MCP_URL = 'https://mcp.linear.app/mcp';

export const LINEAR_ARM: CatalogArm = {
  id: 'linear',
  name: 'armCat.linear.name',
  icon: '📐',
  /**
   * ⚠ THIS SENTENCE MUST STATE THE BLAST RADIUS — and here the radius is
   * **narrower** than Notion's, so stating it fully is accuracy, not modesty.
   *
   * Notion declares exactly **one** scope, `default`, inheriting the ENTIRE
   * permission set of the signed-in person (`notion.ts §blurb`); the
   * "read-only" tier there is a fence WE built. Linear grants `read` and
   * `write` separately, and **locks the key to exactly ONE workspace** the
   * user picks on the consent screen (measured: three sign-ins produced two
   * different workspace ids). So "read-only" on this entry means **a key
   * that genuinely cannot write**.
   */
  blurb: 'armCat.linear.blurb',
  price: 'login',
  /**
   * **Vendor-hosted** MCP, Streamable HTTP. Supply-chain risk §11d = **0**: no
   * stranger's code downloaded, no `npx` on the hot path.
   *
   * `${OAUTH}` is a **conventionally-named placeholder** — `buildConfig`
   * replaces it with the real account name (`LINEAR_OAUTH_<8 hex>`). →
   * §OAUTH_SLOT · `oauth.ts §accountName`
   *
   * ⚠⚠ `readOnlyUrl` IS A NEW MECHANISM, and it drags along one line at the
   * **bottom of `catalog.ts`**: `serverFenced()` has to see it. Forgetting it
   * rebuilds the exact 27/08 bug — the tier picker disappears, the user gets
   * locked at the lowest tier, **with no error message at all**. Measured for
   * this URL pair:
   *
   *   /mcp           57 tools · 79,243 bytes ≈ **19,811 tokens**
   *   /mcp/readonly  35 tools · 34,174 bytes ≈  **8,544 tokens**
   *   ⇒ cuts exactly 22 WRITE tools, **without losing a single read tool**,
   *     ≈11,267 tokens cheaper per turn
   *
   * (Reference points: `filesystem` 2,185 · GitHub default ~30,000 · Google Calendar 24,900.)
   */
  spec: {
    kind: 'http',
    url: MCP_URL,
    headers: { Authorization: 'Bearer ${OAUTH}' },
    readOnlyUrl: 'https://mcp.linear.app/mcp/readonly',
    /**
     * ⚠ REQUESTED WIDE, deliberately. Linear declares four scopes (`read` ·
     * `write` · `openid` · `email`); we request the first two and
     * **deliberately skip** `openid`/`email` — those return the **USER's**
     * identity (`sub`), and one person with N workspaces ⇒ same `sub` ⇒ still
     * collide. Our unit is the **workspace**, and that can only be asked for
     * through `identity.get_workspace` below.
     *
     * Requesting `read write` rather than just `read`: scope is locked in at
     * the consent click, before the user ever sees the tier picker. Measured
     * 29/08: signing in with `scope=read` ⇒ `/mcp` returns only 35 tools ⇒
     * `offeredTiers` collapses to **a single tier** ⇒ no path up to full
     * access anymore. → `catalog.ts §authScope`
     */
    authScope: 'read write',
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THREE TIERS — AND THE MIDDLE ONE IS NEARLY EMPTY. Recorded so nobody      │
   * │ mistakes it for a bug.                                                    │
   * │                                                                           │
   * │ Measured: **57/57 tools all declare `annotations`** (none fall into the   │
   * │ "default to refuse" branch). `offeredTiers` produces three tiers:         │
   * │                                                                           │
   * │     read 35  ·  add 39  ·  full 57                                        │
   * │                                                                           │
   * │ 🔴 The `add` tier only adds **4 tools**, and **HAS NO issue-creation      │
   * │ tool**. Linear has no `create_issue` — it uses `save_issue` (an upsert),  │
   * │ and an upsert declares `destructiveHint: true`, so it falls under         │
   * │ `full`. The `add` tier's four tools are: three attachment tools +         │
   * │ `create_issue_label`.                                                     │
   * │                                                                           │
   * │ ⇒ The user's call, 29/08: **just follow the truth table**, don't patch    │
   * │   in something vendor-specific (*"how would I even know what's in         │
   * │   there"*). Right — hiding this tier inside the Linear entry would be     │
   * │   burying a special case in the core, exactly what §domain-vs-boundary    │
   * │   forbids.                                                                │
   * │                                                                           │
   * │ ⚠ BUT HALF THE DEBT IS STILL UNPAID: the `add` tier's `help` copy in      │
   * │ `ArmDialog.tsx` says *"Can create new pages/items, but won't touch        │
   * │ anything that already exists"* — that sentence is **wrong for Linear**.   │
   * │ It's OUR OWN string, not the vendor's, so it isn't shielded by the        │
   * │ "follow the truth table" rule. Overpromising is worse than overwarning    │
   * │ (§11a-bis). → outstanding debt, recorded at SESSIONS_MEMORY §5x.          │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  tiered: true,
  /**
   * ⚠ OVERRIDE ONLY THE `add` TIER — the default copy is still correct for
   * the other two.
   *
   * The user caught this, 30/08: *"the issue thing with linear seems like it
   * matters"*. Right, and that's why the default copy (*"Can create new
   * pages/items…"*) doesn't work here: the issue **is** Linear's central
   * object, and this tier can't create one.
   *
   * 📌 The copy below states **what CAN be done**, then states **what CANNOT
   * be done along with the vendor's own reason** — instead of a bare
   * *"limited"*. The user needs to decide *"do I need this worker to open new
   * work"*, and for Linear that answer leads straight up to the Full-access tier.
   */
  tierSay: { add: 'armCat.linear.tierAdd' },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ 🔴 A REAL CASE, THE VERY FIRST RUN THROUGH THE UI (user reported, 30/08). │
   * │                                                                           │
   * │ Asked: *"How many issues are In Progress in Linear right now?"*           │
   * │ The Assistant delegates: *"Look this up in Linear **project               │
   * │ Agent-co-test-2**…"*                                                      │
   * │ The worker: `list_issues` (got 9 issues) → `list_projects` ×2 → gives up: │
   * │ *"Could not find project Agent-co-test-2"*. **6 turns · $0.1409 · wrong.**│
   * │                                                                           │
   * │ Nobody made anything up: `Agent-co-test-2` is the arm's `label`, and the  │
   * │ label comes from `identity.labelField` = the **WORKSPACE** name. The      │
   * │ directory line hands the model a bare string with no indication of what   │
   * │ kind of thing it is ⇒ the model reads it as a project name ⇒ goes looking │
   * │ for something that doesn't exist (`list_projects` returns `[]` — this     │
   * │ workspace has no projects) ⇒ **reports failure while already holding 9    │
   * │ issues in hand**.                                                         │
   * │                                                                           │
   * │ ⇒ This sentence lives **right on the arm's own entry**, not as a general  │
   * │ rule pasted onto every turn — the exact pattern that won at `run          │
   * │ commands: OFF`.                                                           │
   * │ → [[agentco-prompt-rules-lose-to-examples]]                               │
   * │                                                                           │
   * │ Second half, measured: `list_issues` **already returns `status`**         │
   * │ ("Todo"/"In Progress"/…) directly on each issue. So the answer sits in    │
   * │ ONE call, and the instruction has to **point at the way forward**, not    │
   * │ just say "don't do X".                                                    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  hint:
    'A Linear arm is labelled with a WORKSPACE name, not a project — plenty of workspaces have ' +
    'no project at all. Issues sit directly in a team, and list_issues already returns status, ' +
    'so filter on that.',
  /** EMPTY — the key is produced by the sign-in flow, never typed by the user. → `price: 'login'` */
  secrets: [],
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ REQUIRED, NOT DECORATION — miss this and TWO WORKSPACES MERGE INTO ONE.  │
   * │                                                                          │
   * │ Notion returns `workspace_id` right in the token response. **Linear      │
   * │ returns nothing**: measured the key store after three sign-ins, `extra`  │
   * │ has **absolutely nothing in it**. Without a seed, `accountName` falls    │
   * │ back to `issuer|mcp_url` — a string **identical for every Linear user**. │
   * │ Measured:                                                                │
   * │                                                                          │
   * │   no seed        all 3 keys → LINEAR_OAUTH_AA1F1EAD   ⇒ MERGED           │
   * │   seed = ws.id   Agent-co-test  → …52BA79B8                              │
   * │                  Agent-co-test-2→ …5C5D1429          ⇒ CORRECTLY SPLIT   │
   * │                                                                          │
   * │ Same class as the GitHub case, 26/08 (§5h·7k), and it has **zero         │
   * │ symptoms** until the user connects a second workspace.                   │
   * │                                                                          │
   * │ ⚠ `idField: 'id'`, not `'name'`: the user can rename a workspace, and a  │
   * │ seed the user can change means the arm **duplicates itself** the moment  │
   * │ it's renamed. Same reasoning as `github.ts` choosing `id` over `login`.  │
   * │                                                                          │
   * │ 📌 Asked against the full `MCP_URL`, NOT `/readonly`: at the moment      │
   * │ identity is asked for, nobody has picked a tier yet. (`get_workspace` is │
   * │ itself a read, so both URLs would answer it — but depending on that is   │
   * │ depending on a coincidence.)                                             │
   * │                                                                          │
   * │ Returns: {"id":"87a0dce5-…","name":"Agent-co-test","url":"https://…"}    │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  identity: {
    url: MCP_URL,
    tool: 'get_workspace',
    idField: 'id',
    labelField: 'name',
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ THE FIRST ENTRY WITH A REAL `checkedOn` — the guidelines were ACTUALLY    │
   * │ READ, not left blank.                                                     │
   * │                                                                           │
   * │ The user's call, 30/08: *"just change the logo to Linear's own, both on   │
   * │ the canvas node and the UI modal"*. Before pasting it in, read          │
   * │ linear.app/brand. Recorded verbatim what it says, because this is a       │
   * │ **fact**, not an impression:                                              │
   * │                                                                           │
   * │  · *"Do not alter these files in any way"*                                │
   * │  · Forbids combining the Linear logo with our own name/product, and       │
   * │    forbids **combining it with other imagery** — *"without written        │
   * │    consent from Linear"*                                                  │
   * │  · **Monochrome is PREFERRED** over the color version ⇒ exactly what we   │
   * │    use                                                                    │
   * │  · Third parties who want to use it should ask  hello@linear.app        │
   * │                                                                           │
   * │ ⚠⚠ A REAL OUTSTANDING DEBT, stated rather than hidden: the guidelines     │
   * │ **do require written consent** for the third-party case. We shipped       │
   * │ anyway, per the user's decision, and on the reasoning §11a-bis already    │
   * │ settled (a logo in a **list of connections** is the most defensible form  │
   * │ there is — it **only identifies** the service being connected to, and     │
   * │ implies no partnership). We also don't alter the artwork, don't recolor   │
   * │ it to a brand color, and don't combine it with other imagery.             │
   * │                                                                           │
   * │ 📌 DIFFERS from Notion/GitHub in one thing worth noting: those two entries│
   * │ have `checkedOn: null` — **blind debt**, nobody knows how big the risk is.│
   * │ This entry's debt **has a date, a verbatim quote, and an address to ask   │
   * │ permission at**. Before shipping publicly: email all three vendors, then  │
   * │ update this field.                                                        │
   * │                                                                           │
   * │ Path: a single `path` inside a 24×24 frame, `currentColor`, no fill, no   │
   * │ brand color. → `ArmIcon.tsx` (0 vendor names in the web code)             │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  brand: {
    owner: 'Linear Orbit, Inc.',
    guidelineUrl: 'https://linear.app/brand',
    checkedOn: '2026-08-30',
    // ⚠ ONE STRING, NOT CONCATENATED — see the reason at `github.ts §brand.mark`.
    // prettier-ignore
    mark: 'M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z',
  },
};
