agentco is a small company of AI employees that runs on your own machine. You
describe a task, they read the documents in your company folder, do the work,
and leave the result as a file on your drive.

### Before you install

**Claude Code must already be installed and signed in.** agentco works through
it, on your own Claude account — without it the app opens but your assistants
cannot answer. https://claude.com/product/claude-code

**This build is not code-signed yet**, so Windows will show *"Windows protected
your PC"* the first time, and Edge may block the download. Choose **More info →
Run anyway**. A signing certificate is a cost waiting its turn, not an
oversight.

### Requirements

- Windows 10 or 11, 64-bit
- About 170 MB of free space
- Claude Code installed and signed in

On macOS and Linux — or from any terminal, Windows included — install the same
version from npm (Node 22 or newer): `npm i -g @agent-co-app/cli`

### Verifying the download

SHA-256 of `AgentCo-win-x64-setup.exe`:

```
{{SHA256}}
```

```powershell
Get-FileHash .\AgentCo-win-x64-setup.exe -Algorithm SHA256
```

### Notes

- Installs per-user to `%LOCALAPPDATA%\AgentCo`; no administrator rights needed.
- Your company folder sits beside the program and **survives uninstalling** —
  removing agentco never removes your documents.
- Nothing is sent anywhere. No account, no telemetry, no activation.
