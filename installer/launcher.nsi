; AgentCo.exe — the thing the icon points at.  -> docs/SPEC-cli.md §1
;
;   makensis /DNODEDIR=runtime\node-vX /DAPPVER=0.0.1 installer\launcher.nsi
;
; ---------------------------------------------------------------------------
; WHY THIS IS AN .EXE AND NOT THE .VBS IT REPLACES
;
; 1. VBSCRIPT IS BEING RETIRED. Microsoft moved it to feature-on-demand in
;    2024 with removal stated as the direction. Shipping a product whose only
;    entry point is a .vbs is building on a floor that is being taken up.
;
; 2. ⚠ AND THE .VBS COULD NOT REPORT A FAILURE. `WScript.Shell.Run(..., 0, ...)`
;    means no window, which also means no stdout, no stderr and no exit code
;    anybody sees. Measured symptom: double-click the icon a second time and
;    NOTHING HAPPENS — no browser, no error, nothing. Whatever went wrong (a
;    port already taken, a company folder that moved) printed to a console that
;    did not exist. **A launcher that cannot fail out loud is a launcher that
;    teaches the user the app is broken.**
;
; `SilentInstall silent` makes NSIS emit a plain GUI-subsystem program: no
; wizard, no window, and — being GUI-subsystem — no console can be attached to
; it at all. That is the same guarantee wscript gave, from something that is not
; being deprecated and that can show a message box when it needs to.
; ---------------------------------------------------------------------------

!ifndef NODEDIR
  !error "Pass /DNODEDIR=<relative path to the runtime>"
!endif
!ifndef APPVER
  !error "Pass /DAPPVER=<app version>"
!endif

!include "LogicLib.nsh"

Name "AgentCo"
OutFile "AgentCo.exe"
Icon "agentco.ico"
Unicode true
SilentInstall silent
RequestExecutionLevel user

VIProductVersion "0.0.0.0"
VIAddVersionKey "ProductName" "AgentCo"
VIAddVersionKey "FileDescription" "AgentCo"
VIAddVersionKey "FileVersion" "${APPVER}"
VIAddVersionKey "LegalCopyright" "AgentCo"

Section
  ; -- The bundled runtime goes FIRST on PATH. CLI arms and `npx` then resolve
  ; against the Node we shipped rather than whatever the machine happens to
  ; carry. -> SPEC-packaging §9.5
  ReadEnvStr $1 "PATH"
  System::Call 'kernel32::SetEnvironmentVariable(t "PATH", t "$EXEDIR\${NODEDIR};$1")'

  ; -- WHERE THE COMPANY IS. It sits beside the program, so there is nothing to
  ; look up and nothing to lose on an update — `app\` is replaced, `company\` is
  ; not. -> SPEC-packaging §7.5
  System::Call 'kernel32::SetEnvironmentVariable(t "AGENTCO_COMPANY_DIR", t "$EXEDIR\company")'

  ; ---------------------------------------------------------------------------
  ; -- WHICH VERSION TO RUN COMES FROM `current`, NOT FROM THIS BINARY.
  ;
  ; ${APPVER} used to be used directly here, and `agentco.cmd` had the number
  ; written into it the same way. `current` was therefore a POINTER NOTHING
  ; READ: writing a newer `app\<ver>\` and flipping it changed nothing, because
  ; the thing that CHOOSES was inside the thing being replaced — and this .exe
  ; is held open while the daemon runs, so it cannot be replaced either.
  ; An updater is only possible once the choice lives outside. -> SPEC-packaging §3.7
  ;
  ; ⚠ ${APPVER} REMAINS AS THE FALLBACK. A missing, empty or stale pointer must
  ; land on a version that exists. And the last resort SPEAKS rather than doing
  ; nothing — the whole reason this file replaced a .vbs was a second click that
  ; silently did nothing.
  ; ---------------------------------------------------------------------------
  StrCpy $2 "app\${APPVER}"

  ClearErrors
  FileOpen $3 "$EXEDIR\current" r
  ${IfNot} ${Errors}
    FileRead $3 $4
    FileClose $3
    ; Trim trailing CR/LF: the packager writes no newline, but an editor that
    ; touched the file would add one, and a path with a newline in it exists
    ; nowhere.
    trim:
      StrCpy $5 $4 1 -1
      ${If} $5 == "$\r"
      ${OrIf} $5 == "$\n"
        StrCpy $4 $4 -1
        Goto trim
      ${EndIf}
    ${If} $4 != ""
      StrCpy $2 $4
    ${EndIf}
  ${EndIf}

  ${IfNot} ${FileExists} "$EXEDIR\$2\dist\cli\index.js"
    StrCpy $2 "app\${APPVER}"
  ${EndIf}
  ${IfNot} ${FileExists} "$EXEDIR\$2\dist\cli\index.js"
    MessageBox MB_ICONSTOP "AgentCo could not start: no app was found in its folder.$\r$\n$\r$\nReinstalling AgentCo from agent-co.app will restore it."
    Abort
  ${EndIf}

  ; -- Run it, and WAIT.
  ;
  ; Waiting is not an oversight. Two cases, and waiting is right for both:
  ;   first launch  -> the daemon runs until the user shuts it down, so this
  ;                    process stays as the app's presence in Task Manager.
  ;   later launch  -> `start` finds the running daemon, opens a browser window
  ;                    onto it and exits at once.
  ; Either way a non-zero exit is a real failure that somebody must be told
  ; about, which is the whole reason this file exists.
  nsExec::Exec '"$EXEDIR\${NODEDIR}\node.exe" "$EXEDIR\$2\dist\cli\index.js" start'
  Pop $0

  ${If} $0 == "error"
    MessageBox MB_ICONSTOP "AgentCo could not start: the bundled runtime is missing.$\r$\n$\r$\nReinstalling AgentCo will restore it."
  ${ElseIf} $0 != 0
  ${AndIf} $0 != ""
    ; ⚠ NAMES THE LIKELY CAUSE AND WHAT TO DO, never just a number. The person
    ; reading this did not ask for a diagnostic; they double-clicked an icon.
    MessageBox MB_ICONEXCLAMATION "AgentCo stopped unexpectedly (code $0).$\r$\n$\r$\nRun 'agentco.cmd doctor' in the AgentCo folder to see what is wrong."
  ${EndIf}
SectionEnd
