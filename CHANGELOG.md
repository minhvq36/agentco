# Changelog

What changed in each release of agentco, newest first. The same text opens the
release's page on GitHub.

Releases before 0.2.8 were published without this file; their pages on GitHub
Releases carry the installer and checksum only.

## 0.2.8 — 2026-09-24

A fix release for **Commands on this machine** (CLI connections).

### Fixed

- **A placeholder written the way READMEs write it now works.** Typing
  `--arg <your text>` into a command's Syntax used to save `<your`, `text>` as
  fixed words, so the command failed every time it ran. The form now spots
  `<…>` — even without the closing `>` — and offers to turn it into a blank
  with one click (**Apply suggestion**).
- **A command whose Example does not match its Syntax can no longer be
  saved.** The Example is the line you know runs, so the form now insists the
  Syntax matches it. When exactly one part differs, one click turns that part
  into a blank, named after the flag in front of it (`--arg` → `{arg}`).
- **A command no longer pretends to have received a value it has no blank
  for.** When an employee tried to pass your text to a command with no blank,
  the command used to run its fixed line anyway and report success. It now
  refuses, runs nothing, and the employee tells you the command needs a blank.
