/**
 * English catalogue — THE SOURCE OF TRUTH for every user-visible app string.
 *
 * → docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY A FLAT MAP OF DOTTED KEYS, NOT A NESTED OBJECT.                      │
 * │                                                                          │
 * │ A nested catalogue needs type-level path inference to give `t()` a typed │
 * │ key, and that machinery breaks in ways nobody can read the error for.    │
 * │ A flat map gets the same guarantee from plain `keyof`: autocomplete on   │
 * │ every call site, and a compile error the moment a key is misspelt.       │
 * │                                                                          │
 * │ The guarantee that matters is in `vi.ts`: it is declared `: Catalog`, so │
 * │ `tsc` fails if a key is missing or extra. Catalogue completeness is a    │
 * │ COMPILE-TIME fact here, not a runtime lookup that quietly returns the    │
 * │ key back. Adding `zh.ts` later makes the compiler list what is missing.  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Placeholders are `{name}`. Anything with a plural form lives in `enPlural`
 * below, never here — English needs two forms where Vietnamese needs one, and
 * gluing a count onto a noun works in exactly one of those two languages.
 */

export const en = {
  // ─────────────────────────────────────────────────────────────── common
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.retry': 'Try again',
  'common.loading': 'Loading…',
  'common.create': 'Create',
  'common.creating': 'Creating…',
  'common.saving': 'Saving…',
  'common.deleting': 'Deleting…',
  /** Panels and dialogs waiting on their first fetch — not a page-level spinner. */
  'common.reading': 'Reading…',
  'common.saveFailed': 'Could not save.',
  'common.copyRef': 'Copy reference to {path}',
  'common.copyPath': 'Copy path',
  'common.dismissNotice': 'Dismiss notification',

  // ────────────────────────────────────────────────────────────────── app
  'app.fatalTitle': 'Lost connection to the company',
  /**
   * The whole screen after a shutdown — ONE line, and it has to do two things:
   * confirm that the thing the user asked for actually happened, and say what
   * to do with the tab now. There is no daemon left to serve anything else.
   */
  'app.poweredOff': 'The company is off. You can close this tab.',
  'app.openingCompany': 'Opening the company…',
  'app.openingOffice': 'Opening the office…',
  'app.noOfficesTitle': 'This company has no offices yet',
  'app.noOfficesHint':
    'Each office has its own assistant, its own people and its own knowledge base. Create the first one to begin.',
  'app.newOffice': 'New office',
  'app.noAgentsTitle': 'This office has no people yet',
  /**
   * Split around the button name so the name renders bold and stays identical
   * to the button it points at. One key holding the whole sentence would put
   * `<b>` in the catalogue, where a stray tag breaks the layout and no type
   * can catch it.
   */
  'app.noAgentsHintBefore':
    'The assistant does not do the work itself — it hands work out. Add your first person with the',
  'app.noAgentsHintAfter': 'button in the top-left corner.',
  'app.canvasHint': 'Drag nodes to arrange · connect the assistant to a person to grant access',
  'app.planRunning': 'running…',

  // ─────────────────────────────────────────────────── the office view (room)
  // → docs/SPEC-office-animation.md
  // ⚠ These are APP strings — furniture, tooltips, the accessible summary. What
  // a character SAYS is `say`, which passes through no catalogue and names no
  // language. → docs/CLAUDE.md §Language
  'office.desk': 'Results desk',
  'office.openResults': 'open the Results panel',
  'office.openLibrary': 'open the Document cabinet',
  // ⚠ NO `openArm` / `connectArm` ANY MORE. The arm bench is a LABEL, not a door:
  // one bench stands for N connections, so "open the nearest one" was a coin toss
  // wearing a rule. → SPEC-office-animation.md §17i
  'office.armNone': 'No connection',
  'office.breakArea': 'Break area',
  'office.summary': '{working} working, {resting} resting',
  'office.viewDiagram': 'Diagram',
  'office.viewRoom': 'Office',
  'office.viewDiagramTip': 'The diagram: build and wire up the company',
  'office.viewRoomTip': 'The room: watch what is happening right now',
  'office.character': 'Character',
  // ⚠ NO `characterHint`. Five faces in a row explain themselves; a paragraph
  // reassuring the reader that a costume costs nothing answers a worry the control
  // never raised. → SPEC-office-animation.md §17i
  'office.characterPick': 'Character {n}',
  'office.tint': 'Outfit colour',
  'office.tintCustom': 'Pick any colour',
  'office.hireHint': 'Nobody works here yet. Switch to the diagram to hire your first person.',
  'office.zoomIn': 'Zoom in',
  'office.zoomOut': 'Zoom out',

  // ───────────────────────────────────────────────────────────────── chat
  'chat.you': 'you',
  /** Fallback only — an office with a canvas shows the name the user chose. */
  'chat.assistant': 'Assistant',
  'chat.emptyTitle': 'Nothing said to the assistant yet',
  'chat.emptyHint':
    'Hand over work, or just ask something. The assistant tells the difference on its own — small talk costs no employee any tokens.',
  /** `<code>/help</code>` is markup, so the sentence is split around it. */
  'chat.emptyHintTypeBefore': 'Type',
  'chat.emptyHintTypeAfter': 'to see the list of commands.',
  'chat.placeholder': 'Hand over work, or ask the assistant…',
  'chat.messageLabel': 'Message',
  'chat.send': 'Send',
  'chat.openPreview': 'Open a preview in the Results panel',

  // ─────────────────────────────────────────────────────────────── header
  'header.office': 'Office',
  'header.archivedSuffix': ' (archived)',
  'header.rename': 'Rename office',
  'header.renameTip': 'Rename the office you have open',
  'header.newOffice': 'Office',
  'header.newOfficeTip': 'Create a new office',
  'header.stop': 'Stop',
  'header.stopTip': 'Stop the running work. The daemon stays up.',
  'header.shutdown': 'Shut down',
  'header.shutdownConfirm': 'Shut down?\n\nThe company will stop.',
  /*
   * ⚠ `header.update.*` LIVED HERE AND IS GONE. The banner it belonged to was
   * removed on 17/09/2026 (user's call, for focus): it announced a version and
   * could not act on one, so it was a dead end, and the action already lives at
   * the foot of the Settings panel. Keys with no call site are strings nobody
   * maintains and translators keep translating.
   * → web/src/components/Header.tsx · panels/SettingsPanel.tsx §UpdateAction
   */
  /**
   * ⚠ THE APP USED TO SHOUT ABOUT A NEW VERSION AND NEVER SAY WHICH ONE YOU
   * HAD. (added 16/09/2026, moved out of the header the same day)
   *
   * Every support conversation opens with "which version are you on?" and
   * "how did you install it?", and until now neither was answerable from the
   * interface — the only version string it ever drew was somebody else's, in
   * the update banner. Both facts were already on the client: `GET /api/update`
   * carries `current` and `kind` beside `latest`.
   *
   * ⚠ `kind` is SPELLED OUT rather than hidden in a tooltip. At the foot of a
   * settings panel there is room, and a tooltip says nothing to somebody
   * reading a support reply back over the phone.
   */
  'settings.footer': 'AgentCo © {year} · v{version}',
  'settings.updateTo': 'Update to {version}',
  // ⚠ It names the restart, because the page is about to go blank for a minute
  // and an unexplained blank page is how somebody decides an app is broken.
  'settings.updateWorking': 'Updating — this page will come back on its own.',
  'settings.updateFailed': 'Nothing changed. The old version is still running — see the terminal.',
  /**
   * ⚠ IT SAYS "INSTALLED", because it is — `writeCurrent()` already ran. What
   * did not happen is the restart, and it did not happen because somebody was
   * working. Saying "nothing changed" here (which is what the watcher would
   * conclude from `/healthz`) would be wrong twice: it changed, and the reason
   * it looks unchanged is a decision we made on the user's behalf.
   */
  'settings.updatePending': 'v{version} is installed — it starts the next time you open agentco. Work was running, so nothing was interrupted.',
  /**
   * Doubles as the tooltip and as the accessible name of the title, so it has
   * to say WHAT IT IS as well as what to do with it — "Rename" alone would
   * leave a screen reader announcing a nameless control at the top of the app.
   */
  'header.companyRenameTip': 'Company name — double-click to rename',
  'header.state.idle': 'idle',
  'header.state.working': 'working',
  'header.state.paused': 'paused',
  'header.state.stopped': 'stopped',
  'header.window.session': 'Session',
  'header.window.weekly': 'Week',
  'header.energy.allowed': 'plenty left',
  'header.energy.allowed_warning': 'close to the limit',
  'header.energy.rejected': 'limit reached',
  /**
   * Two keys rather than one with an optional `{plan}`: the plan name sits in
   * brackets mid-sentence, and languages disagree about whether an empty
   * bracket pair, a comma or nothing belongs there when it is absent.
   */
  'header.energyTip':
    'Your Claude account limit — shared with Claude Code and claude.ai, NOT this office’s spend. ',
  'header.energyTipPlan':
    'Your Claude account limit ({plan}) — shared with Claude Code and claude.ai, NOT this office’s spend. ',
  'header.energyUsed': 'used {pct}%',
  'header.energyResets': ', resets {when}',

  // ────────────────────────────────────────────────────────────── toolbar
  'toolbar.agent': 'Employee',
  'toolbar.agentTip': 'Add an employee to this office',
  'toolbar.arm': 'Connection',
  'toolbar.armTip': 'Plug in a connection for your people to use',
  'toolbar.arrange': 'Rearrange',
  'toolbar.arrangeTip': 'Rearrange the diagram',
  'toolbar.fit': 'Fit to view',
  'toolbar.zoomOut': 'Zoom out',
  'toolbar.zoomIn': 'Zoom in',

  // ────────────────────────────────────────────────────────────── confirm
  /**
   * Split from the markup rather than embedded in it. The line reads
   * `<b>Enter</b> to delete · <b>Esc</b> to cancel`, and a key holding the whole
   * sentence would force `<b>` into the catalogue — where a translator can
   * break the page with one unclosed tag.
   */
  'confirm.toDelete': 'to delete',
  'confirm.toCancel': 'to cancel',

  // ─────────────────────────────────────────────────────────────── errors
  'error.httpStatus': 'The server returned error {status}.',
  'error.lostDaemon': 'Lost connection to the company. Check the terminal — is the daemon still running?',
  /**
   * `safeJoin` refusing a path that climbs out of the office folder. The path is
   * usually one the model wrote, so the sentence has to name it: without the
   * path the reader cannot tell a traversal attempt from a typo in a config.
   */
  'error.pathOutside': 'That path leads outside the folder: {path}',

  // ────────────────────────────────────────── loading company.yaml / office.yaml
  /**
   * These are the sentences a person meets when a config file is wrong, so they
   * carry the fix, not just the diagnosis. Everything `config.ts` reports through
   * `process.emitWarning` stays an English literal instead: a warning is read by
   * whoever is watching the terminal, and the product carries on.
   */
  'cfg.notYaml': '{file} is not valid YAML: {reason}',
  'cfg.noCompanyYaml': 'No company.yaml in {dir}.\nRun `agentco init` to create a new company.',
  'cfg.badCompanyYaml': 'company.yaml is malformed:\n{detail}',
  'cfg.badOfficeYaml': 'offices/{office}/office.yaml is malformed:\n{detail}',

  // ─────────────────────────────────────────────────────── the cost report
  /**
   * Printed by `agentco cost` and after a shift. Left-column labels are padded
   * to 28 columns at the call site, so keep them well under that — and plain
   * Latin, since the padding counts code units rather than display columns.
   *
   * The line that matters most is the odd-cache-write warning: the same role
   * writing cache repeatedly inside one shift means something is breaking the
   * prefix, and it is the one failure a person cannot see without being told.
   */
  'cost.shift': 'Shift',
  'cost.nothingYet': 'No work recorded yet.',
  'cost.tasks': '{n} jobs',
  'cost.totalTokens': 'Tokens',
  'cost.tokenBreakdown': 'in {input} · cache-read {cacheRead} · cache-write {cacheWrite} · out {output}',
  'cost.spend': 'Spend',
  'cost.cacheReuse': 'Cache reuse',
  'cost.cacheBelow': 'under the 70% mark — the prefix is being broken',
  'cost.tokensPerTask': 'Tokens/job (p50 / p95)',
  'cost.colRole': 'role',
  'cost.colModel': 'model',
  'cost.colTasks': 'jobs',
  'cost.colTurns': 'turns/job',
  'cost.colTokens': 'tokens/job',
  'cost.colSeconds': 'secs/job',
  'cost.colCost': '$/job',
  'cost.priciest': 'Priciest',
  'cost.reask': 'Had to re-ask for format',
  'cost.reaskDetail': '{n} times  ⚠ extra spend — look again at that role’s prompt',
  'cost.oddCacheWrites': '⚠ Odd cache writes',
  'cost.oddCacheDetail':
    'role “{role}”: {writes} writes for {keys} keys — is someone editing roles or knowledge mid-shift?',
  'cost.runLine': 'This shift: {tasks} jobs · {cost} · {breakdown} · cache reuse {reuse}',

  // ──────────────────────────────────────────── slash commands in the chat box
  /**
   * The command WORDS stay English for everyone — a command set is a programming
   * interface, not a sentence. Only the one-line description follows the switch.
   * `COMMANDS` holds these as keys rather than sentences, because a module
   * constant would freeze the language at import. → `src/core/commands.ts`
   */
  'cmd.stop': 'Stop the running work',
  'cmd.approve': 'Approve whatever is waiting on you',
  'cmd.reject': 'Turn down whatever is waiting on you',
  'cmd.status': 'What is running, and what it has cost',
  'cmd.resume': 'Carry on the unfinished work of the shift that was stopped',
  'cmd.clear': 'Clear the conversation, filing what was settled into the notebook',
  'cmd.help': 'Show this list of commands',
  'cmd.orAlias': '(or {list})',
  'cmd.noSuch': 'There is no command “/{typed}”. Commands you can use:',
  'cmd.available': 'Commands you can use:',
  'cmd.escapeHint': 'To send a message that starts with “/”, type it twice: //',
  'cmd.refClash':
    'There are {n} files called “{name}”, and I will not guess which one you mean:\n{list}\nPaste the full path instead — the Copy button in Documents and in Results gives you exactly that string.',
  'cmd.refMissing':
    'I cannot find “{name}” in the document cabinet or in Results. Check the name for me, or use the Copy button in either drawer to get the exact path.',
  'cmd.lookingUpWeb': 'Looking it up on the web…',
  'cmd.reading': 'Reading {names}…',

  // ───────────────────────────────────── document cabinet: names and sniffing
  /**
   * A refusal has to say WHY, or the person tries the same file three times and
   * then gives up. That is what this whole block buys, and it is why `REFUSED`
   * is a table of reasons rather than one "unsupported format" sentence.
   */
  'lib.refuseImageText':
    'Employees cannot search an image by keyword. If the image has text in it, export it as a PDF and drop that instead.',
  'lib.refuseImage': 'Employees cannot search an image by keyword.',
  'lib.refuseVideo': 'Video is not in the document cabinet’s scope yet.',
  'lib.refuseAudio': 'Audio is not in the document cabinet’s scope yet.',
  'lib.refuseArchive': 'Archives are not accepted yet. Unpack it and drop the files in one by one.',
  'lib.refuseExecutable': 'Executable files are not accepted.',
  'lib.refuseDoc':
    'The old Word format (.doc) is nothing like .docx inside. Open it in Word and “Save As” .docx.',
  'lib.refuseXls':
    'The old Excel format (.xls) is nothing like .xlsx inside. Open it in Excel and “Save As” .xlsx.',
  'lib.refusePpt': 'The old PowerPoint format (.ppt). Open it and “Save As” .pptx.',
  'lib.nameEmpty': 'The file name is empty.',
  'lib.nameTooLong': 'The file name is too long. Shorten it and drop the file again.',
  'lib.nameHasSlash': 'A file name cannot contain / or \\.',
  'lib.nameInvalid': 'That is not a valid file name.',
  'lib.namePipe': 'A file name cannot contain |. Rename it and drop it again.',
  'lib.nameControlChar': 'The file name contains an invalid character.',
  'lib.nameLeadingDot': 'A file name cannot start with a dot — employees would never find it.',
  'lib.nameTrailingDot': 'A file name cannot end with a dot or a space.',
  'lib.nameNoExtension': 'The file needs an extension (.pdf, .docx, and so on).',
  'lib.nameWindowsDevice': '“{stem}” is a name Windows reserves for a device. Pick another.',
  'lib.extNotAccepted': '.{ext} is not accepted yet. Accepted: {list}.',
  'lib.extUnknown': '.{ext} is not accepted yet.',
  'lib.notRealPdf': 'This is not really a PDF, whatever the .pdf on the end says.',
  'lib.notRealZip': 'This is not really a .{ext} (inside, it has to be a ZIP package).',
  'lib.notText': 'This is binary data, not .{ext} text.',
  'lib.fileEmpty': 'The file is empty.',
  'lib.fileTooBig':
    'The file is {size}, over the {ceiling} ceiling. If it is a scan, compress it or split it before dropping it in.',
  'lib.duplicate': 'There is already a document called “{name}” in the cabinet.',
  /**
   * The counterpart of these lines for `INDEX.md` is hard-coded English in
   * `noteEn` / `stateEn`, because an employee reads that file. Same datum, two
   * renderers — see the box on `DocNote`.
   */
  'lib.notePdfReaderMissing':
    'The PDF reader did not load, so keyword search will not find this — most likely the installation is missing files. An employee can still read it if you name the pages. Run `npm install` again in the agentco folder, then drop the file in once more.',
  'lib.noteImageOnly':
    'A scan with no text layer — keyword search will not find it. An employee has to read it page by page, which costs more than usual.',
  'lib.notePassword': 'The file is password-protected — remove the password and drop it in again.',
  'lib.noteTooLarge': 'The file is too large to read. Split it up and drop it in again.',
  'lib.noteCorruptZip':
    'This .{ext} is corrupt, or not in the format its extension claims. Open it in the original application and “Save As” a fresh copy.',
  'lib.noteUnreadable': 'Could not read the contents: {detail}',
  'lib.shapeFirstRow': 'first row: {cells}',
  'lib.statePending': 'waiting',
  'lib.stateExtracting': 'reading',
  'lib.stateReady': 'ready',
  'lib.stateImageOnly': 'a scan',
  'lib.stateUnindexed': 'not indexed',
  'lib.stateFailed': 'failed',

  // ─────────────────────────────────────────────── OAuth handshake failures
  /**
   * Every one of these names WHICH STEP failed. Exchange, refresh and polling
   * are fixed by three different things, and a bare `fetch failed` sends the
   * reader to the wrong one — the "wrong door" class in SPEC-arms §5m.
   */
  'oauth.stepExchange': 'exchanging the code',
  'oauth.stepRefresh': 'refreshing',
  'oauth.stepPoll': 'polling',
  'oauth.stepDeviceStart': 'requesting the code',
  'oauth.stepNoReach': '[{step}] could not reach {url}: {reason}',
  'oauth.stepServiceDown': '[{step}] the service is erroring ({code}).',
  'oauth.stepFailed': '[{step}] failed: {code}{desc}',
  'oauth.stepHttp5xx': '[{step}] the service returned HTTP {status}.',
  'oauth.stepUnreadable': '[{step}] unreadable response (HTTP {status}): {body}',
  'oauth.stepNoAccessToken': '[{step}] the response carried no access_token (HTTP {status}).',
  /**
   * This one is deliberately NOT a pass-through of the service's own wording.
   * GitHub says `incorrect_client_credentials` for "this refresh token was
   * rotated or revoked" — the words point at the client id and secret, which
   * are fine. Forwarding it verbatim sends people to fix the wrong thing.
   */
  'oauth.grantDead': 'The key is no longer valid — you need to sign in again. ({code})',
  'oauth.noEgress':
    'Could not reach {url}.\nThis is an OUTBOUND connection from the machine running agentco, not an inbound one — so an inbound firewall, nginx or a VPN is not the thing to fix.\nCheck: does this machine reach the internet · does your company force a proxy (Node does not read HTTPS_PROXY on its own; set NODE_USE_ENV_PROXY=1).',
  'oauth.notMcpDoor':
    '{url} returned HTTP {status} — that is neither an MCP door nor a request for a key. Most likely the URL is wrong.',
  'oauth.noMetadata': 'Could not read the authorisation metadata of {issuer} (tried {tried} paths).',
  'oauth.noDcr':
    '{issuer} does not offer dynamic registration — this service requires creating an app yourself and pasting in the client_id.',
  'oauth.registerFailed': 'Registration failed: HTTP {status} — {body}',
  'oauth.noRefreshToken': 'This account has no refresh key — you need to sign in again.',
  'oauth.noDeviceFlow': '{issuer} does not support signing in with a device code.',
  'oauth.deviceStartFailed':
    '[requesting the code] failed (HTTP {status}): {detail}\nCheck this first: has the app got “device code sign-in” switched on at the service?',
  'oauth.deviceCodeExpired': 'The sign-in code has expired — press Sign in to get a new one.',
  'oauth.accessDenied': 'You turned the permission down on the service’s own page.',

  // ───────────────────────────────────── plan checking and scheduler receipts
  /**
   * Sentences the SCHEDULER writes, not an employee — so they follow the switch
   * like the rest of the chrome. The `continue` note appended to a task brief is
   * the opposite case and stays a hard-coded English literal in the source.
   *
   * "What happened + what to do next" is the whole rule here. A bare "it failed"
   * is useless to someone who does not write code — they cannot tell where to go.
   */
  'plan.noSuchRole': 'Task {task}: there is no role “{role}”',
  'plan.noSuchDep': 'Task {task}: it depends on “{dep}”, which does not exist',
  'plan.twoWriters': 'Task {task} and {other} both write “{path}”',
  'plan.inputMissingOnDisk':
    'Task {task} needs to read “{path}”, which is not on this machine — check the path',
  'plan.inputMissingUnwritten':
    'Task {task} needs to read “{path}”, but there is no such file and no task creates it',
  /**
   * The ONE check a `kind: "connection"` input gets. Names the employee, not
   * the connection: the fix is either a different employee or a wire on the
   * diagram, and both of those are things about a person.
   */
  'plan.connectionNoArm':
    'Task {task} wants to fetch “{path}” through a connection, but “{role}” is not wired to any',
  'plan.cycle': 'Circular dependency: {trail}',
  'plan.blockedPrevUnfinished': 'Could not run: the previous step is not finished.',
  'plan.blockedPrevCut': 'Could not run: the previous step was cut off and its results are incomplete.',
  'plan.whyHalfWritten': 'written half-way, not enough to use',
  'plan.blockedMissingInput': 'Could not run: a file it needs to read is missing.',
  'plan.whyNotOnDisk': 'not on disk',
  'plan.continuing': 'This is longer than one turn — carrying on ({n}/{max}).',
  'plan.roleGone': 'There is no role “{role}”',
  'plan.stalePrevUnfinished': 'the previous step did not finish: {list}',
  'plan.stalePrevEmpty': 'the previous step produced no files: {list}',
  'plan.causeMaxTurns':
    'This needed more steps than {role} is allowed. Raise the step limit on that person’s page, or split the request up.',
  'plan.causeBudget':
    'This hit the spend ceiling set for {role}. Raise the ceiling on that person’s page if it is worth it.',
  'plan.causeError': 'This hit an error and could not finish. See the detailed log.',
  'plan.doneWrote': 'Done, and wrote {what}.',
  'plan.asideOverBudget':
    'One small note: this cost more than the ceiling you set for {role}, so if you keep handing over work like this, consider raising it a little.',
  'plan.asideMaxTurns':
    'One small note: this used up {role}’s step limit — if you keep handing over work like this, consider raising it a little.',
  'plan.partialWrote':
    'The employee wrote {n} files before stopping: {list}. Have a look before deciding to rerun — it may already be enough.',
  'plan.wroteOutsideOffice': 'wrote outside the office: {list}',

  // ──────────────────────────────── company: offices, models and connections
  /**
   * `RunError` messages and the `say` lines that go out over SSE. Both land in
   * the interface verbatim, so both follow the switch. `process.emitWarning`
   * next to them stays an English literal — that one is read by whoever is
   * watching the terminal. → docs/CLAUDE.md §Language
   */
  'co.officeBroken': 'Office “{office}” is erroring: {why}',
  'co.noOffice': 'There is no office “{office}”.',
  'co.officeNameNeedsAlnum': 'An office name needs at least one letter or digit.',
  'co.officeNameTooLong': 'An office name cannot be longer than 60 characters.',
  'co.officeExists': 'There is already an office “{id}”.',
  'co.officeCreated': 'Created office “{name}”.',
  'co.officeBusyRename':
    'The office is running work, so its folder cannot be renamed yet. Press Stop and try again — or rename it once the work is done.',
  'co.officeRenamedWithFolder': 'Renamed the office to “{name}”, and its folder on disk followed.',
  'co.officeRenamed': 'Renamed the office to “{name}”.',
  'co.folderExists': 'The folder “{id}” already exists.',
  'co.officeNameTaken':
    'There is already an office called “{name}”. Two offices sharing a name means the picker at the top of the screen shows two identical rows — choose another name.',
  'co.noValidModelField': 'No valid model field.',
  'co.valueEmpty': 'The value for “{key}” cannot be empty.',
  'co.mustBeTier': '“{key}” has to be a TIER: {tiers}.',
  'co.modelsChanged': 'Models changed. Work already running keeps the old model until it finishes.',
  'co.unsupportedLanguage': 'The language “{language}” is not one of the supported ones.',
  /**
   * A ceiling, not a rule about taste: the title is drawn in a fixed-height
   * header beside the office picker and has no wrapping to fall back on. The
   * number is in the sentence because "too long" without one sends the user
   * back to delete characters and try again.
   */
  /**
   * `doctor`'s Claude Code row. It is checked BEFORE auth on purpose: without an
   * executable the auth check fails talking about a binary, and the reader
   * concludes their login is broken. → `cmdDoctor` · SPEC-packaging §2
   */
  'cli.checkClaude': 'Claude Code',
  'cli.checkClaudeNo':
    'not found — install Claude Code, or set `claude_path:` in company.yaml (paths tried below)',
  'co.nameTooLong': 'The company name is limited to {max} characters.',
  'co.nameChanged': 'The company name changed.',
  'co.armConfigMissing': 'This connection has no configuration.',
  'co.armAlreadyHere':
    'This office already has the connection “{label}”. Draw a wire from it to whoever needs it — one connection can be shared by several people.',
  'co.folderAlreadyCovered':
    'This folder is already covered by the office’s “{id}” connection. Wire “{id}” straight to whoever needs it — one connection can be shared by several people, and plugging in a second is paying tokens twice for the same thing.',
  'co.armPlugged': 'Plugged in “{label}”. Anyone wired to it can use it from the next job on.',
  'co.armNameEmpty': 'A connection name cannot be empty.',
  'co.noArm': 'There is no connection “{id}”.',
  'co.armRenamed': 'The connection is now called “{name}”.',
  'co.armUnplugged': 'Unplugged “{label}”. Plug it back in any time — its config and keys are kept.',
  'co.armDeleted': 'Deleted “{label}” from the shared list for good. The keys are kept.',
  'co.armStillInUse':
    '“{label}” is still in {n} offices ({offices}). Unplug it from each of them first — deleting something that is in use breaks someone else’s diagram.',
  'co.armGoneFromList':
    'The connection “{id}” is no longer in the shared list — it was probably just removed. Close this dialog and open it again.',
  'co.officeBusyStopFirst': 'The office is running work. Press Stop first.',
  'co.officeArchived': 'Put office “{name}” into the archive. It can be restored at any time.',
  'co.officeRestored': 'Restored office “{name}”.',
  'co.officeIdInvalid': 'That office code is not valid.',
  'co.officeDeleted': 'Deleted office “{id}” and its lines in the ledger, for good.',
  'co.ledgerPurged': 'Cleared {n} gone entries from the ledger.',
  /** The ledger's name for spending recorded before offices existed at all. */
  'co.beforeOfficesSplit': '(before the split into offices)',

  // ────────────────────────────────── the office: what the assistant says back
  /**
   * The assistant's own voice in the chat box, plus the office's `RunError`s.
   *
   * These are written by CODE, not by a model, which is why they follow the
   * switch: they are chrome. The model's own `say`/`answer` never passes through
   * here and never sees a locale. → docs/CLAUDE.md §Language
   */
  'off.planFailedHead': 'Splitting the work failed, so nothing has run yet. No employee has started on it',
  'off.planFailedRetry':
    'Send the request again with a bit more detail, or name the exact documents to use.',
  /**
   * ⚠ On the third identical failure, do NOT repeat "say it more clearly".
   *
   * By then we have EVIDENCE that rephrasing changes nothing — the 22/08 case:
   * the user retyped twice, each time clearer, and got back the same string byte
   * for byte, because the cause was two rules in the prompt fighting each other
   * and not their wording. Repeating the advice spends their time hunting for a
   * phrasing that does not exist.
   */
  'off.planFailedStuck':
    'This is the {n}th time I have got stuck in exactly the same way, so typing it again will most likely land in the same place — the snag is in how I split the work, not in how you phrased it. Try dropping one requirement from the sentence (especially anything that dictates where files go), or split it into two messages.',
  'off.cutByShutdown':
    'This was cut off part-way because the company shut down (an update, a restart, or a power cut). What finished is still in Results — send it again and I will do the rest.',
  'off.officeArchivedReadOnly':
    'Office “{name}” is in the archive, so it is read-only. Restore it from the company Overview and carry on.',
  'off.stopping': 'Stopping…',
  'off.mailboxFlooded':
    'That was quick — I still have {n} messages unread. Let me get through them first.',
  'off.messageFailed': 'Something went wrong handling your message.',
  'off.refsMissing':
    'I cannot find {list} in the document cabinet or in Results. Check the names for me, or use the Copy button in either drawer to get the exact path.',
  'off.lookupNoAnswerFiles':
    'I read them but could not pull out an answer. Ask something more specific, or hand it to an employee to read properly.',
  'off.lookupNoAnswerWeb': 'I looked it up but nothing came back that I am sure of. Ask something more specific.',
  'off.lookupPartial': '(I could not find {list}, so the answer above rests on the other {n} documents.)',
  'off.busyWillFollow': 'I am busy with something already. I will pick up what you just sent once it is done.',
  'off.addendumNoted': 'Noted as an addition. I will apply it as soon as the running job finishes.',
  'off.clearing': 'Clearing the conversation and filing what you settled… (a few seconds)',
  'off.nothingRunning': 'Nothing is running right now.',
  'off.stoppingAll': 'Stopping everything.',
  'off.stoppedAssistantTurn': 'Cut the assistant turn that was running.',
  'off.droppedQueued': 'Dropped {n} jobs still in the queue.',
  'off.finishedWorkKept': 'Finished work is kept — type /resume and I will do the rest.',
  'off.nothingHalfDone': 'Nothing is half-done. Send me something new.',
  'off.busyResumeLater': 'The office is busy. Wait for this shift to end, then type /resume.',
  'off.resuming': 'Carrying on with {n} unfinished jobs{of}. I am not re-planning — the old plan still stands.',
  'off.resumingOf': ' from “{request}”',
  'off.resumeFailed': 'Could not carry on.',
  'off.idleWithLeftovers':
    'Idle, but {n} jobs from “{request}” are still unfinished. Type /resume to finish them — I do not re-plan, so it costs no extra turn.',
  'off.idle': 'Idle. The office has {total} employees, {onDuty} of them on duty.',
  'off.statusRunning':
    'Running: {request}\nStep {step}/{steps} · {done}/{total} jobs · {turns} turns · {cost}',
  'off.clearBusy': 'There is work still running. Press Stop, or wait for it, and I will clear then.',
  'off.clearFailedKept': 'Could not clear the conversation. I left everything as it was — try again later.',
  'off.nothingToApprove': 'There is nothing waiting on you.',
  'off.stateResuming': 'Carrying on with unfinished work...',
  'off.statePlanning': 'The assistant is planning...',
  'off.stateReadingDocs': 'Reading {names}…',
  'off.statePaused': 'Paused.',
  'off.stateStopped': 'Stopped.',
  'off.stateWaitingOnYou': 'Waiting on your answer.',
  'off.stateDone': 'Done.',
  'off.noRolesAtAll':
    'This office has no employees yet. Press “+ Employee” on the diagram to add the first one.',
  'off.noRolesWired':
    'No employee has been given work. On the diagram, draw a wire from the assistant down to someone.',
  'off.linkedTasks': 'Chained {n} jobs that have to run in sequence ({list}) — they share files.',
  'off.browserLoginOpen':
    'This office’s sign-in window is open, so employees cannot use the browser. Close it and hand the work over again.',
  'off.rateLimited':
    'Out of Claude usage. The office is resting with {n} jobs still to do. Type /resume when the limit clears.',
  /**
   * ⚠ "Open a terminal" EARNS ITS WORDS: this is the one sentence in the set
   * that a reader meets in a BROWSER, where there is no prompt to type into.
   * Signing in is interactive and needs a TTY, so naming the command alone
   * would stop them one step later than the old sentence did.
   */
  'off.notSignedIn':
    'Not signed in to Claude Code. Open a terminal, run `agentco login` once, then try again.',
  'off.stopped': 'Stopped. {done}/{total} jobs done, {left} still to do.',
  'off.stoppedHave': 'Already there: {list}.',
  'off.resultsSaved': 'results saved',
  'off.stoppedResumeHint':
    'Type /resume and I will finish it — anything fully done is kept, anything cut off mid-way gets redone properly.',
  'off.sharedKnowledge': 'Shared knowledge',
  'off.documentCabinet': 'Document cabinet',
  'off.docDeletedWithNotes': 'Deleted “{name}” and {n} notes that only made sense because of it.',
  'off.layoutUpdated': 'The office diagram has been updated.',
  'off.roleIdShape': 'An employee code uses lower-case letters, digits and hyphens only.',
  'off.roleIdReserved': '“assistant” is a name reserved for the assistant.',
  'off.roleExists': 'This office already has an employee “{id}”.',
  'off.roleAdded': 'Added “{name}”.',
  'off.roleIdInvalid': 'That employee code is not valid.',
  'off.noRole': 'There is no employee “{id}”.',
  'off.roleFileMissing': 'Could not find the file roles/{id}.yaml.',
  'off.roleArchived': 'Put “{name}” into the archive.',
  'off.roleRestored':
    'Put “{name}” back on the diagram. Draw a wire from the assistant if you want to hand them work.',
  'off.roleDeleted': 'Deleted “{id}” for good.',
  'off.roleUpdated': 'Updated the profile for “{id}”.',
  'off.pitchEmpty': 'The pitch cannot be empty — it is the only thing the assistant sees.',
  'off.tierMustBe': 'The model tier has to be one of: {tiers}.',
  'off.budgetShape': 'The spend ceiling has to be a non-negative number. 0 means no limit.',
  'off.maxTurnsShape': 'The step limit has to be a whole number of 1 or more.',
  'off.officeNameEmpty': 'The office name cannot be empty.',
  'off.officeRenamed': 'The office has been renamed to “{name}”.',
  'off.assistantTierChanged': 'The assistant moved to tier “{tier}”. It applies from the next turn of chat.',
  'off.assistantNameEmpty': 'The assistant’s name cannot be empty.',
  'off.assistantNameTooLong': 'The assistant’s name cannot be longer than 40 characters.',
  'off.assistantRenamed': 'The assistant is now called “{name}”.',
  'off.noLayer': 'There is no layer “{id}”.',
  'off.layerReadOnly':
    'This layer is read-only. The core layer belongs to the source code — unlock it with `allow_core_prompt_edit: true` in company.yaml if you genuinely need to.',
  'off.layerTooLong':
    'Too long: {tokens} tokens against a {limit} ceiling. This block lives in the prefix cache, so every spare line is a cost charged for the whole shift.',
  'off.layerSaved':
    'Saved and live — no restart needed. Employees picking up work from now on use the new version; work already running keeps the old one until it finishes. Each employee’s first turn costs a little extra because the cache has to be rewritten.',
  'off.noNote': 'There is no note “{id}”.',
  'off.officeBusyWait': 'The office is busy. Wait for this shift to end.',
  'off.nothingToResume': 'There is no unfinished work to carry on with.',
  'off.nothingNewToRemember': 'Nothing new to remember.',
  'off.nothingToRemember': 'Nothing to remember — starting fresh.',
  'off.memoryUpTo': 'Memory up to {date}',
  'off.anError': 'an error',
  'off.compactFailed':
    'Could not compact the memory ({reason}), so I left the conversation as it was. Try /clear again later.',
  'off.transcriptGone':
    'I could not read back the old conversation (Claude Code’s transcript has been cleaned up), so nothing could be filed. The chat box is cleared and we start fresh.',
  'off.clearedWithNotebook':
    'Cleared the conversation. What you settled went into my own notebook — open the Knowledge drawer to read it.',
  'off.cleared': 'Cleared the conversation.',
  'off.autoCompacted': 'The conversation had got long, so I trimmed it. {note}',
  'off.sweptAlso': 'Also swept {what}.',
  'off.sweptAnd': ' and ',
  // ──────────────────────────── the assistant: sentences CODE writes, not the model
  /**
   * ⚠ Only the handful of lines `assistant.ts` builds ITSELF. The assistant's
   * own `say`/`answer` never passes through here — it comes back from the model,
   * in whatever language the human is writing in, and no locale ever touches it.
   * Everything in the route/report/compact prompts stays hard-coded English.
   * → docs/CLAUDE.md §Language
   */
  'as.emptyReply':
    'I reached the model but it returned nothing at all — that is a connection fault, not the way you phrased it. Send it again for me.',
  'as.emptyReplyPlanning':
    'I reached the model but it returned nothing at all — that fault is in the connection, not in the way you phrased it. Try again in a moment.',
  'as.noUsableAnswer':
    'That turn did not produce a usable answer. Try saying it a different way, or splitting the request up for me.',
  'as.planTextNotJson':
    'I could not split this into work. Instead of a plan, the assistant said:\n  "{text}"\nThat should have gone out through the clarifying-question route rather than straight through — so this is my fault, not the way you phrased it. Hand it over again exactly as it was: most cases like this work on the second attempt. If it asked something specific, answer that in the same message.',
  'as.done': 'Done.',
  'as.stoppedByUser': 'Stopped as you asked.',

  // ─────────────────────────────────── the employee: status line and stop reasons
  /**
   * ⚠ ONLY the half a PERSON reads. The refusals in `JAIL_REASON`, the GitHub
   * 404 hint and the replacement tool results are handed to the MODEL and stay
   * hard-coded English in `worker.ts`. Moving one of those in here would put the
   * interface switch inside a prompt. → docs/CLAUDE.md §Language
   *
   * The status line is the ONLY window a person has onto what an employee just
   * touched on their machine — which is why it names the search term, the room
   * and the actual shell command rather than saying "working".
   */
  'wk.doingRead': 'reading a document',
  'wk.doingReadFile': 'reading {file}',
  'wk.doingWrite': 'writing the result',
  'wk.doingWriteFile': 'writing {file}',
  'wk.doingSearchIn': 'searching{term} in {room}',
  'wk.doingSearchOutside': 'searching{term} outside the office',
  'wk.doingWebSearch': 'searching the web',
  'wk.doingWebFetch': 'reading a web page',
  'wk.doingRunCommand': 'running a command',
  'wk.doingRunning': 'running: {cmd}',
  'wk.doingUsingTool': 'using {tool}',
  'wk.doingWorking': 'working',
  /** Folder → the room a person knows, because they put the files there. */
  'wk.roomLibrary': 'the document cabinet',
  'wk.roomArtifacts': 'existing results',
  'wk.roomKnowledge': 'the knowledge base',
  'wk.roomOffice': 'the office',
  'wk.hitBudget': 'Task {task} hit the {ceiling} spend ceiling',
  'wk.hitMaxTurns':
    'This needed more steps than allowed ({turns} steps), so it stopped part-way.\n',
  'wk.hitMaxTurnsWithArm':
    '⚠ The employee HAD already called an outside connection before stopping — something out there may have changed, and it is not clear how far. Check that connection’s own log to see exactly what it did.\n',
  'wk.hitMaxTurnsNext':
    'What to do next: break the work into smaller steps, or raise this employee’s step limit.',
  'wk.receiptUnreadable': 'The employee returned a result that could not be read. See the detailed log.',
  'wk.receiptInvalid': 'invalid receipt: {problem}',
  'wk.stoppedClean': 'Stopped as you asked; nothing was written.',
  'wk.stoppedByUser': 'the human stopped it part-way',
  'wk.stopMaxTurns':
    'This needed more steps than one turn allows, so it stopped part-way. Try splitting the request up, or saying more clearly what comes first.',
  'wk.stopBudget': 'This turn hit the spend ceiling set for the job.',
  'wk.stopUsageLimit': 'The Claude account is out of usage.',
  'wk.stopRateLimit': 'Claude is overloaded; try again in a few minutes.',
  /**
   * ⚠ NAMES THE NEXT STEP, because "could not sign in" on its own leaves the
   * reader with nowhere to go — and the sentence this replaces (the vendor's
   * *"Please run /login"*) pointed at a command that does not exist outside an
   * interactive `claude` session. → `worker.ts §sayError`
   *
   * ⚠ KNOWN GAP, recorded rather than guessed at: the Windows installer puts no
   * `agentco` on PATH (T5 §61), so this line is right for the npm door and only
   * approximately right for that one. Branching on the install kind is the fix
   * and it is a separate change — one sentence that is right for most beats no
   * sentence at all, which is what was here before.
   */
  'wk.stopAuth': 'Could not sign in to Claude on this machine. Open a terminal and run `agentco login` once.',
  'wk.stopOther': 'Claude Code stopped part-way ({raw}).',

  'off.leftoversOnBoot':
    'The previous shift left {n} jobs unrun{of}. Type /resume and I will finish them, reusing the old plan so it costs no extra planning turn. Or just send something new — what finished is still in Results.',
  'off.wroteOutside':
    'Results were written, but outside the office, so the Results panel cannot see them: {list}. The files are real and usable — have a look, then tell me to copy them into place; no need to rerun anything.',
  'off.filesMissing':
    'There are {n} files that should have been written and are not on disk: {list}. The employee reported finishing but the results are not there — tell me to redo this job.',
  'off.startingNow': 'Starting now.',
  'off.resultsSavedAt': 'Results saved at:',
  'off.perShiftFolder': '(each shift gets its own folder so the next run does not overwrite this one)',
  'off.usedArms': 'Connections used: {list}',
  'off.armResultsMayBeOutside': '(a connection’s results may live outside the office folder)',
  'off.ranShellCommands': 'Commands were run on this machine — results may live outside the office folder.',
  'off.stepsUnfinishedHead': '{n}/{total} steps are still unfinished',
  'off.stepsUnfinishedTail': 'The results above cover only the part that was done.',
  'off.pathsMentioned':
    'You mentioned {list}. A plan always puts results inside the office folder, so the files are at the paths listed below. To have them land directly outside it, plug in a “Files on this machine” connection pointing at that folder and hand it to an employee — that is the only route that writes outside and still reaches the log.',

  // ──────────────────────────────────────────────────────────── CLI output
  /** Everything a person reads in the terminal. Logs and internal throws stay English literals. */
  'cli.noCommand': 'There is no command “{command}”.\nRun `agentco help` for the list.',
  'cli.alreadyInit': 'A company already exists at {dir}. Nothing overwritten.',
  'cli.created': 'Created a company at {dir}\n',
  'cli.createdCompanyYaml': '  company.yaml   shared config — spend ceilings and models live here',
  'cli.createdOffices': '  offices/       one folder per office, each self-contained\n',
  'cli.createdEmpty': 'The company is EMPTY — no offices yet. That is normal.',
  'cli.createdNext': 'Next:  agentco start   then press “Create an office”',
  'cli.alreadyRunning': 'The company is already running at {url} (pid {pid})',
  'cli.shutFromUi': '\nShut down as asked from the interface.',
  'cli.running': '{name} is running',
  'cli.noOfficesHint': '  no offices yet — open the interface and press “Create an office”',
  'cli.officeLine': '  {name} {agents} employees · {notes} notes{error}',
  'cli.staleBuild': '\n⚠ The interface is serving an OLD build — web/src changed and was not rebuilt.',
  'cli.staleBuildFix': '  npm run build:web    rebuild once',
  'cli.staleBuildDev': '  npm run dev:web      edit the interface with hot reload',
  'cli.ctrlC': '\nCtrl+C to shut down. Closing the browser tab does NOT stop the company.',
  'cli.closing': '\nClosing…',
  'cli.notRunning': 'The company is not running.',
  'cli.stopSent': 'Asked pid {pid} to shut down.',
  'cli.daemonError':
    'The daemon answered with error {status}. If you have just upgraded agentco, run `agentco stop` then `agentco start`.',
  'cli.daemonMismatch':
    'The daemon is running a different version from this CLI.\nRun:  agentco stop   then   agentco start',
  'cli.companyFallback': 'Company',
  'cli.notRunningStart': 'The company is not running.\nStart it with:  agentco start',
  'cli.noOffices': '  no offices yet',
  'cli.officeStatusLine': '  {name} {state} {agents} employees · {notes} notes',
  'cli.noOfficesPlain': 'No offices yet.',
  'cli.officeNameMissing': 'Missing the office name.\nExample:  agentco office new "Content"',
  'cli.officeCreated': 'Created office “{name}” ({id}).',
  'cli.officeIdMissing': 'Missing the office code.\nExample:  agentco office {sub} content',
  'cli.officeArchived': 'Office “{id}” moved to the archive. Restore it with: agentco office restore {id}',
  'cli.officeRestored': 'Office “{id}” restored.',
  'cli.officeRmMissing': 'Missing the office code.\nExample:  agentco office rm content',
  'cli.officeRmWarn':
    'Deleting office “{id}” for good: every employee, skill, knowledge note and result goes.\nThere is no getting it back.\n\n  To put it away and take it back later:  agentco office archive {id}\n  To really delete it:                    agentco office rm {id} --yes',
  'cli.officeRemoved': 'Deleted office “{id}” and all of its files.',
  'cli.officeNoSub':
    'There is no command “office {sub}”.\nUse: office list | office new "Name" | office archive <id> | office restore <id> | office rm <id> --yes',
  'cli.noSecrets': 'No secret stored yet.\nAdd one with:  $env:VALUE="..."; agentco secret set KEY_NAME',
  'cli.secretsHeader': 'Stored secrets (NAMES only):',
  'cli.secretsGrant':
    '\nGrant one to an employee by adding it to roles/<id>.yaml:  secrets: [KEY_NAME]',
  'cli.secretNameShape':
    'A secret name is UPPER CASE, letters, digits and underscores only.\nExample:  agentco secret set NOTION_TOKEN',
  'cli.secretMissing': 'There is no secret “{name}”.',
  'cli.secretRemoved':
    'Deleted “{name}”. Any employee still declaring it will report a missing key on its next run.',
  'cli.secretNoValue':
    'Missing the value. Pass it through the VALUE environment variable so it stays out of your shell history:\n  PowerShell:  $env:VALUE="paste-the-key-here"; agentco secret set {name}\n  bash:        VALUE=\'paste-the-key-here\' agentco secret set {name}',
  'cli.secretSaved': 'Saved “{name}” into .state/secrets.json (never committed, never sent over HTTP).',
  'cli.secretNoSub':
    'There is no command “secret {sub}”.\nUse: secret list | secret set <NAME> | secret rm <NAME>',
  'cli.runMissing':
    'Missing the work to do.\nExample:  agentco run "write 3 intro posts for product X" --office content',
  'cli.runHandedOver': 'Handed the work to “{office}”. Follow it at {url}',
  'cli.planHeader': '\nPlan:',
  'cli.noOfficeYet': 'No offices yet.\nCreate one with:  agentco office new "Office name"',
  'cli.noSuchOffice': 'There is no office “{wanted}”.\nAvailable: {list}',
  'cli.whichOffice':
    'There are {n} offices, so this needs to say which one.\nAdd:  --office <code>\nAvailable: {list}',
  'cli.purgeNothing': 'The ledger has no “gone” entries — nothing to clear.\n',
  'cli.purgeDone': 'Cleared {offices} gone entries · {tasks} jobs · {cost}\n',
  'cli.costByOffice': '\nBy office:',
  'cli.costLine': '  {name} {tasks} jobs · {turns} turns · {cost}',
  'cli.prefixLine': '  {role} {key}  ~{tokens} static tokens',
  'cli.checkNode': 'Node >= 22',
  'cli.checkNodeNote': 'running {version}',
  'cli.checkCompanyDir': 'Company folder',
  'cli.checkWritable': 'Write access',
  'cli.checkOffices': 'Offices',
  'cli.checkOfficesNone': 'no offices yet — create one in the interface',
  'cli.checkOfficesBroken': '{broken}/{total} broken: {list}',
  'cli.checkOfficesOk': '{n} offices, all of them load',
  'cli.unknownError': 'unknown error',
  'cli.checkAuth': 'Claude Code sign-in',
  'cli.checkAuthOk': 'a test call went through',
  'cli.checkAuthHint': 'run `agentco login` once to sign in',
  'cli.checkAuthTimeout':
    'no answer within {seconds} s — check the network, then run `agentco login` once to sign in',
  'cli.loginStarting': 'Signing in to Claude Code. Finish it in the browser it opens.\n  {path}',
  'cli.loginTokenStarting':
    'Asking Claude Code for a long-lived token. It prints it ONCE and stores nothing — copy it into CLAUDE_CODE_OAUTH_TOKEN.\n  {path}',
  'cli.checkDaemon': 'Daemon',
  'cli.checkDaemonNo': 'not running — `agentco start`',
  'cli.createdShortcutHint': '  Want it in the applications menu? Run `agentco shortcut` here.',
  'cli.updateRestarting': 'Version {version} is in place — restarting on the same port.',
  'srv.updateNotPackaged':
    'This copy was installed with npm, so it updates with `agentco update` rather than from here.',
  'srv.updateBusy': 'An update is already running.',
  /**
   * ⚠ NAMES THE OFFICES. "Something is busy" sends somebody opening offices one
   * by one; a name is a sentence they can act on — the same rule `officeJail`
   * follows by denying WITH the right path.
   *
   * ⚠ And it says what would have happened, because the consequence is not
   * obvious: the update ends by killing the daemon, and a task that dies with
   * it is written down as `failed` — the log would blame the work for what the
   * update did. → `company.ts §workingOffices`
   */
  'srv.updateOfficeBusy':
    'Not updating while there is work running — {offices} is busy. Applying an update stops the company, and a task caught by that is recorded as failed, which would blame the work for something the update did.\nWait for it to finish, or press Stop, then update.',
  // ⚠ Nothing was stopped. The check happens before the daemon is touched, so
  // this is a refusal rather than the wreckage of an attempt.
  'srv.updateNoNpm':
    'No npm was found beside this Node, so there is nothing to hand the work to. Nothing was stopped.',
  'cli.versionNpm': '  installed with npm',
  'cli.versionPackaged': '  installed from the app installer',
  // ⚠ Both say the company folder survives. Somebody removing a program does
  // not expect to be asked about their documents afterwards, and would not
  // forgive finding out later that nobody asked.
  'cli.versionRemoveNpm':
    '  remove with:  npm uninstall -g {package}    (the company folder stays — it is your data)',
  'cli.versionRemovePackaged':
    '  remove from:  Settings → Apps → AgentCo    (the company folder stays — it is your data)',
  'cli.updatePackaged':
    'This copy came from the installer, not from npm, so `agentco update` is not its door.\nGet the new version at {url} and install it over this one — the folder it proposes is the one you are in.',
  'cli.updateAlready': 'Already on {version}, which is the newest there is.',
  'cli.updateNoNpm':
    'Cannot find npm beside this Node, so there is nothing to hand the work to. The company was NOT stopped.\nUpdate it yourself with:  {command}',
  /**
   * ⚠ THE `HandedOff` PAIR AND `updateLog` ARE GONE (18/09/2026), and the three
   * of them went together because they described ONE arrangement that no longer
   * exists: a command that started a detached job, returned at once, and printed
   * a path into TEMP where the real news would later appear.
   *
   * `agentco update` now runs npm in front of the person and waits for it, so
   * npm's own output IS the progress and IS the error. A sentence promising a
   * log file would be pointing at nothing. → `cli/index.ts §updateInTerminal`
   *
   * ⚠ The second one drops a promise the first one cannot keep: nothing was
   * running, so nothing will be started, and saying otherwise is the cheapest
   * way to look broken while working correctly.
   */
  'cli.updateStarting': 'Installing {target}, then starting the company again.',
  'cli.updateStartingIdle': 'Installing {target}.',
  /**
   * ⚠ REFUSED, NOT FAILED, and the sentence has to carry that: nothing was
   * replaced and the company is still there. Both numbers are in it because
   * "not enough space" sends somebody to look at a disk without knowing how
   * much they are looking for.
   *
   * 🔴 The cost of NOT saying this, measured 18/09: npm removed the old copy,
   * ran out of room before writing the new shims, and `agentco` stopped
   * existing as a command. There is no way back from inside — the thing that
   * would repair it is what vanished. → cli/update-run.ts §checkSpace
   */
  'cli.updateNoSpace':
    'Not enough disk space to install, so nothing was touched — the company is untouched and still works.\nInstalling needs about {need} free; “{dir}” has {free}.\nFree some space and try again. `npm cache clean --force` is usually the largest easy win.',
  /**
   * ⚠ NAMES THE CAUSE, because "permission denied" alone sends people to
   * `sudo` — which is what put the machine in this state. The folder belongs to
   * root precisely because the install was run that way, and doing it again
   * only moves the problem one release further along.
   *
   * ⚠ Same shape as `cli.updateNoSpace` above and for the same reason: refused,
   * not failed. Nothing was replaced, the company is still there.
   * → cli/update-run.ts §checkWritable
   */
  'cli.updateNoPermission':
    'No permission to install into “{dir}”, so nothing was touched — the company is untouched and still works.\nThat folder belongs to another user, which is what installing with sudo leaves behind.\nGive npm a prefix you own and install once more: `npm config set prefix ~/.npm-global`, then put `~/.npm-global/bin` on your PATH.',
  /**
   * ⚠ THESE THREE ARE PRINTED SEPARATELY, and the middle one is often absent.
   * Naming the neighbour is only possible when it answered `/healthz`; claiming
   * "another agentco is running" about a stranger's service would be a guess
   * dressed as a fact, and the reader cannot check it either. → cli/port.ts
   */
  'cli.portMoved':
    '  Port {from} was taken, so this company moved to {to} — written to runtime.port in {file}.',
  'cli.portBusy': 'Port {port} is in use, so this company did not start.',
  'cli.portBusyAgentco':
    'Another agentco company is answering there (v{version}) — most likely the packaged app, which keeps a company of its own. It is open at {url}',
  'cli.portBusyAsked':
    'It was named with --port, so nothing was moved and nothing was written. Free right now: {next}',
  'cli.portBusyNoneFree':
    'Nothing above it is free either. Close whatever is holding these ports, or set runtime.port in {file} — {next} is the next one worth trying.',
  'cli.portBusyUnknownAgentco':
    'An older agentco (v{version}) is on that port and does not say which company it serves. This company was NOT moved, in case the two are the same folder. Update that one, or run this one with --port {next}.',
  'cli.alreadyRunningAtPort':
    'This company is already running at {url} — opening it. (Its daemon record was missing, so use the “Shut down” button in the tab rather than `agentco stop`.)',
  /**
   * ⚠ IT USED TO SAY "on Windows, the installer already adds one" — TO PEOPLE
   * WHO NEVER RAN THE INSTALLER. (fixed 16/09/2026)
   *
   * There are two doors onto Windows, the packaged installer and npm, and only
   * the first one leaves an icon behind. The sentence was written when there
   * was only one, and it went on pointing everybody at a Start menu entry that
   * does not exist for anyone who arrived through `npm i -g`. An error that
   * sends you to the wrong door costs more than no error at all: it spends the
   * reader's next ten minutes looking for something that was never there.
   */
  'cli.shortcutNotLinux':
    'A menu shortcut is only created on Linux for now.\nOn Windows an icon comes from the packaged installer at agent-co.app; installed from npm, the company is started with `agentco start`.\nOn macOS there is no menu entry either way — `agentco start` is the way in.',
  'cli.shortcutNoCompany': 'There is no company at {dir}.\nRun `agentco init` there first, then `agentco shortcut`.',
  'cli.shortcutCreated': 'Added “{name}” to the applications menu.\n  {file}',
  'cli.shortcutNodeNote': 'It starts with Node {version}. If you switch Node versions, run `agentco shortcut` again.',
  'cli.launchFailedTitle': 'AgentCo could not start',
  'cli.help': `agentco — a virtual company that runs on your own machine

agentco init                   Create a new (EMPTY) company in ./company
agentco start                  Start the company + open the interface  (run again to reopen the tab)
agentco stop                   Shut the daemon down
agentco status                 Show the company and its offices

agentco office list            List the offices
agentco office new "Name"      Create an office (with an assistant, no employees yet)
agentco office rm <code>       Close an office  (add --delete-files to delete it for good)

agentco secret list            Show the NAMES of stored keys (never the values)
agentco secret set <NAME>      Store a key  (value passed through the VALUE env var)
agentco secret rm <NAME>       Delete a key

agentco run "<work>"           Hand over one job  (--office <code> when there are several)
agentco cost [--since 7d]      See what has been spent  (--office <code> to filter)
agentco cost --purge           Clear "gone" entries from the ledger (deleted offices)
agentco version                Which version this is, and which copy you are running
agentco doctor                 Check whether the machine is ready
agentco login                  Sign in to Claude Code  (--token for a container's long-lived key)
agentco update [--to <ver>]    Install the newest version and start again  (npm installs)
agentco shortcut               Add this company to the applications menu (Linux)

Common options:  --dir <path>  --port <n>  --host <ip>  --no-ui

Closing the browser tab does NOT stop the company. To stop it: the "Shut down" button, or \`agentco stop\`.`,

  // ──────────────────────────────────────────────────── daemon / HTTP API
  /**
   * ⚠ These are sentences the DAEMON writes and the UI renders verbatim
   * (`web/src/lib/store.ts` — "the backend already returned an explainable
   * sentence; the job here is to show it, not swallow it"). That is why they
   * live in the shared catalogue rather than in `web/`.
   *
   * A LOG LINE IS NOT ONE OF THESE. `process.emitWarning`, `console.*` and
   * internal guards stay English in the source, always — they are read by us,
   * not by the person using the product. → docs/CLAUDE.md §Language
   */
  /**
   * Shown wherever `company.yaml` has no `name:` — i.e. nobody has named the
   * company. It is OUR label, so it follows the switch; the moment a person
   * types a name it becomes their datum and this key is never consulted again.
   */
  'company.unnamed': 'My company',
  /**
   * Same shape as `company.unnamed`, one level down: shown wherever an
   * `office.yaml` carries no `name:`. It is resolved per parse, not once at
   * module load — a schema default frozen at import would pin the label to
   * whichever language the process started in and never change again.
   */
  'company.unnamedOffice': 'New office',
  /**
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ EVERY REMAINING `seed.*` KEY IS A VALUE, NEVER A COMMENT. (settled 03/09)│
   * │                                                                          │
   * │ There used to be fifteen more here, rendering the explanatory `#` blocks  │
   * │ written into `company.yaml`, `office.yaml` and `roles/<id>.yaml`. All     │
   * │ deleted: a generated file carries no comments at all now, in any          │
   * │ language. → the box on `companyTemplate` in `src/cli/index.ts`           │
   * │                                                                          │
   * │ What is left is seed CONTENT — text that becomes the user's own datum the │
   * │ moment it lands, and is never translated again afterwards. It follows the │
   * │ switch only at the instant of writing.                                   │
   * └──────────────────────────────────────────────────────────────────────────┘
   */
  /*
   * ⚠ `seed.assistantSkills.body` USED TO LIVE HERE, and its removal on 05/09
   * is the sharpest example of the box above.
   *
   * It was the starting content of `skills/assistant.md`. It qualified as seed
   * CONTENT under every rule stated above — and it still broke the language
   * rule, because unlike a company name or an office label, this particular
   * datum goes on to sit inside a PROMPT for the rest of the office's life.
   * "Becomes the user's datum" and "never reaches a prompt" are two different
   * tests, and this key passed the first while failing the second.
   *
   * The advice itself is not lost: `promptLayer.assistantSkillsPlaceholder`
   * still shows it, in the very editor for that file, at zero tokens until the
   * person chooses to adopt it. → `company.ts §newOffice`
   */
  /*
   * ⚠ `seed.rolePitchDefault` USED TO LIVE HERE — deleted 05/09, and it is the
   * THIRD instance of the wire above, after the charter (17/08) and
   * `skills/assistant.md` (05/09 the same morning).
   *
   * It filled a new employee's `pitch` when the person typed a name and pressed
   * Enter. `pitch` is what the Assistant routes on and it sits in the cached
   * prefix of every turn, so this seed failed the "never reaches a prompt" test
   * as squarely as the skills block did — and it was worse in one way the other
   * two were not: *"What X can do, written for the assistant to read"* carries
   * NO information about what X actually does. The Assistant was routing on
   * noise, and the worker was never picked, for a reason nobody could see.
   *
   * There is no replacement value. Creating an employee now REQUIRES a
   * description, exactly as editing one always has (`updateRole` →
   * `off.pitchEmpty`, `RoleSchema` → `min(1)`), and the advice stays where
   * advice belongs: `dialog.newAgent.pitchPlaceholder` and `…pitchTip`, read in
   * the field itself, at zero tokens. → `office.ts §addAgent`
   */
  /**
   * ⚠ VALUES written during a v0 → multi-office migration.
   *
   * `migrate.ts` only ever runs on a company that already exists, so these
   * resolve at the locale that installation was already running under — and once
   * written they are the user's data, never translated again. Renaming the
   * office in the interface overwrites them and these keys are never consulted
   * for that company again.
   */
  'seed.mainOfficeName': 'Main office',
  'seed.assistantName': 'Assistant',
  'srv.missingField': 'missing “{field}”',
  'srv.badToken': 'wrong token',
  'srv.hostNotAllowed': 'Host not allowed',
  'srv.crossOrigin': 'the request came from another site — blocked',
  'srv.noOffice': 'no such office',
  'srv.noPlan': 'no such job',
  'srv.noRole': 'no such role',
  'srv.noDoc': 'no such document',
  'srv.noDocOrOriginal': 'no such document, or the original is gone',
  'srv.noArtifact': 'no such result',
  'srv.noRoute': 'no such route',
  'srv.armFieldsMissing': 'missing “config”, “catalogId” or “armId”',
  'srv.catalogOrAccountMissing': 'missing “catalogId” or “account”',
  /*
   * ⚠ "the same machine", not "the very machine running it". Someone using the
   * Docker door is sitting at that physical machine, so the old wording read as
   * plainly false and sent them looking for a bug that is not there. The daemon
   * is in a container; the window would open inside it, where there is no
   * screen. Naming the container is the difference between a refusal a person
   * can act on and one they argue with. (reworded 18/09/2026, after a test)
   */
  'srv.loopbackOption':
    '“{label}” can only be switched on when your browser and the daemon are on the same machine. The window opens where the daemon runs — and a container counts as a different machine, so under Docker nobody would ever see it.',
  'srv.probeListFailed':
    'Could not connect to read the list of actions: {reason}. A connection with a permission limit cannot be plugged in until we know which action sits at which level.',
  'srv.noToolsAtTier':
    'The server returned {n} actions but NOT ONE of them belongs to this permission level. Most likely the server declares no annotations — pick a higher level, or choose the actions one by one.',
  'srv.bindRefused':
    'Refusing to bind {host} with no sign-in token.\nOpening this port to the network means letting strangers run commands on your machine.\nSet AGENTCO_TOKEN=<a secret string> and try again.',
  'srv.connected': 'Connected {name}.',
  'srv.browserLoginLocalOnly':
    'The sign-in window only opens when your browser and the daemon are on the same machine — it would appear where the daemon runs, and a container counts as a different machine, so under Docker there would be nothing to look at.',
  'srv.previewTooBig': 'The file is {mb}MB, too large to preview. Download it to open it.',
  'srv.bodyNotJson': 'What was sent up is not valid JSON.',
  'srv.uploadTooBig':
    'The file is over the {mb}MB ceiling. Change the ceiling in company.yaml (library.max_file_mb) if you genuinely need to.',

  'srv.notBuiltTitle': 'AgentCo — the interface is not built',
  'srv.notBuiltH1': 'The interface has not been built',
  'srv.notBuiltRun': 'The daemon is running fine — only the interface is missing. Run this once:',
  'srv.notBuiltFromRoot': 'Or from the repository root:',
  'srv.notBuiltReloadBefore': 'Then reload this page. The API is up, so',
  'srv.notBuiltReloadAfter': 'in the terminal already works.',

  // ────────────────────────────────────────────────────── OAuth sign-in
  'srv.oauthLoopbackHost':
    'The daemon is listening on “{host}”, so “http://127.0.0.1” is NOT the address a person types into their browser — the service would send the authorisation code back to the wrong machine.\nDeclare the real address and try again:\n{hint}\nor set runtime.public_url in company.yaml.',
  'srv.oauthPublicUrlInvalid': 'runtime.public_url is not a valid URL: “{raw}”',
  'srv.oauthPublicUrlScheme': 'runtime.public_url has to be http or https, it is “{scheme}”',
  'srv.oauthPublicUrlInsecure':
    'runtime.public_url uses http:// for an address outside this machine (“{host}”).\nThe authorisation code would travel the network in the clear — anyone in the middle could turn it into a key.\nUse https, or put nginx/Caddy in front to handle the TLS.',
  'srv.oauthPublicUrlQuery': 'runtime.public_url cannot contain “?” or “#”: “{raw}”',
  'srv.oauthNotLoginService': '“{id}” is not a service you can sign in to.',
  'srv.oauthNoLoginNeeded': '{url} needs no sign-in — plug it straight in.',
  'srv.oauthPageFailedTitle': 'Not connected',
  'srv.oauthPageFailedBody': 'The service replied: {error}. Go back to agentco and try again.',
  'srv.oauthPageExpiredTitle': 'This sign-in has expired',
  'srv.oauthPageExpiredBody': 'Go back to agentco and press Sign in once more.',
  'srv.oauthPageNoCodeTitle': 'No authorisation code',
  'srv.oauthPageNoCodeBody': 'The service sent no code back. Try again from agentco.',
  'srv.oauthPageExchangeTitle': 'Could not exchange the code for a key',
  'srv.oauthPageDoneTitle': 'Connected',
  'srv.oauthPageDoneBody': '{who} works inside agentco from now on.',
  'srv.oauthPageDoneFallbackWho': 'Your account',
  'srv.oauthPageSaveFailedTitle': 'Could not save the account',
  'srv.oauthNotAClientId':
    'That string does not look like a Client ID. A Client ID is public data and short (a GitHub App looks like “Iv23li…”). Never paste a client secret or a private key here.',
  'srv.oauthNoDeviceLogin': '“{id}” does not sign in by device code.',
  'srv.oauthDeviceGone':
    '{issuer} no longer supports signing in by device code — this catalogue entry needs updating.',
  'srv.oauthNoIdentityYet':
    'Access was granted, but we could not read the account’s own identity for {who}, so nothing was saved — saving now would let this account overwrite a different {who} account. Press Sign in once more; the next attempt usually goes through.',
  'srv.oauthNoIdentityTwice':
    'Could not ask for the account identity ({name}) after 2 attempts — NOT saving the key, because without an identity two accounts on this same service merge into one.',
  'srv.oauthSessionExpired': 'This sign-in has expired — press Sign in once more.',
  'srv.oauthUnnamed': '(unnamed)',
  'srv.oauthKeyDead': 'The key “{label}” is no longer valid — sign in again. {detail}',
  'srv.oauthNoAccount': 'There is no account “{name}”.',
  'srv.oauthAccountInUse':
    '“{label}” is still used by {n} connections ({who}). Remove those connections first — removing the account first leaves a dead connection standing.',

  // ────────────────────────────────────────────────── live activity line
  'activity.reading': 'reading your request…',
  'activity.assistantThinking': 'The assistant is thinking…',
  'activity.assistantPlanning': 'The assistant is drawing up a plan…',
  'activity.running': 'Running…',

  // ──────────────────────────────────────────────────────────── toasts
  'toast.unusedArms': '{n} connections are now unused — clean them up in Overview → Connections.',
  'toast.badEdge': 'The diagram will not take that wire — this kind of link is not valid.',

  // ────────────────────────────────────── pasted-JSON diagnosis (json-paint)
  'jsonHint.notJson': 'This is not a JSON block — it has to start with `{`.',
  'jsonHint.missingBrace': 'Missing {n} closing `}` — it looks like the paste was cut short.',
  'jsonHint.missingBracket': 'Missing {n} closing `]` — it looks like the paste was cut short.',
  'jsonHint.extraBrace': '{n} too many `}`.',
  'jsonHint.extraBracket': '{n} too many `]`.',
  'jsonHint.unclosedQuote': 'There is an unclosed double quote `"`.',
  'jsonHint.singleQuote': 'JSON only takes double quotes `"`, not single ones `\'`.',
  'jsonHint.trailingComma': 'One comma too many — JSON does not allow a comma before `}` or `]`.',
  'jsonHint.propName': 'Field names must be in double quotes, for example `"command"`.',
  'jsonHint.missingColon': 'Missing the `:` after a field name.',
  'jsonHint.missingComma': 'Missing the `,` between two entries.',
  'jsonHint.badChar': 'The character `{char}` is not valid here.',
  'jsonHint.unreadable': 'This part cannot be read.',

  // ────────────────────────────────────────────────────────── canvas nodes
  'node.library': 'Document cabinet',
  'node.libraryBusy': 'reading {n} documents…',
  'node.libraryHint': 'drop files here',
  'node.knowledge': 'Shared knowledge base',
  'node.knowledgeHint': 'click to open',
  'node.armMissing': 'no longer plugged in',
  'node.armKeyDead': 'sign in again',
  /**
   * ⚠ NOT "sign in again" — that is `armKeyDead`, and it would be the wrong
   * door here. This one means the office holds no value under the name this
   * connection asks for: for an OAuth account the fix is to connect it, for a
   * typed key it is `agentco secret set`. The node says WHAT IS WRONG; the
   * panel behind the click says which of the two to do. → `office.ts §keyGoneOf`
   */
  'node.armKeyGone': 'no key stored',
  'node.armFallback': 'connection',
  'node.roleMissing': 'role not found',
  'node.resting': 'off duty',
  'canvas.cutEdge': 'Cut wire',

  // ─────────────────────────────────────────────── CLI command sample/form
  /**
   * The greeting inside the sample command. Localised because the user reads it
   * in the output pane after clicking Run — the surrounding `node -e "…"` is
   * code and stays as it is.
   */
  'cliForm.helloGreeting': 'Hello, ',
  'cliForm.helloSay': 'say hello',
  'cliForm.helloDescription':
    'Prints a greeting with the name it was given. Screen output only, reads nothing and writes no file — safe to run any number of times.',
  'cliForm.noName': 'This command has no name yet.',
  'cliForm.noLine': 'There is no command line to run yet.',

  // ───────────────────────────────────────────────────────────── markdown
  'md.taskDone': 'done: ',
  'md.taskTodo': 'not done: ',

  // ────────────────────────────────────────────────────────────── sidebar
  'sidebar.chat': 'Talk to the assistant',
  'sidebar.plans': 'Work log',
  'sidebar.overview': 'Company overview',
  'sidebar.library': 'Document cabinet',
  'sidebar.artifacts': 'Results',
  'sidebar.knowledge': 'Knowledge base',
  'sidebar.settings': 'Settings',
  'sidebar.closePanel': 'Close panel',
  'sidebar.resizeHandle': 'Drag to resize the panel',
  'sidebar.resizeHint': 'Drag to resize · double-click to reset',
  'sidebar.widen': 'Widen panel',
  'sidebar.widenHint': 'Widen panel',
  'sidebar.narrow': 'Narrow panel',
  'sidebar.narrowHint': 'Back to normal width',

  // ───────────────────────────────────────────────────────────── settings
  'settings.title': 'Settings',
  'settings.language': 'Interface language',
  /**
   * ⚠ `settings.languageScope` and `settings.themeScope` were pruned 10/09 at
   * the user's request — screen clutter, their call. What those two sentences
   * were FOR is recorded in `SettingsPanel.tsx`, not lost with them: bring one
   * back the day the support case they prevented actually arrives.
   */
  'settings.theme': 'Appearance',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',

  // ────────────────────────────────────────────────────────────── dialogs
  'dialog.newOffice.title': 'Create an office',
  'dialog.newOffice.name': 'Office name',
  'dialog.newOffice.placeholder': 'For example: Content, Accounting, Customer support',
  'dialog.renameOffice.title': 'Rename office',
  /**
   * Split around `<code>{officeId}</code>`. The code element sits mid-sentence,
   * so one key would have to carry the tag — see the note on `app.noAgentsHint*`.
   */
  'dialog.renameOffice.descBefore': 'Only the display name changes. The office code',
  'dialog.renameOffice.descAfter':
    '— which is also the name of the folder holding every result and the whole history — stays as it is.',
  'dialog.renameOffice.newName': 'New name',
  'dialog.renameOffice.unique':
    'It cannot repeat another office’s name — two identical lines in a picker are the surest way to open the wrong one.',
  'dialog.newAgent.title': 'Add an employee',
  'dialog.newAgent.name': 'Display name',
  'dialog.newAgent.namePlaceholder': 'For example: Spreadsheet builder',
  'dialog.newAgent.pitch': 'Introduction',
  'dialog.newAgent.pitchPlaceholder': 'What it can do, and what it hands back',
  'dialog.newAgent.pitchTip': 'Tip: keep it short.',
  'dialog.newAgent.tier': 'Model tier',
  'dialog.newAgent.tierStandard': 'standard — balanced',
  'dialog.newAgent.tierEco': 'eco — cheaper',
  'dialog.newAgent.tierDeep': 'deep — only for genuinely hard work',

  // ────────────────────────────────────────────────── company overview
  'overview.offices': 'Offices',
  'overview.folderTip': 'Folder on disk — offices/{id}/',
  'overview.folderAria': 'Folder for {name}',
  'overview.opened': 'Opened: {dir}',
  'overview.remoteCopied':
    'You are looking at this from another machine, so it cannot be opened here — the path was copied instead: {dir}',
  'overview.archiveTip': 'Archive',
  'overview.archiveAria': 'Move office {name} to the archive',
  'overview.deleteTip': 'Delete',
  'overview.deleteOfficeAria': 'Delete office {name} for good',
  'overview.noOffices': 'no office is open yet',
  'overview.archived': 'In the archive',
  'overview.readOnly': 'read only',
  'overview.restore': 'Restore',
  'overview.costTitle': 'Company-wide spend',
  'overview.noCost': 'No work has been recorded yet.',
  'overview.turnsNoteBefore': 'The number of',
  'overview.turnsNoteBold': 'turns',
  'overview.turnsNoteAfter': 'is the biggest lever on cost.',
  'overview.armForgotten': 'Deleted “{label}”. The keys are kept.',
  'overview.accountForgotten': 'Removed “{name}”.',
  'overview.connections': 'Connections',
  'overview.usedBy': 'used by: {who}',
  'overview.unused': 'nobody uses it',
  'overview.onCanvasNotWired': 'on the diagram, not wired up',
  'overview.dropArmTip': 'Delete from the company registry — the keys are kept',
  'overview.dropArmAria': 'Delete connection {label} for good',
  'overview.accounts': 'Connected accounts',
  'overview.keyDead': 'the key is dead — sign in again',
  'overview.accountUnused': 'no connection uses it',
  'overview.accountBlockedTip':
    '{n} connections still use it ({who}) — delete those under Connections first',
  'overview.accountDropTip': 'Remove this workspace — revoke the access on the provider’s side',
  'overview.accountDropAria': 'Remove workspace {label}',
  'overview.dropArmTitle': 'Delete connection “{label}” for good?',
  'overview.dropArmBody1': 'It leaves the company registry and',
  'overview.dropArmBodyBold': 'cannot be brought back',
  'overview.dropArmBody2': '— plugging it in again means building it from the catalogue.',
  'overview.dropArmKeepBold': 'The keys are kept:',
  'overview.dropArmKeepAfter': 'plug it back in and there is no token to fetch again.',
  'overview.dropAccTitle': 'Remove workspace “{label}”?',
  'overview.dropAccBody1': 'Deletes the key on this machine. To use it again you have to',
  'overview.dropAccBodyBold': 'sign in from scratch',
  'overview.dropAccBody2': 'on the provider’s page.',
  'overview.drop': 'Remove',
  'overview.purged': 'Cleared {n} entries · {cost}',
  'overview.purgeFailed': 'The clean-up did not go through',
  'overview.goneEntries': 'entries no longer here ·',
  'overview.tapToSee': 'tap to view',
  'overview.purging': 'Clearing…',
  'overview.purgeAll': 'Clear them all',
  'overview.purgeTitle': 'Clear {n} missing entries from the spend ledger?',
  'overview.purgeBodyMid': 'will vanish from every report, and',
  'overview.purgeBodyBold': 'there is no undo',
  'overview.purgeUntouchedBefore': 'Open offices and archived offices are',
  'overview.purgeUntouchedBold': 'not',
  'overview.purgeUntouchedAfter': 'touched.',
  'overview.archivedSuffix': '(archived)',
  'overview.archivedAgents': 'Employees in the archive',
  'overview.restoreTipOffice':
    'Comes back onto the diagram of “{name}”, standing on an empty spot — never on top of anyone. Still OFF DUTY until you wire them up.',
  'overview.restoreTip': 'Comes back onto the diagram, on an empty spot, still off duty.',
  'overview.bringBack': 'Bring back',
  'overview.deleteRoleTip': 'Delete the role file for good — no getting it back',
  'overview.deleteAgentAria': 'Delete {label} for good',
  'overview.bringBackNoteBefore': 'Bringing them back puts them on the diagram of',
  'overview.bringBackNoteMid':
    'on an empty spot — never on top of somebody else, even if another person took their old seat. They stay',
  'overview.bringBackNoteBold': 'off duty',
  'overview.bringBackNoteAfter': 'until you wire them to the assistant.',
  'overview.thisOffice': 'this office',
  'overview.atPath': 'at',
  'overview.notesKeptShort': 'is kept.',
  'overview.modelsTitle': 'Company models',
  'overview.masterTier': 'The assistant runs at',
  'overview.plannerTier': 'Planning runs at',
  'overview.modelNamesBefore': 'Model names have to match Anthropic’s exactly (',
  'overview.modelNamesAfter':
    '…). Get one wrong and the first job after that reports a model-not-found; nothing is permanently broken, fix it and work carries on.',
  'overview.modelsWideBefore': 'A change here reaches',
  'overview.modelsWideBold': 'every office',
  'overview.modelsWideAfter':
    '. Work already running keeps the old model until it finishes; everything after that uses the new one and pays for one cache rewrite.',
  'overview.removeOfficeTitle': 'Delete office “{name}” for good?',
  'overview.removeOfficeBefore': 'Deletes the whole folder',
  'overview.removeOfficeAfter': ': employees, skills, the knowledge base and every result made.',
  /**
   * ⚠ It used to be `inspector.agentDeleteBold`, borrowed from the employee-delete
   * modal. That modal's whole paragraph is gone (§17i of SPEC-office-animation),
   * and a key that outlives the sentence it was written for is a key whose name
   * lies about where it belongs. Deleting a WHOLE OFFICE is still irreversible and
   * still says so.
   */
  'overview.removeNoUndo': 'There is no getting it back.',

  // ────────────────────────────────────────────── inspector (right panel)
  'inspector.editProfile': 'Edit profile',
  'inspector.displayName': 'Display name',
  'inspector.pitch': 'Introduction',
  'inspector.renameAssistant': 'Rename the assistant',
  'inspector.assistantNamePlaceholder': 'For example: Manager, Dana, Coordinator',
  'inspector.assistantNameNoteBefore':
    'Just the name on the diagram and in the chat pane. The assistant',
  'inspector.assistantNameNoteBold': 'remembers everything',
  'inspector.assistantNameNoteAfter': 'it was told, and nothing has to be run again.',
  'inspector.browserLoginTitle': 'Sign in / add cookies',
  'inspector.browserOpenedBefore':
    'The window is open. Use it like an ordinary browser — sign in, wait for the SMS code, do two-factor.',
  'inspector.browserOpenedBold': 'Close the window',
  'inspector.browserOpenedAfter': 'when you are done; employees pick that session up on later runs.',
  'inspector.browserIdleBefore': 'Opens an ordinary browser window on the',
  'inspector.browserIdleBold': 'same profile',
  'inspector.browserIdleAfter':
    'employees use. Sign in here once and later jobs walk straight in.',
  'inspector.browserOpening': 'Opening…',
  'inspector.browserReopen': 'Open again',
  'inspector.browserOpen': 'Open the browser',
  'inspector.hideLog': 'Hide the log',
  'inspector.showLog': 'What has this connection done?',
  'inspector.noCallsBefore':
    'No call has been recorded yet. The log starts the first time this connection is used on real work — pressing',
  'inspector.noCallsBold': 'Try it',
  'inspector.noCallsAfter': 'while plugging it in does not count.',
  'inspector.argsTruncated': '\n\n… (trimmed — the arguments were too long)',
  'inspector.tier.eco': 'eco — cheapest, slower, and needs more turns',
  'inspector.tier.standard': 'standard — balanced',
  'inspector.tier.deep': 'deep — only for genuinely hard work, much more expensive',
  'inspector.modelTier': 'Model tier',
  'inspector.model': 'Model',
  'inspector.perJobLimit': 'Per-job limit',
  'inspector.maxUsd': 'up to ${n}',
  'inspector.noMoneyLimit': 'no spend limit',
  'inspector.changeModel': 'Change the model',
  'inspector.changeModelLimits': 'Change model & limits',
  'inspector.companyDefault': 'follow the company default ({default})',
  'inspector.limitOneJob': 'Limit for ONE job',
  'inspector.maxSpendHint': 'max spend ($) · 0 = no limit',
  'inspector.maxStepsHint': 'max steps',
  'inspector.bashLabel': 'Let it run commands on this machine',
  'inspector.bashWarnBefore': 'Commands run with',
  'inspector.bashWarnBold': 'your own permissions',
  'inspector.bashWarnAfter':
    'on this machine. Employees are only ever handed work inside the office folder, but a shell command has no fence around it.',
  'inspector.armsInUse': 'Connections in use',
  'inspector.reachableFolders': 'Folders it can reach',
  'inspector.level.read': 'read only',
  'inspector.level.add': 'read + add',
  'inspector.level.full': 'full access',
  'inspector.onDuty': 'On duty',
  'inspector.offDuty': 'Off duty',
  'inspector.ownNotebook': 'Own notebook',
  'inspector.rosterNoteBefore':
    'Every person on duty takes a line of introduction inside the assistant’s context, on',
  'inspector.rosterNoteBold': 'every',
  'inspector.rosterNoteAfter': 'turn of conversation. Disconnecting people you do not use saves money.',
  'inspector.viewPrompt': 'View the layered prompt',
  'inspector.type': 'Type',
  'inspector.inUseBy': 'Used by',
  'inspector.nobody': 'nobody yet',
  'inspector.missingArm': 'No longer declared in company.yaml.',
  'inspector.armKeyDead':
    'The service refused the credential for “{who}”. Staff cannot use this connection until you sign in again — open + Connect, pick this service, and press Sign in again on that account’s row.',
  'inspector.removeFromOffice': 'Remove from this office',
  'inspector.removeFromOfficeShort': 'Remove from the office',
  'inspector.roleId': 'Role id',
  'inspector.status': 'Status',
  'inspector.statusOnDuty': 'on duty',
  'inspector.statusOffDuty': 'off duty',
  'inspector.missingRole': 'roles/{role}.yaml not found',
  'inspector.rest': 'Stand down',
  'inspector.backOnDuty': 'Back on duty',
  'inspector.archive': 'Move to the archive',
  'inspector.deleteForGood': 'Delete for good',
  'inspector.builtinNote':
    'Every employee already has: reading and writing files inside the office, and searching the web.',
  'inspector.confirmRemoveArmTitle': 'Remove “{label}” from this office?',
  'inspector.confirmDeleteAgentTitle': 'Delete “{label}” for good?',
  'inspector.armRemoveBody1':
    'This connection disappears from the diagram, and the employees wired to it stop being able to use it.',
  'inspector.armRemoveBold': 'This office only',
  'inspector.armRemoveBody2': '— nowhere else is touched.',
  'inspector.armRemoveKeep1': 'The configuration and the keys are',
  'inspector.armRemoveKeepBold': 'kept',
  'inspector.armRemoveKeep2':
    '. Plug the same thing back in and there is nothing to type again — only the wiring to redo.',
  'inspector.agentNotesBefore': 'The lessons notebook at',
  'inspector.agentNotesAfter':
    'is kept — that is what the office learned, not the private property of one name.',
  'inspector.archiveHintBefore': 'Only want it out of the way? Press',
  'inspector.archiveHintMid': 'and choose',
  'inspector.archiveHintAfter': '— restorable at any time.',

  // ─────────────────────────────────────── connections: sign-in / scopes
  // ─────────────────────────────────────────── probing a connection
  'probe.noAccount':
    'No account is connected, or the connection was revoked on the service side. Press **Sign in** and try again — there is no key field to fill in for this kind.',
  'probe.missingKeys': 'Missing keys: {keys}.',
  'probe.notSentBecause':
    '{parts} Nothing was sent — sending it would only get “wrong key” back from the server, and that sentence would send you looking in the wrong place.',
  'probe.zeroTools':
    'It connects but the server grants no action at all. Usually one of the options sent up was silently ignored by the server — check the groups of actions you ticked.',
  'browserLogin.officeBusy':
    'The office is running work. Wait for it to finish (or press stop) and then open the sign-in window — the browser only opens once per profile.',
  'browserLogin.alreadyOpen': 'This office’s sign-in window is already open. Close it and try again.',
  'browserLogin.badUrl': '“{url}” is not a valid web address.',
  'browserLogin.badScheme': 'Only http and https addresses can be opened.',
  'browserLogin.noBrowser':
    'Neither Microsoft Edge nor Google Chrome was found on this machine. Install one of them and try again — the browser connection uses the same one.',

  // ───────────────────────────────────────── CLI connection declaration
  /**
   * ⚠ Only the sentences a PERSON reads while pasting a declaration live here.
   * Everything `fillArgv` and `runCliTool` say goes back as a TOOL RESULT — the
   * worker model reads it, so those stay English literals in `cli-arm.ts`.
   */
  'cliArm.exampleTooLong': 'the example has to be short — it sits in the prefix of every turn',
  'cliArm.badId': 'an id is lower-case letters, digits and underscores only',
  'cliArm.didYouMean': '“{key}” — did you mean “{near}”?',
  'cliArm.unknownKey': '“{key}” is not part of the declaration',
  'cliArm.unknownKeys': 'Keys not recognised: {list}',
  'cliArm.duplicateId':
    'Two commands share the id “{id}” — each command needs its own. The id comes from the Name field, so two near-identical names can produce one id: rename one of them.',

  // ────────────────────────────────────── connection catalogue (arms/*.ts)
  /**
   * ⚠ `hint` IS NOT HERE, on purpose. A catalogue entry's `hint` is read by the
   * MODEL, not by a person — it is a rule inside a prompt, so it stays an
   * English literal in `arms/*.ts` and never follows the switch.
   * → docs/CLAUDE.md §Language · the two worlds
   */
  'armCat.files.name': 'Files on this machine',
  'armCat.files.blurb':
    'Reads files and folders on this very machine — only the folders you allow.',
  'armCat.files.folders.label': 'Allowed folders',
  'armCat.files.folders.help':
    'Employees can only reach folders on this list. Pick exactly what is needed; do not hand over a whole drive.',
  'armCat.browser.name': 'Web browser',
  'armCat.browser.blurb':
    'Opens and reads web pages the way a real person would — including internal systems with no API. By default it uses a clean browser, keeps no sign-in, and runs hidden (no window).',
  'armCat.browser.keepSession.label': 'Remember the sign-in',
  'armCat.browser.keepSession.help': 'Saves the browser session and cookies.',
  'armCat.browser.showWindow.label': 'Show the browser window',
  'armCat.browser.showWindow.help': 'Opens a real window so you can watch what an employee is doing.',
  /**
   * A vendor's own name is a PROPER NOUN — same in every locale, and still a
   * key. Allowing a plain string beside `MessageKey` here would re-open the
   * door the type just closed: the next Vietnamese literal would type-check.
   */
  'armCat.github.name': 'GitHub',
  'armCat.linear.name': 'Linear',
  'armCat.notion.name': 'Notion',
  'armCat.github.repos.label': 'Repos & files',
  'armCat.github.pulls.label': 'Pull requests',
  'armCat.github.issues.label': 'Issues',
  'armCat.github.actions.label': 'Actions / CI',
  'armCat.github.blurb':
    'Reads and edits files in a GitHub repository — private ones included. An edit commits straight to GitHub; the repository is never downloaded. Private repositories are only reachable if you installed agentco into them.',
  'armCat.github.context.label': 'Account & organisations',
  'armCat.github.context.help':
    'Employees know who you are on GitHub, and which organisations and teams you belong to. Touches no repository.',
  'armCat.github.repos.help':
    'Browse repositories, read files, look at branches and commits. At full access it can create and edit files too.',
  'armCat.github.pulls.help': 'View, comment on, open and merge pull requests.',
  'armCat.github.issues.help': 'View, open, assign and close issues.',
  'armCat.github.actions.help': 'View workflow runs, read logs, re-run a failed one.',
  'armCat.github.scopeSay': 'Choose repositories on GitHub',
  'armCat.linear.blurb':
    'Reads and — if you allow it — writes to one Linear workspace: issues, projects, documents. You pick which workspace at sign-in.',
  'armCat.linear.tierAdd':
    'Attaches files and creates new labels. ⚠ It CANNOT open a new issue — Linear folds creating and editing an issue into one command, so opening an issue sits at Full access.',
  'armCat.notion.blurb':
    'Searches, reads and — if you allow it — writes to the Notion pages your account can see.',

  /** The sub-line names the COST — people pick by effort, not by brand. */
  'arm.price.none': 'no key needed',
  'arm.price.keys': 'needs 1 key',
  'arm.price.login': 'needs a sign-in',
  /**
   * Three levels of access, said as CONSEQUENCE rather than in MCP vocabulary.
   * Nobody knows what `destructiveHint` is, and nobody needs to — the question
   * they are answering is "can this person change what I already wrote".
   * The short badge form lives in `inspector.level.*`, shared with the panels.
   */
  'arm.tier.read.name': 'Read only',
  'arm.tier.read.help': 'Searches and reads. Creates nothing, changes nothing, deletes nothing.',
  'arm.tier.add.name': 'Read + Add',
  'arm.tier.add.help': 'Can create new pages and entries, but never touches what is already there.',
  'arm.tier.full.name': 'Full access',
  'arm.tier.full.help': '⚠ Edits and deletes content that already exists.',
  'arm.exPartsMismatch':
    'The example has {b} pieces and the syntax has {a} — these two are not the same command.',
  'arm.exManyDiffsBefore':
    'The two lines differ in {n} places. Wherever the value changes from run to run, turn it into',
  'arm.exManyDiffsAfter': 'on the Syntax line.',
  'arm.exOneDiff1': 'Differs from the syntax at',
  'arm.exOneDiff2': '. If that is the part that changes from run to run, turn it into',
  'arm.exOneDiff3': 'on the Syntax line — employees fill it in from there.',
  'arm.jsonPlaceholder':
    'Paste the MCP config block from the server’s README, for example:\n{ "command": "npx", "args": ["-y", "..."] }',
  'arm.jsonAt': 'Line {line}, column {col}: ',
  'arm.pluggedElsewhere': 'Already plugged in at another office',
  'arm.reuseIt': 'reuse it',
  'arm.forgetTip': 'Delete from the company registry',
  'arm.clientSaved':
    'Saved. The next sign-in goes through your own app — accounts already connected stay as they are.',
  'arm.clientCleared': 'Back to agentco’s own app.',
  'arm.clientSaveFailed': 'Could not save the Client ID.',
  'arm.dropFailed': 'Could not remove it.',
  'arm.loginStopped': 'The sign-in was stopped.',
  'arm.codeExpired': 'The sign-in code has expired — press Sign in to get a new one.',
  'arm.codeFailed': 'Could not get a sign-in code.',
  'arm.loginPageFailed': 'Could not open the sign-in page.',
  'arm.needAccount': 'Sign in to an account first.',
  'arm.needGroups': 'Tick at least one group of actions first.',
  'arm.needFolder': 'Choose at least one folder.',
  'arm.badConfig': 'The configuration could not be read — check the JSON block.',
  'arm.testFailed': 'The test could not run.',
  'arm.step1Title': 'Plug in a connection',
  'arm.step2Title': 'Settings · {name}',
  'arm.step3Title': 'Who gets to use it?',
  'arm.step1Desc': 'Pick a ready-made one, reuse one already plugged in, or paste your own config.',
  'arm.step2Desc': 'Press Try it to test the connection.',
  'arm.step3Desc': 'A connection only works for the people wired to it.',
  'arm.typeFiles': 'A folder on this machine',
  'arm.typeFilesSay': 'pick a folder · no key needed',
  'arm.typeService': 'Ready-made services',
  'arm.typeServiceSay': '{n} services · fill in a key',
  'arm.typeCliSay': 'wrap a command you already run',
  'arm.typeCustom': 'Plug in your own MCP',
  'arm.typeCustomSay': 'paste your config',
  'arm.back': '← Back',
  'arm.noCatalogBefore': 'No ready-made service yet. Use',
  'arm.noCatalogBold': 'Plug in your own MCP',
  'arm.noCatalogAfter': '— it takes any server.',
  'arm.cliCwdTitle': 'Which folder will the commands run in?',
  'arm.cliCwdBody':
    'Every command on this connection runs in exactly one place — usually the project folder you already open a terminal in.',
  'arm.pickFolder': 'Choose a folder…',
  'arm.officeFolder': 'the office folder',
  'arm.cliCwdHintBefore': 'The picker opens on',
  'arm.cliCwdHintAfter': '— press Done straight away if your command touches no files.',
  'arm.backToFolder': '← Folder',
  'arm.mixedCwdTip':
    'This declaration sets a different folder per command — the form can only hold one shared folder',
  'arm.viewJson': 'View JSON',
  'arm.backToForm': '← Back to the form',
  'arm.fillSample': 'Fill in a runnable sample',
  'arm.mixedCwd': 'Different for each command',
  'arm.defaultCwd': 'Office folder (default)',
  'arm.changeFolder': 'Change…',
  'arm.editInJson': 'edit it in the JSON',
  'arm.mixedCwdBefore': 'This declaration sets a',
  'arm.mixedCwdBold': 'different folder for each command',
  'arm.cliCommandN': 'Command {n}',
  'arm.cliDrop': 'Drop',
  'arm.cliName': 'Name',
  'arm.cliNamePlaceholder': 'count unpaid invoices',
  'arm.cliDupBefore': 'Same name as another command (both come out as',
  'arm.cliDupAfter':
    '). Employees will not be able to tell the two apart — rename one of them.',
  'arm.cliSyntax': 'Syntax',
  'arm.cliExample': 'Example',
  'arm.cliExampleMismatch':
    'The example does not match the syntax — it needs the same number of pieces, and identical text everywhere that is not a placeholder.',
  'arm.cliDescription': 'Description',
  'arm.cliDescriptionPlaceholder':
    'What it does, what to expect when it runs, whether it overwrites anything, whether it can be undone',
  'arm.cliReadOnly': 'Read-only command?',
  'arm.cliReadOnlyHint': 'Leave it clear if you are not sure.',
  'arm.cliAdd': '+ Add a command',
  'arm.cliTooMany':
    'More than 8 actions on one connection means every single turn of work carries the whole list. Better split it into two connections.',
  'arm.cliJsonBroken': 'The JSON block is broken — it has to be fixed before this can be saved.',
  'arm.cliDupIds': 'Two commands share the id {ids} — every command needs its own.',
  'arm.cliProblemAt': 'Command {n}: {say}',
  'arm.useThisConfig': 'Use this config',
  'arm.pasteIsCliBefore': 'This is a',
  'arm.pasteIsCliBold': 'command',
  'arm.pasteIsCliAfter': 'declaration, not an MCP config — this tab cannot build it.',
  'arm.openCliTab': 'Open the Commands tab with this →',
  'arm.multiServerBefore': 'This block has {n} servers. Only',
  'arm.multiServerMid': 'gets plugged in —',
  'arm.multiServerAfter': 'go in as separate connections.',
  'arm.pasteHintBefore': 'It takes a whole',
  'arm.pasteHintAfter': 'block copied straight out of the docs.',
  'arm.connectionName': 'Connection name',
  'arm.signIn': 'Sign in',
  'arm.folderClash': 'That folder is already a connection in this office.',
  'arm.folderFallbackLabel': 'Folder',
  'arm.oneFolderNote': 'Need several places? Add another connection, or pick a parent folder.',
  'arm.noWorkspaceTitle': 'No workspace connected yet',
  'arm.noWorkspaceBefore': 'Press the button below, choose a workspace, then press',
  'arm.noWorkspaceMid': '. The tab closes itself and comes back here.',
  'arm.noWorkspaceBold': 'Nothing to copy and paste.',
  'arm.useWorkspace': 'Use workspace',
  'arm.workspaceExpired': '⚠ The service refused this sign-in',
  'arm.reconnectedOther':
    'You signed in as “{got}”, so that is the account now selected. “{asked}” was not repaired — press Sign in again on its row and choose that account on the service’s page.',
  'arm.workspaceReconnectTip': 'Sign in to “{label}” again — every connection using it recovers at once',
  'arm.workspaceInUse': 'In use by: {who}. Remove those connections first.',
  'arm.workspaceDropTip': 'Remove this workspace',
  'arm.workspaceDropAria': 'Remove {label}',
  'arm.waitingApproval': 'Waiting for you to approve…',
  'arm.waitingClickAgain': 'Waiting… press to reopen',
  'arm.addAnotherAccount': 'Connect another account',
  'arm.addAnotherWorkspace': 'Connect another workspace',
  'arm.signInWith': 'Sign in with {name}',
  'arm.stopWaiting': 'Stop waiting',
  /** `{n}` arrives already grouped by `formatNumber`. */
  'arm.tokensPerTurn': '~{n} tokens',
  'arm.tokensPerTurnSuffix': '· ~{n} tokens per turn',
  'arm.tierLabel': 'What employees get to do',
  'arm.tierDeclared': '({server} declares the level of each action itself.)',
  'arm.serverFenceBefore': 'The token figure above was measured with',
  'arm.serverFenceBold': 'everything open',
  'arm.serverFenceMid': '. At this level {name} trims the writing actions at the server, so in practice it',
  'arm.serverFenceBold2': 'costs less',
  'arm.oneTierBefore': 'This connection is',
  'arm.oneTierAfter': '·',
  'arm.howItRuns': 'How it runs',
  'arm.remoteHiddenOption':
    'One option is hidden because you are viewing from another machine — the browser window would open on the machine running agentco, so you would not see it from here.',
  'arm.groupsLabel': 'Which groups of actions it may do',
  'arm.groupsRequired':
    'Tick at least one group. With none, this connection cannot do anything at all.',
  'arm.grantingBefore': 'Granting',
  'arm.grantingAfter': 'per turn for every employee wired to it',
  'arm.grantingUnknown': 'Press Try it to see how many actions this set grants and what it costs in tokens.',
  'arm.envPlaceholderBefore': '↳ The config you pasted has a placeholder',
  'arm.envPlaceholderAfter': '. The value is stored on your machine, not written into',
  'arm.reuseNothingTitle': 'Nothing to fill in again',
  'arm.reuseBody': 'This connection is already plugged in at another office.',
  'arm.keyDeadTitle': 'This connection needs signing in again',
  'arm.keyDeadBody':
    'The service refused the credential for “{who}”. That happens when a sign-in is revoked, a password changes, or the connection sat unused for too long. Signing in again fixes it — every office using this connection recovers at once.',
  'arm.keyDeadShort': 'sign-in expired',
  'arm.signInAgain': 'Sign in again',
  'arm.noFolderChosen': 'No folder chosen yet.',
  'arm.checkingShort': 'Checking…',
  'arm.changeFolderLong': 'Change folder…',
  'arm.browseTitle': 'Choose a folder',
  'arm.browseDesc':
    'These are the folders on the machine running agentco — not the machine you are sitting at, if those differ.',
  'arm.pathPlaceholder': 'Or paste a path and press Enter',
  'arm.currentlyAt': 'Currently at',
  'arm.pickADrive': 'Pick a drive',
  'arm.noSubfolders': 'No readable subfolder here.',
  'arm.useThisFolder': 'Done — use this folder',
  'arm.probeZeroTools': 'Connected, but 0 actions',
  'arm.probeOk': 'Working · {n}',
  'arm.probeSplit': '{read} read-only · {write} that write',
  'arm.probeNeedsLoginTitle': 'Needs one sign-in',
  'arm.probeAuthTitle': 'This service asks you to authenticate',
  'arm.probeNeedsLoginBefore':
    'It connects, but this service needs you to approve it in the browser. Press',
  'arm.probeNeedsLoginAfter': 'above.',
  'arm.probeNoKeyBefore':
    'The server answers, but it refuses because there is no key. The',
  'arm.probeNoKeyBold': 'Plug in your own MCP',
  'arm.probeNoKeyAfter': 'route cannot sign in for you — you have to supply the key yourself.',
  'arm.probeMatchBefore': '⭐',
  'arm.probeMatchMid': 'is already there under',
  'arm.probeMatchBold': 'Ready-made services',
  'arm.probeMatchAfter':
    '. Go back and pick it, and all you have to press is Sign in — no key to hunt down.',
  'arm.probeKeyHintBefore':
    'The key has to live inside this very JSON block. The service’s README says where it goes — it might be a header under',
  'arm.probeKeyHintMid': ', it might be a variable in',
  'arm.probeKeyHintMid2': ', it differs per vendor. Copy it into the right place, then',
  'arm.probeKeyHintBold': 'replace the real value with',
  'arm.probeKeyHintAfter':
    ': that spot turns into an input field right below, and the key never gets written into the config file.',
  'arm.probeFailedTitle': 'Could not connect',
  'arm.connecting': 'Connecting…',
  'arm.tryAgain': 'Try again',
  'arm.tryIt': 'Try it',
  'arm.checking': 'Checking the connection…',
  'arm.slowHint':
    'This step takes about 10–25 seconds: the machine has to start the connection tool and then ask what it can do.',
  'arm.goBack': 'Back',
  'arm.next': 'Next',
  'arm.noAgentsYet':
    'This office has no employees yet. Save anyway — plug it in now and wire it up later.',
  'arm.grantNobody':
    'With nobody chosen this connection sits idle — nobody can use it, and it costs no tokens.',
  'arm.grantSome': '{n} people will be able to use this connection on the very next job.',
  'arm.grantTokens': ' Each of them pays an extra ~{n} tokens per turn.',
  'arm.done': 'Done',
  'arm.forgetTitle': 'Delete from the company registry?',
  'arm.forgetBody1': 'will disappear from the company and',
  'arm.forgetBodyBold': 'cannot be brought back',
  'arm.forgetBody2': '. No office is using it.',
  'arm.forgetKeysKept':
    'The keys ({keys}) are kept — plug it back in and there is no token to fetch again.',
  'arm.forgetNoKeys': 'This connection needs no key, so plugging it back in is a pick from the catalogue.',
  'arm.dropWsTitle': 'Remove this workspace?',
  'arm.dropWsBefore': 'agentco will forget the key for',
  'arm.dropWsMid': 'and',
  'arm.dropWsBold': 'tell the service to revoke',
  'arm.dropWsAfter': 'its access.',
  'arm.dropWsSafe': 'Nothing inside your workspace is lost. Need it again — sign in once more.',
  'arm.tabHint':
    'Finish in the other tab and this updates itself. If that tab shows an error (or you closed it), press the button above again — each press starts a fresh attempt.',
  'arm.mixedCwdAfter':
    '. The form can only hold one shared folder, so it cannot read this back — carry on here, or bring the commands onto one',

  'arm.scopeTitle': 'Choose what {name} may reach',
  'arm.deviceTitle': 'Type this code into {name}',
  'arm.deviceLeft': '{mm}:{ss} left',
  'arm.copyCode': 'Copy the code',
  'arm.deviceStep1Before': 'Open',
  'arm.deviceStep1After': '— on this machine or on your phone, either is fine.',
  'arm.deviceStep2': 'Type the code above and approve it.',
  'arm.deviceStep3': 'Come back here — this screen notices on its own, no refresh needed.',
  'arm.deviceAccountBefore': '⚠ That page will use',
  'arm.deviceAccountBold': 'whichever account your browser is signed into',
  'arm.deviceAccountAfter':
    '. If that is not the account you meant to connect, open it in a private window.',
  'arm.repoTitle': 'Repositories agentco may touch',
  'arm.repoScanning': 'Asking {name} which repositories the app was installed into…',
  'arm.repoScanFailedBefore':
    'Could not ask for the repository list right now. You can still plug it in — but if an employee reports that it cannot find the repository, come back and press',
  'arm.repoScanFailedAfter': 'above.',
  'arm.repoInstalledBefore': 'Installed on',
  'arm.repoInstalledMid': 'repositories belonging to',
  'arm.repoNotInstalled': '— {n} other repositories do not have it',
  'arm.repoPublicNoteBefore':
    'Employees can read a public repository whether or not it is installed — the list above is the repositories with',
  'arm.repoPublicNoteBold': 'full',
  'arm.repoPublicNoteAfter': 'access (private repositories, and write access).',
  'arm.repoNoneAfter':
    'has not installed agentco into any repository. Employees will not be able to read private repositories, and will not be able to write anything at all.',
  'arm.repoRecheck': 'Installed it — check again',
  'arm.repoAnywayBefore': 'Understood, carry on —',
  'arm.repoAnywayItalic': 'repositories owned by an organisation cannot show up here',
  'arm.ownClientSummary': 'Use your own {name} App',
  'arm.ownClientOn': '· on',
  'arm.ownClientNoteBefore':
    'By default sign-in goes through agentco’s app. To sign in under your own name, create a {name} App and paste its',
  'arm.ownClientNoteBold': 'Client ID',
  'arm.ownClientNoteAfter': 'here. Leave it empty to go back to agentco’s app.',
  'arm.ownClientWarnBefore': 'A Client ID is',
  'arm.ownClientWarnBold': 'public data',
  'arm.ownClientWarnAfter': '— never paste a client secret or a private key.',

  // ─────────────────────────────────────────────────────────── work log
  'plans.status.planning': 'planning',
  'plans.status.running': 'running',
  'plans.status.done': 'done',
  'plans.status.failed': 'failed',
  /** `warn`, not `danger`: nothing is broken, the system is waiting on a person. */
  'plans.status.blocked': 'your turn',
  'plans.status.paused': 'paused',
  'plans.status.stopped': 'stopped',
  'plans.loadFailed': 'Could not read the work history.',
  'plans.openFailed': 'Could not open this job.',
  'plans.emptyTitle': 'No work yet',
  'plans.emptyHint': 'Every job you hand over gets its own record, with its own plan and its own log.',
  'plans.unfinished': '{n} unfinished',
  'plans.showAll': 'Show all',
  'plans.onlyDone': 'Finished only',
  'plans.noneDoneBefore': 'Nothing has finished yet.',
  'plans.noneDoneAfter': 'are still hidden by the filter —',
  'plans.showAllInline': 'show all',
  'plans.back': 'Back to the list',
  'plans.reload': 'Reload',
  'plans.noEvents': 'This job has not logged an event yet.',
  'plans.report': 'Result',
  'plans.collapse': 'Collapse',
  'plans.expand': 'Show in full',
  'plans.tokenLabel': 'Tokens:',
  'plans.cacheRead': 'cache reads',
  'plans.cacheWrite': 'cache writes',
  'plans.turns': 'turns',
  'plans.cacheChurnBadge': '⚠ repeat cache writes',
  'plans.details': 'details',
  'plans.colJob': 'job',
  'plans.churnWarn':
    '⚠ {roles} wrote the cache more than once in a single shift. Something is breaking the prefix mid-run — edited skills, a changed model, or a version bump while work was running.',
  'plans.churnOkBefore': 'The first task of each role',
  'plans.churnOkBold': 'writes the cache',
  'plans.churnOkAfter':
    'heavily and the rest write little — that is the cache priming gate working. A whole run of heavy writes means the gate is broken.',
  'plans.totalPrefix': 'total',

  // ───────────────────────────────────────────────────────────── results
  'artifacts.loadFailed': 'Could not read the list of results.',
  'artifacts.gone': '“{name}” is no longer in Results — it was most likely deleted.',
  'artifacts.deleteFailed': 'Could not delete it.',
  'artifacts.emptyTitle': 'No results yet',
  'artifacts.emptyHint':
    'This is where the files your employees produce on each job are kept — preview them, download them, or throw them away.',
  'artifacts.deleteAll': 'Delete all',
  'artifacts.downloadOnly': 'download only',
  'artifacts.downloadFile': 'Download {name}',
  'artifacts.delete': 'Delete {name}',
  'artifacts.footerBefore': 'This is what',
  'artifacts.footerBold1': 'your employees made',
  'artifacts.footerMid':
    '. It cannot be edited — to change something, ask the assistant to redo it. Anything you want to keep for the long run belongs in the',
  'artifacts.footerBold2': 'document cabinet',
  'artifacts.confirmDeleteTitle': 'Delete this result?',
  'artifacts.confirmDeleteBody1': 'will be deleted for good. This is the',
  'artifacts.onlyCopy': 'only copy',
  'artifacts.confirmDeleteBody2':
    '— there is no other copy on your machine, and an employee has to run the whole job again if you need it back.',
  'artifacts.confirmAllBefore': 'Every one of the',
  'artifacts.confirmAllMid':
    'in this panel is deleted for good, including today’s jobs. This is the',
  'artifacts.confirmAllAfter': '— getting them back means running the work, and paying for it, again.',
  'artifacts.untouchedBefore': 'The document cabinet and the knowledge base are',
  'artifacts.untouchedBold': 'not',
  'artifacts.untouchedAfter': 'touched.',
  'artifacts.legacyGroup': 'Older results (from before they were split by job)',
  'artifacts.runAt': 'Job run at {when}',
  'artifacts.readFailedStatus': 'Could not read it (error {status}).',
  'artifacts.readFailed': 'Could not read the file.',
  'artifacts.nativeOnlyTitle': 'This format has to be opened in its own app',
  'artifacts.nativeOnlyHint':
    'Previewing a Word/Excel/PowerPoint file by stripping its text out loses the tables, the layout and the images — you would be approving something other than what gets sent. Download it and open it in the real application.',
  'artifacts.pdfFallback': 'Your browser will not open a PDF here — download it instead.',
  'artifacts.downloadButton': 'Download',
  'artifacts.emptyFile': 'The file is empty.',
  'artifacts.csvCapped': 'Only the first 500 rows are shown. Download the file to read all of it.',

  // ─────────────────────────────────────────────────────── document cabinet
  'library.loadFailed': 'Could not read the document cabinet.',
  /** Rendered as `<file name>: <this>`, so it starts lower-case and mid-sentence. */
  'library.uploadFailed': 'could not be uploaded.',
  'library.deleteFailed': 'Could not delete it.',
  'library.reextractFailed': 'Could not re-read this document.',
  'library.uploading': 'Uploading…',
  'library.add': 'Add a document',
  /** Split around two `<b>` runs of file extensions, which are not translated. */
  'library.dropHint1': 'Drag files in here. Best support for',
  'library.dropHint2': '. There is support for',
  'library.dropHint3': 'as well, but expect weaker results.',
  'library.emptyTitle': 'The document cabinet is empty',
  'library.emptyHint':
    'Drop in whatever you want your employees to read: contracts, policies, statements, CVs. The text is pulled out once on the way in and costs nothing after that.',
  /** `{n}` arrives pre-rounded (`12K`), so this is a plain key, not a plural one. */
  'library.tokensApprox': '~{n} tokens',
  'library.reextract': 'Re-read {name}',
  'library.reextractTip': 'Re-read — try extracting this document again',
  'library.download': 'Download {name}',
  'library.delete': 'Delete {name}',
  'library.footerBefore': 'These are the documents',
  'library.footerBold': 'you put in',
  'library.footerAfter': '. The text is pulled out once, as they arrive.',
  'library.confirmDeleteTitle': 'Delete this document?',
  'library.confirmDeleteBody': 'will be removed from the cabinet. The original on your machine is untouched.',
  'library.clashTitle': 'A document by that name is already here',
  'library.clashBody':
    'Already in the cabinet: {names}. Replacing overwrites the old copy and reads the content again from scratch.',
  'library.keepOld': 'Keep the old one',
  'library.replace': 'Replace',
  'library.state.pending': 'waiting',
  'library.state.extracting': 'reading…',
  'library.state.imageOnly': 'scan only',
  'library.state.unindexed': 'not indexed',
  'library.state.failed': 'failed',

  // ─────────────────────────────────────────────────────── knowledge base
  'knowledge.loadFailed': 'Could not read the knowledge base.',
  'knowledge.emptyTitle': 'The knowledge base is still empty',
  'knowledge.emptyHint':
    'Employees write to their own notebook whenever they draw a lesson; the assistant writes to the shared base at the end of each shift. Nobody fills this in by hand — it is what the system worked out for itself.',
  'knowledge.toLibrary': 'Your own documents go in the document cabinet',
  'knowledge.search': 'Search the base…',
  'knowledge.searchLabel': 'Search',
  'knowledge.shared': 'shared',
  'knowledge.pinned': 'pinned',
  'knowledge.superseded': 'replaced by a newer note',
  'knowledge.noMatch': 'No note matches “{q}”.',
  /** Split around `<b>` and the inline button. → the note on `app.noAgentsHint*` */
  'knowledge.footerBefore': 'This is what the system',
  'knowledge.footerBold': 'works out for itself',
  'knowledge.footerAfter':
    ': the assistant writes to the shared base, each employee writes to their own notebook (📒 on their node, read by nobody else). You can edit and delete, but not add —',
  'knowledge.toLibraryInline': 'your own documents go in the document cabinet',
  'knowledge.ownBefore': 'The private notebook of',
  'knowledge.ownAfter': '— nobody else reads it.',
  'knowledge.sharedBefore': 'The',
  'knowledge.sharedAfter': 'base — every employee in the office reads it, on every job.',
  'knowledge.supersededTitle': 'A newer note has replaced this one.',
  'knowledge.supersededBody':
    'It no longer goes into anyone’s prompt and will be cleared out at the next sweep.',
  'knowledge.editNoteBefore': 'An edit applies to work handed out',
  'knowledge.editNoteBold': 'from now on',
  'knowledge.editNoteAfter':
    '; work already running keeps the old text. Notes live in the prefix cache, so every edit costs one cache write.',
  'knowledge.delete': 'Delete',
  'knowledge.confirmDelete': 'Yes, delete it',

  // ───────────────────────────────────────────────── layered prompt dialog
  'promptLayer.title': 'Prompt for {who}',
  'promptLayer.editable': 'editable',
  'promptLayer.readOnly': 'read-only',
  'promptLayer.edit': 'Edit {title}',
  'promptLayer.fileLabel': 'File:',
  'promptLayer.emptyPlaceholder': 'Leaving it empty is fine — the block then drops out of the prompt entirely.',
  'promptLayer.overLimit':
    'Over the {limit} token ceiling. This block lives in the prefix cache, so every spare line is a cost charged for the whole shift.',
  'promptLayer.loadFailed': 'Could not read the prompt.',
  /**
   * The layer table exists so an advanced user can SEE the core layer and
   * therefore trust it. Hiding it means they guess, and a wrong guess means
   * they write skills that fight the system. → SPEC-offices.md §4.1
   *
   * ⚠ `placeholder` is a REAL example of what to write, and it never reaches a
   * prompt — that is the whole point. A default file body would sit in the
   * prefix cache of every call, so a line like "write a few words about this
   * office" would be a tax charged forever to tell the MODEL something only a
   * PERSON needs. Placeholder text is never saved: 0 tokens.
   */
  'promptLayer.assistantCoreTitle': 'Connection protocol (core)',
  'promptLayer.assistantCoreNote':
    'How the assistant talks to employees, and the protocol it gets results back on.',
  'promptLayer.workerCoreTitle': 'Working protocol (core)',
  'promptLayer.charterTitle': 'About this office',
  'promptLayer.charterPlaceholder':
    '{office} writes content for small business customers.\nThe reader runs a shop; they are not technical.\nEverything is written in plain words, no heavy jargon.',
  'promptLayer.charterNote':
    'What this office does, who for, and any rules it needs. Leaving it empty is fine.',
  'promptLayer.skillsTitle': 'Skills — you write these',
  'promptLayer.assistantSkillsPlaceholder':
    '- Keep it short and plain. Skip the pleasantries.\n- When a request is vague, ask back the ONE question that matters most.\n- Report in ordinary words; do not name tools or quote token counts.',
  'promptLayer.assistantSkillsNote':
    'The assistant’s own character, voice and habits. Leaving it empty is fine.',
  'promptLayer.roleSkillsPlaceholder':
    'For example:\n- Always write in the second person, short sentences.\n- Open with the conclusion, do not build up to it.\n- No emoji.',
  'promptLayer.roleSkillsNote': 'How this employee works. EMPTY is perfectly normal',
  'promptLayer.memoryTitle': 'Memory from the conversation',
  'promptLayer.memoryNote':
    'What YOU settled, compacted by the assistant each time the conversation is cleared (`/clear`). Edit or delete it in the Knowledge drawer — a new version replaces the old one, and the old file is still there.',
  'promptLayer.knowledgeTitle': 'Preloaded lessons',
  'promptLayer.knowledgeNote': 'Built up automatically through work. See more in the knowledge base',
  'promptLayer.libraryTitle': 'Document list',
  'promptLayer.libraryNote': 'The names and shapes of the documents in the cabinet.',
  'promptLayer.artifactsTitle': 'Result file list',
  'promptLayer.artifactsNote':
    'The names of result files, so the assistant can build on earlier results.',
} as const;

/** Every locale file must satisfy this. Missing or extra key ⇒ `tsc` fails. */
export type Catalog = { readonly [K in keyof typeof en]: string };

/** Valid argument to `t()`. Misspelt key ⇒ `tsc` fails. */
export type MessageKey = keyof typeof en;

/**
 * Counted strings. Separate from `en` because the shapes differ: a plural entry
 * is `{ one, other }`, a plain entry is a string, and mixing them would force
 * every `t()` call site to narrow a union it has no reason to care about.
 */
export const enPlural = {
  'inspector.stepCount': { one: '{n} step', other: '{n} steps' },
  'inspector.toolCount': { one: '{n} action', other: '{n} actions' },
  'inspector.peopleCount': { one: '{n} person', other: '{n} people' },
  'plans.jobCount': { one: '{n} job', other: '{n} jobs' },
  'plans.turnCount': { one: '{n} turn', other: '{n} turns' },
  'plans.eventPlanned': { one: 'drew up a plan with {n} step', other: 'drew up a plan with {n} steps' },
  'artifacts.count': { one: '{n} result', other: '{n} results' },
  'artifacts.removed': { one: 'Deleted {n} result.', other: 'Deleted {n} results.' },
  'artifacts.removedWithLeft': {
    one: 'Deleted {n} result — {total} files could not be removed.',
    other: 'Deleted {n} results — {total} files could not be removed.',
  },
  'artifacts.countCapped': {
    one: '{n} result · showing the {shown} most recent',
    other: '{n} results · showing the {shown} most recent',
  },
  'artifacts.countBytes': { one: '{n} result · {size}', other: '{n} results · {size}' },
  'artifacts.confirmAllTitle': { one: 'Delete the {n} result?', other: 'Delete all {n} results?' },
  'artifacts.fileCount': { one: '{n} file', other: '{n} files' },
  'knowledge.noteCount': { one: '{n} note', other: '{n} notes' },
  'overview.agentCount': { one: '{n} person', other: '{n} people' },
  'overview.onDutyCount': { one: '{n} on duty', other: '{n} on duty' },
  'overview.employeeCount': { one: '{n} employee', other: '{n} employees' },
  'overview.lessonNotes': { one: '{n} lesson note', other: '{n} lesson notes' },
  'overview.lessonNotesKept': { one: '{n} lesson note kept', other: '{n} lesson notes kept' },
  'header.taskCount': { one: '{n} task', other: '{n} tasks' },
  'header.turnCount': { one: '{n} turn', other: '{n} turns' },
  'node.libraryCount': { one: '{n} document', other: '{n} documents' },
  'office.armCount': { one: '{n} connection', other: '{n} connections' },
  'cmd.readingMore': { one: 'Reading {names} and {n} more file…', other: 'Reading {names} and {n} more files…' },
  'lib.shapeLines': { one: '{n} line', other: '{n} lines' },
  'lib.shapeCsv': { one: 'csv, {n} row', other: 'csv, {n} rows' },
  'lib.shapeDocxHeadings': { one: 'docx, {n} heading', other: 'docx, {n} headings' },
  'lib.shapeDocxParas': { one: 'docx, {n} paragraph', other: 'docx, {n} paragraphs' },
  'lib.shapeSheets': { one: '{n} sheet', other: '{n} sheets' },
  'lib.shapeSlides': { one: '{n} slide', other: '{n} slides' },
  'lib.shapePdfPages': { one: 'pdf, {n} page', other: 'pdf, {n} pages' },
  'plan.fileCount': { one: '{n} file', other: '{n} files' },
  'off.sweptReplaced': { one: '{n} superseded memory note', other: '{n} superseded memory notes' },
  'off.sweptAged': { one: '{n} note nobody has used in a while', other: '{n} notes nobody has used in a while' },
  'off.andMoreFiles': { one: '…and {n} more file', other: '…and {n} more files' },
  'off.splitInto': { one: 'I split this into {n} job:', other: 'I split this into {n} jobs:' },
  'wk.stoppedPartial': {
    one: 'Stopped part-way. {n} file was written incompletely — look at it before using it.',
    other: 'Stopped part-way. {n} files were written incompletely — look at them before using them.',
  },
  'activity.workers': { one: '{n} employee is working', other: '{n} employees are working' },
  'activity.queued': { one: '{n} message waiting', other: '{n} messages waiting' },
  'activity.jobs': { one: '{n} job queued', other: '{n} jobs queued' },
  'library.extracting': {
    one: 'Reading {n} document… employees can find it by keyword the moment it lands.',
    other: 'Reading {n} documents… employees can find them by keyword the moment they land.',
  },
  'knowledge.tokens': { one: '{n} token', other: '{n} tokens' },
  'knowledge.hits': { one: 'used {n} time', other: 'used {n} times' },
  'promptLayer.tokens': { one: '{n} token', other: '{n} tokens' },
  'promptLayer.tokensOfLimit': { one: '{n} / {limit} token', other: '{n} / {limit} tokens' },
  'promptLayer.affected': {
    one: 'Saving makes {n} employee rewrite its cache once.',
    other: 'Saving makes {n} employees rewrite their cache once.',
  },
} as const;

export type PluralCatalog = {
  readonly [K in keyof typeof enPlural]: { readonly one: string; readonly other: string };
};

export type PluralKey = keyof typeof enPlural;
