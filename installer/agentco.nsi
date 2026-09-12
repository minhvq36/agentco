; AgentCo — Windows installer.  -> docs/SPEC-packaging.md §7
;
;   node --experimental-strip-types scripts/package.ts --out <tree>
;   makensis /DTREE=<tree> /DVER=<version> installer\agentco.nsi
;
; ---------------------------------------------------------------------------
; WHY NSIS AND NOT INNO SETUP
;
; Inno was written first and then measured: 6.7.3 prints "Non-commercial use
; only" and carries "Commercial license key" / "Purchase" strings, while the
; license.txt it ships still has the OLD permissive text. agentco is meant to be
; sold. NSIS was checked the same way and passes on evidence:
;
;   COPYING (1999-2026)  zlib/libpng — "for any purpose, including commercial
;                        applications"
;   makensis banner      no non-commercial notice
;   binary strings       no license-key / purchase / trial strings
;
; It also ships 67 languages INCLUDING Vietnamese, which Inno does not.
;
; ⚠ Reading the LICENCE FILE alone would have been misleading in both cases.
; The check that worked was: install it, run its compiler, and grep its binaries.
; ---------------------------------------------------------------------------

!ifndef TREE
  !error "Pass /DTREE=<path to the packaged tree>"
!endif
!ifndef VER
  !define VER "0.0.0"
!endif

!include "MUI2.nsh"
!include "LogicLib.nsh"

Name "AgentCo"
; 🔴 THE FILENAME CARRIES NO VERSION, AND THAT IS LOAD-BEARING.
; GitHub's stable alias resolves by exact filename —
;   /releases/latest/download/AgentCo-win-x64-setup.exe
; — so the website's download button is a constant. Put `${VER}` back in here
; and every release silently breaks that link. The version lives in the git
; tag, the release title, and `VIProductVersion` below.
; → agentco-web/SPEC.md §2
OutFile "${TREE}\..\AgentCo-win-x64-setup.exe"
Unicode true
SetCompressor /SOLID lzma

; -- PER-USER, AND NOT NEGOTIABLE. -> SPEC-packaging §2
; `Program Files` would ask for UAC on EVERY update, which is exactly what
; "ships often" cannot afford, and it would need an administrator to remove.
InstallDir "$LOCALAPPDATA\AgentCo"
RequestExecutionLevel user

; ⚠ Windows wants FOUR parts here and refuses three, so the build number is
; pinned at 0 — `${VER}` stays the one number everybody else reads.
VIProductVersion "${VER}.0"
VIAddVersionKey "ProductName" "AgentCo"
VIAddVersionKey "FileDescription" "AgentCo installer"
VIAddVersionKey "FileVersion" "${VER}"
VIAddVersionKey "LegalCopyright" "AgentCo"

!define MUI_ICON   "agentco.ico"
!define MUI_UNICON "agentco.ico"
!define MUI_ABORTWARNING

; ───────────────────────────────────────────────────────────────────── pages

; -- THE POLICY IS ENGLISH ONLY, IN EVERY LANGUAGE. (the maintainer's call)
;
; A first draft shipped a Vietnamese policy beside the English one, reasoning
; that consent to a document you cannot read is weak consent. True, and it loses
; to a stronger point: A TRANSLATED LEGAL TEXT IS A SECOND AUTHORITATIVE TEXT.
; Ship two and you own the question of which governs when they diverge — and
; they will, because different edits touch them at different times.
;
; The chosen language still governs the app and this wizard's chrome; it just
; does not fork the agreement. If comprehension becomes a real complaint, the
; answer is a plain-language SUMMARY marked as not-the-agreement — a summary has
; no legal force, so it creates no second text.
!define MUI_PAGE_CUSTOMFUNCTION_SHOW LicenseShow
!insertmacro MUI_PAGE_LICENSE "POLICY.txt"

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES

!define MUI_FINISHPAGE_RUN "$INSTDIR\AgentCo.exe"
!define MUI_FINISHPAGE_RUN_TEXT "$(RunText)"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ⚠ English FIRST — it is what a machine set to neither language falls back to.
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Vietnamese"

LangString NoClaude   ${LANG_ENGLISH}    "AgentCo could not find Claude Code on this computer.$\r$\n$\r$\nAgentCo runs on your own Claude account, through Claude Code — without it, your assistants cannot answer.$\r$\n$\r$\nYou can finish installing now and set it up afterwards. AgentCo will tell you what is missing when you open it.$\r$\n$\r$\nInstall anyway?"
LangString NoClaude   ${LANG_VIETNAMESE} "AgentCo không tìm thấy Claude Code trên máy này.$\r$\n$\r$\nAgentCo chạy bằng chính tài khoản Claude của bạn, thông qua Claude Code — thiếu nó thì trợ lý không trả lời được.$\r$\n$\r$\nBạn vẫn có thể cài xong rồi cài Claude Code sau. AgentCo sẽ nói rõ còn thiếu gì khi bạn mở lên.$\r$\n$\r$\nVẫn cài tiếp?"
LangString RunText    ${LANG_ENGLISH}    "Start AgentCo"
LangString RunText    ${LANG_VIETNAMESE} "Mở AgentCo"
LangString SecDesktop ${LANG_ENGLISH}    "Desktop shortcut"
LangString SecDesktop ${LANG_VIETNAMESE} "Lối tắt ngoài màn hình"
LangString SecStart   ${LANG_ENGLISH}    "Start Menu shortcut"
LangString SecStart   ${LANG_VIETNAMESE} "Lối tắt trong Start Menu"
LangString UnStopping ${LANG_ENGLISH}    "AgentCo is running - asking it to shut down..."
LangString UnStopping ${LANG_VIETNAMESE} "AgentCo đang chạy - đang yêu cầu nó tắt..."
LangString UnStillOn  ${LANG_ENGLISH}    "AgentCo is still running, so its files cannot be removed.$\r$\n$\r$\nShut it down - the power button in AgentCo's own window - and then press Retry.$\r$\n$\r$\nCancel leaves this computer exactly as it is: nothing has been removed yet."
LangString UnStillOn  ${LANG_VIETNAMESE} "AgentCo vẫn đang chạy nên chưa xoá được các tệp của nó.$\r$\n$\r$\nHãy bấm nút tắt hẳn trong cửa sổ AgentCo, rồi bấm Retry.$\r$\n$\r$\nBấm Cancel thì máy vẫn nguyên như cũ: chưa có gì bị xoá."
LangString UnGaveUp   ${LANG_ENGLISH}    "Stopped. AgentCo is still running and nothing was removed."
LangString UnGaveUp   ${LANG_VIETNAMESE} "Đã dừng. AgentCo vẫn đang chạy và chưa có gì bị xoá."
LangString UnLeftover ${LANG_ENGLISH}    "Part of AgentCo could not be removed - something on this computer is still using it:$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\nAgentCo is still listed in Apps & features. Restart the computer and remove it again from there.$\r$\n$\r$\nYour company folder was not touched."
LangString UnLeftover ${LANG_VIETNAMESE} "Còn một phần AgentCo chưa xoá được - vẫn có thứ gì đó trên máy đang dùng nó:$\r$\n$\r$\n$INSTDIR$\r$\n$\r$\nAgentCo vẫn còn trong Apps & features. Hãy khởi động lại máy rồi gỡ lại từ đó.$\r$\n$\r$\nThư mục công ty của bạn không bị đụng tới."

; ─────────────────────────────────────────────────────────────── the policy

Function LicenseShow
  ; -- NO TEXT CARET ON THE POLICY. (the maintainer's call)
  ;
  ; MUI's licence control is a read-only RichEdit, so nothing can be typed into
  ; it — but it still shows a blinking caret, and a caret is the universal sign
  ; for "this is a box you fill in". On the one screen whose whole job is to be
  ; READ, that is the wrong invitation.
  ;
  ; ⚠ Selecting and scrolling still work, deliberately: somebody must be able to
  ; copy a clause out and to scroll to the end. What goes is the caret alone.
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1000
  System::Call "user32::HideCaret(p $1)"
FunctionEnd

; ───────────────────────────────────────────────────────────────────── init

Function .onInit
  !insertmacro MUI_LANGDLL_DISPLAY

  ; -- IS CLAUDE CODE HERE?  A DELIBERATELY LOOSE CHECK, AND IT ONLY WARNS.
  ;
  ; The real resolver is in the product (`core/claude-code.ts`) and knows four
  ; install shapes across three operating systems, of which exactly one has been
  ; exercised on real hardware. Reimplementing it here would be a second copy
  ; that drifts; calling it would mean running the product before it exists.
  ;
  ; ⚠ AND IT ONLY APPEARS WHEN CLAUDE CODE IS MISSING. On a machine that has it,
  ; there is no screen and no pause — which is correct, and is why the person
  ; who built this saw no such page: their machine already had it.
  ;
  ; Blocking would turn every false negative into "cannot install at all" on a
  ; machine where Claude Code works perfectly, and false negatives are likely
  ; here because this is the crude check. -> SPEC-packaging §7.6
  IfFileExists "$APPDATA\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe" claude_ok 0
  IfFileExists "$LOCALAPPDATA\Programs\claude\claude.exe" claude_ok 0
    ; ⚠ `/SD IDYES` because a box with no silent default HANGS `setup.exe /S`
    ; forever, on exactly the machines this warning is for. IDYES is the same
    ; answer the paragraph above argues for: warn, never block.
    MessageBox MB_YESNO|MB_ICONQUESTION "$(NoClaude)" /SD IDYES IDYES claude_ok
    Abort
  claude_ok:
FunctionEnd

; ─────────────────────────────────────────────────────────────────── install

Section "AgentCo" SecCore
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${TREE}\*.*"
  File "POLICY.txt"

  ; -- THE COMPANY FOLDER SITS BESIDE THE PROGRAM. (the maintainer's call)
  ;
  ; There is no picker and no `company-dir.txt`: `$INSTDIR\company`, always. One
  ; place to find, one place to back up, and nothing to look up at launch.
  ;
  ; ⚠ It survives updates because an update replaces `app\` and `runtime\` only,
  ; and it survives UNINSTALL because the uninstaller deliberately leaves it —
  ; see below.
  ;
  ; ⚠ THE COST, STATED: `%LOCALAPPDATA%` is normally outside a user's own backup
  ; and outside OneDrive sync. The customer's offices, documents and knowledge
  ; live here, so "where are my backups" has a worse answer than it would under
  ; Documents. Accepted for findability; revisit if anyone loses work.
  CreateDirectory "$INSTDIR\company"

  ; -- Create the company in the language just chosen. `--lang` goes straight
  ; into company.yaml and outranks every OS hint, because a person was asked.
  ; -> SPEC-packaging §7.1
  StrCpy $1 "en"
  ${If} $LANGUAGE == ${LANG_VIETNAMESE}
    StrCpy $1 "vi"
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\agentco.cmd" init --dir "$INSTDIR\company" --lang $1'
  Pop $0

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentCo" "DisplayName" "AgentCo"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentCo" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentCo" "DisplayIcon" "$INSTDIR\AgentCo.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentCo" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentCo" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentCo" "NoModify" 1
SectionEnd

; -- Both shortcuts are OPTIONAL and both are TICKED. That is what people
; expect, and un-ticking is a two-second decision they get to make rather than
; a surprise they discover afterwards.
Section "$(SecStart)" SecStart
  CreateShortcut "$SMPROGRAMS\AgentCo.lnk" "$INSTDIR\AgentCo.exe" "" "$INSTDIR\AgentCo.exe" 0
SectionEnd

Section "$(SecDesktop)" SecDesktop
  CreateShortcut "$DESKTOP\AgentCo.lnk" "$INSTDIR\AgentCo.exe" "" "$INSTDIR\AgentCo.exe" 0
SectionEnd

; ───────────────────────────────────────────────────────────────── uninstall

; -- 🔴 A RUNNING DAEMON TURNS THIS SECTION INTO A HALF-UNINSTALL, SILENTLY.
;
; People forget to shut AgentCo down before removing it, and NSIS does not mind:
; `Delete` and `RMDir` set the error flag on failure, nothing here reads it, and
; the wizard still finishes green. What is actually left behind:
;
;   node.exe        HELD  - the daemon is that process; the image is mapped
;   AgentCo.exe     HELD  - the launcher sits waiting on node for its exit code
;   app\…\*.js      gone  - Node closes each file after reading it
;   the registry key gone - DeleteRegKey cannot fail the way a locked file can
;
; So the program vanishes from Apps & features while ~90 MB of it, and a LIVE
; daemon still answering on 7317, stay on the machine — with the code under it
; deleted. No error, no mark, nothing to retry from. → SPEC-packaging §7.7
;
; ⚠ THE POLITE STOP IS NOT THE GATE, AND MUST NOT BE. `agentco stop` exits 0
; when nothing was running, and its shutdown is asynchronous — the POST returns
; before the process is gone. Believing it would put us right back in the state
; above. The gate is the FILE LOCK itself: what we are about to delete, opened
; for write. A running image cannot be opened that way, so the answer is about
; the very thing the section is about to touch.
;
; ⚠ AND NEVER `taskkill /IM node.exe`. That name is not ours - it would kill the
; customer's editor, their dev server, whatever else is mid-write.
!define UN_WAIT_TICKS 20   ; × 500 ms = 10 s before we ask the human

!macro UN_HELD path
  ; Sets $R9 to 1 the first time a candidate refuses to open for write.
  ${If} $R9 == 0
  ${AndIf} ${FileExists} "${path}"
    ClearErrors
    FileOpen $R8 "${path}" a
    ${If} ${Errors}
      StrCpy $R9 1
    ${Else}
      FileClose $R8
    ${EndIf}
  ${EndIf}
!macroend

; -> $R9 = 1 when a live process still holds this install, 0 when it is free.
Function un.Held
  Push $0
  Push $1
  StrCpy $R9 0
  !insertmacro UN_HELD "$INSTDIR\AgentCo.exe"
  ; ⚠ The runtime is found, not spelled out: the version in `runtime\node-vX`
  ; moves about twice a year (SPEC-packaging §3.5) and an uninstaller that names
  ; one is an uninstaller that stops checking after the next runtime bump.
  FindFirst $0 $1 "$INSTDIR\runtime\node-v*"
  ${DoWhile} $1 != ""
    !insertmacro UN_HELD "$INSTDIR\runtime\$1\node.exe"
    FindNext $0 $1
  ${Loop}
  FindClose $0
  Pop $1
  Pop $0
FunctionEnd

; Returns only when the install is free. Otherwise it ABORTS — before the first
; `Delete`, so the machine is left whole rather than half-emptied.
Function un.EnsureStopped
  Push $0
  Push $1

 attempt:
  Call un.Held
  ${If} $R9 == 0
    Pop $1
    Pop $0
    Return
  ${EndIf}

  ; Ask the product to close itself the way its own UI does — POST /api/shutdown,
  ; which lets the daemon clear `company\.state\daemon.json` and exit cleanly
  ; instead of dying mid-write. → src/cli/index.ts `cmdStop`
  ${If} ${FileExists} "$INSTDIR\agentco.cmd"
    DetailPrint "$(UnStopping)"
    nsExec::ExecToLog '"$INSTDIR\agentco.cmd" stop'
    Pop $0
  ${EndIf}

  StrCpy $1 0
 wait:
  Sleep 500
  Call un.Held
  ${If} $R9 == 0
    Pop $1
    Pop $0
    Return
  ${EndIf}
  IntOp $1 $1 + 1
  ${If} $1 < ${UN_WAIT_TICKS}
    Goto wait
  ${EndIf}

  ; -- Whatever is holding it is not ours to close: a daemon started against a
  ; different company folder, a launcher stuck on its own error box, an antivirus
  ; mid-scan. A person can see it; we cannot.
  ;
  ; ⚠ `/SD IDCANCEL` is what keeps `uninstall.exe /S` honest. A silent uninstall
  ; has nobody to press Retry, and the two ways to fail it are "hang forever" and
  ; "delete what you can" — both worse than stopping with the machine intact.
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(UnStillOn)" /SD IDCANCEL IDRETRY attempt
  DetailPrint "$(UnGaveUp)"
  SetErrorLevel 2
  Abort
FunctionEnd

Section "Uninstall"
  ; 🔴 FIRST LINE, BEFORE ANY DELETE. See the block above: the value of this call
  ; is that "we gave up" and "we half-removed it" cannot both be true.
  Call un.EnsureStopped

  ; 🔴 THE COMPANY FOLDER IS NEVER TOUCHED, AND THAT IS THE POINT OF THIS BLOCK.
  ;
  ; It holds the customer's offices, documents, results and knowledge —
  ; everything the product exists to accumulate, and what `BUSINESS.md` calls
  ; the highest switching cost there is. Removing the program must not remove
  ; their work. Deleting it is their own deliberate act, in their own file
  ; manager, with their own eyes on the folder.
  Delete "$SMPROGRAMS\AgentCo.lnk"
  Delete "$DESKTOP\AgentCo.lnk"
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\runtime"
  Delete "$INSTDIR\agentco.cmd"
  Delete "$INSTDIR\AgentCo.exe"
  Delete "$INSTDIR\POLICY.txt"
  Delete "$INSTDIR\current"

  ; -- 🔴 DID THE DELETES ACTUALLY WORK? NOBODY ASKED BEFORE.
  ;
  ; `un.EnsureStopped` closes the cause we know about — the two binaries a live
  ; daemon holds. It cannot close a cause we have not met: a process whose
  ; working directory is inside `app\`, an antivirus reading a file, a folder
  ; open in Explorer's preview pane. Every one of those leaves `RMDir /r`
  ; failing exactly as quietly as the daemon used to.
  ;
  ; ⇒ so the section ENDS by looking at the disk instead of trusting its own
  ; commands. The pair has to have the same reach: a check that only knows about
  ; locked binaries would go on reporting success for everything else.
  ; [[agentco-detect-fix-pair-scope]]
  ;
  ; ⚠ AND WHAT IS KEPT ON FAILURE IS THE POINT: `uninstall.exe` and the registry
  ; key both STAY. That is what leaves AgentCo listed in Apps & features with a
  ; working Uninstall button, so "close it and try again" is a thing the customer
  ; can actually do. Deleting the key on a failed removal is what turned this
  ; into an unrecoverable state — leftovers no door leads back to.
  ${If} ${FileExists} "$INSTDIR\app"
  ${OrIf} ${FileExists} "$INSTDIR\runtime"
    DetailPrint "$(UnLeftover)"
    MessageBox MB_ICONEXCLAMATION "$(UnLeftover)" /SD IDOK
    SetErrorLevel 2
    Return
  ${EndIf}

  Delete "$INSTDIR\uninstall.exe"
  ; ⚠ RMDir WITHOUT /r — it removes the folder ONLY if it is empty, i.e. only
  ; when `company\` is not there. A `/r` here would be the one line that deletes
  ; everything the paragraph above exists to protect.
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentCo"
SectionEnd

Function un.onInit
  !insertmacro MUI_UNGETLANGUAGE
FunctionEnd
