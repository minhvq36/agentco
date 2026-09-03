/**
 * ONE CATALOGUE ENTRY = ONE FILE. → `../catalog.ts` · docs/SPEC-arms.md §5h
 *
 * The most heavily customised entry in the catalogue — device flow, toolsets,
 * server-side fencing, an install door, an installation probe. All of it is
 * **data in this file**; there is no `if (id === 'github')` branch anywhere in
 * the code.
 */

import type { CatalogArm } from '../catalog.js';

export const GITHUB_ARM: CatalogArm = {
  id: 'github',
  name: 'armCat.github.name',
  icon: '🐙',
  /**
   * ⚠ THIS SENTENCE MUST SAY THREE THINGS, and all three are easy to hide for
   * the sake of a tidier line:
   *
   * ① **It is not `git`.** No clone, no pull, no push, no local copy — editing a
   *    file is **a commit straight to the cloud repo**. That is a different
   *    working model, not a compact version of `git`.
   * ② **Commits carry the signed-in person's name** (measured 26/08: the author
   *    is the granting account itself, not a bot). Their repo history will hold
   *    commits in their name that **they did not type**.
   * ③ It reaches **private repos**, but only the ones they **installed the app on**.
   *
   * ⚠ CORRECTION 27/08 — the sentence *"it can only touch repos you installed
   * agentco on"* (written that same morning) is **WRONG FOR PUBLIC REPOS**.
   * Measured: `list_branches` ran on **all 16** repos while the app was installed
   * on **2**. A `ghu_` key reads public repos regardless of the installation —
   * the installation only fences **private** ones. Overstating a fence is a lie
   * worse than saying too little.
   */
  blurb: 'armCat.github.blurb',
  price: 'login',
  /**
   * 🔴 `auth` exists because GitHub **does not offer DCR** (measured 25/08,
   * confirmed again 26/08). But "no DCR" does **not** imply "the customer has to
   * register their own app" — that is the false step recorded in §4e. Device flow
   * needs no secret, so agentco puts its name on an app and ships the
   * `client_id` as data.
   *
   * GitHub App `agent-co.app` · org `@agent-co-app` · created 26/08/2026.
   * 📌 **NO client secret. NO private key.** The rule and the full reasoning:
   * SPEC-arms §5h·7h. With no key, the route to mint an installation token
   * **does not exist** ⇒ the app owner has no door into a customer's repos.
   * Forbidden structurally, not by discipline — the same invariant as §5b.
   *
   * An enterprise customer can put their own name on the app: the "use your own
   * GitHub App" field overrides this `clientId`.
   * → `oauth-routes.ts §deviceClientId` · §5h·7h
   */
  auth: { kind: 'device', clientId: 'Iv23li95pd8QpYfTGMho' },
  /** GitHub returns no identity in the token response ⇒ we have to ask. → §5h·7k */
  identity: {
    url: 'https://api.githubcopilot.com/mcp/x/context',
    tool: 'get_me',
    // `id`, not `login`: a person can rename their account, and a hash seed that
    // can change means the arm duplicates itself after a rename.
    idField: 'id',
    labelField: 'login',
  },
  spec: {
    kind: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer ${OAUTH}' },
    toolsetHeader: 'X-MCP-Toolsets',
    readOnlyHeaders: { 'X-MCP-Readonly': 'true' },
  },
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ FIVE TOOLSETS — THE GROUP NAME IS THE VENDOR'S NAME, NOT ONE WE INVENT.  │
   * │ (caught by the user 28/08)                                               │
   * │                                                                          │
   * │ > *"That first checkbox, 'Knows who I am, which repo' — I don't follow   │
   * │ >  it. I'd rather have the jargon, issue, action; it reads clearer."*    │
   * │                                                                          │
   * │ The old label tried to render `context` in plain words and rendered **the│
   * │ wrong radius**: it promised *"knows which repo"* while `context` only    │
   * │ holds `get_me` · `get_teams` · `get_team_members` — **not one repo tool**│
   * │ at all. Both confusing and untrue.                                       │
   * │                                                                          │
   * │ ⇒ The rule for every entry from here on: **keep the vendor's group name**│
   * │ (the user can look it up in the vendor's own docs), then **add a `help`  │
   * │ line saying WHAT IT CAN DO** — rather than replacing the vendor's name   │
   * │ with a description. The name is an address; a description is a           │
   * │ description. → [[agentco-count-mechanisms]]                              │
   * │                                                                          │
   * │ Token figures measured 26/08 (bytes÷4 estimate, used to COMPARE slices — │
   * │ the number shown in the interface must come from `getContextUsage()`):   │
   * │   context 3 tools ≈1,500 · repos 19 ≈10,000 · pull_requests 10 ≈8,300    │
   * │   issues 9 ≈8,000 · actions ?  ·  THE WHOLE SERVER 44 ≈30,000            │
   * │ ⇒ the default `context + repos` ≈11,600, and ≈8,500 at the read-only tier│
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  groups: [
    {
      id: 'context',
      label: 'armCat.github.context.label',
      help: 'armCat.github.context.help',
      on: true,
    },
    {
      id: 'repos',
      label: 'armCat.github.repos.label',
      help: 'armCat.github.repos.help',
      on: true,
    },
    {
      id: 'pull_requests',
      label: 'armCat.github.pulls.label',
      help: 'armCat.github.pulls.help',
    },
    { id: 'issues', label: 'armCat.github.issues.label', help: 'armCat.github.issues.help' },
    {
      id: 'actions',
      label: 'armCat.github.actions.label',
      help: 'armCat.github.actions.help',
    },
  ],
  tiered: true,
  /**
   * ⚠ `installations/new`, not the app page: for someone who HAS installed it,
   * GitHub redirects to the screen for editing the repo selection. One URL serves
   * both cases — first install and later change — so there is no need for an
   * "installed yet?" branch, which we **cannot read** from this side anyway.
   *
   * 📌 The app is set to **public** (confirmed by the user 27/08). Left private,
   * only the owner account can install it, and a customer clicking this button
   * walks into a dead end — a failure with no symptom on our side. Re-check this
   * every time the GitHub entry is touched.
   */
  scope: {
    say: 'armCat.github.scopeSay',
    url: 'https://github.com/apps/agent-co-app/installations/new',
  },
  /**
   * ⚠⚠ `gateTool` MUST be `list_repository_collaborators`, not some other read
   * tool. Measured 27/08 against the user's real installation (2 repos):
   *
   *   list_branches                  ✅✅✅✅  ← BLIND, always answers YES
   *   get_file_contents              ✅✅✅✅  ← BLIND
   *   list_repository_collaborators  ❌✅✅❌  ← DISCRIMINATES, 4 out of 4
   *
   * It requires **push** permission, which only exists on repos the app is
   * installed on. Swapping in another tool turns the probe into an
   * unconditional nod.
   */
  repoScan: {
    meTool: 'get_me',
    loginField: 'login',
    searchTool: 'search_repositories',
    searchQuery: 'user:${login}',
    gateTool: 'list_repository_collaborators',
  },
  /** Empty — the key comes from the login flow, exactly like Notion. → `price: 'login'` */
  secrets: [],
  /**
   * ⚠⚠ `checkedOn: null` while `mark` HAS A VALUE = **an open debt**. → §11c
   *
   * See the block of the same name in `notion.ts`. The path is the monochrome
   * Octocat, `currentColor`, no background, no brand colour. GitHub **does** have
   * a guidelines page (github.com/logos) — it has to be read and `guidelineUrl` +
   * `checkedOn` filled in before this ships publicly.
   */
  brand: {
    owner: 'GitHub, Inc.',
    guidelineUrl: null,
    checkedOn: null,
    // ⚠ ONE STRING, NEVER CONCATENATED. Cutting an SVG path into pieces and
    // joining them buys a silent failure: swallow exactly one space at a seam
    // (`3 .405` becoming `3.405`) and the shape is deformed — and no test catches
    // a deformed shape.
    // prettier-ignore
    mark: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12',
  },
};
