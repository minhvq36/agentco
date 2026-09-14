/**
 * A Linux menu entry for one company — `agentco shortcut`. → docs/SPEC-cli.md §6.2
 *
 * 🔴 WHY THIS EXISTS: the npm door puts `agentco` on a terminal's PATH and
 * nowhere else. A GUI user on Ubuntu then has to open a terminal every morning
 * to start an app whose whole interface is a browser window. The Windows
 * installer already lays down a Start-menu shortcut; this is the same icon for
 * the one platform where writing it is a plain text file and no signing wall.
 *
 * ⚠ NOT FOR macOS, and not by oversight: `.desktop` is a freedesktop.org file
 * that Finder ignores. A Mac launcher is an `.app` bundle — a different
 * mechanism, to be measured on real hardware before it is promised.
 *
 * 🔴 EVERY PATH IS ABSOLUTE, AND THAT IS THE MECHANISM, NOT TIDINESS.
 * A menu entry is started by the desktop session, which does not read
 * `~/.bashrc`. So `node` from nvm — the most common way a developer on Linux
 * has Node at all — is NOT ON THE PATH the entry runs with, and an
 * `Exec=agentco start` would do nothing at all when clicked. `process.execPath`
 * and the real file of the running CLI are the two paths that are true right
 * now. ⚠ The cost, stated: switch Node versions under nvm and the old path is
 * gone — `TryExec` then hides the entry instead of leaving a dead icon, and
 * running `agentco shortcut` again writes the new one.
 *
 * ⚠ ONE FILE PER COMPANY, named by a hash of its folder. Companies live wherever
 * `agentco init` was typed (settled 14/09: a CLI follows the directory it is
 * run in), so one machine can hold several, and a fixed file name would let
 * the second shortcut silently overwrite the first.
 */

import crypto from 'node:crypto';
import path from 'node:path';

export interface DesktopEntryInput {
  /** Shown in the applications menu. */
  name: string;
  /** Absolute path to the Node binary running right now. */
  node: string;
  /** Absolute path to the CLI's own entry file. */
  cli: string;
  /** Absolute company folder, passed as `--dir`. */
  companyDir: string;
  /** Absolute path to an icon file, when the package carries one. */
  icon?: string;
}

/** Set on the child so a failure knows there is no terminal to print into. */
export const DESKTOP_LAUNCHER_ENV = 'AGENTCO_LAUNCHER';

export function desktopFileName(companyDir: string): string {
  const hash = crypto.createHash('sha256').update(path.resolve(companyDir)).digest('hex').slice(0, 8);
  return `agentco-${hash}.desktop`;
}

/**
 * The general escape rule for a `string` value: backslash and tab.
 * A line break cannot be represented in a path argument at all, so it is
 * refused rather than mangled into a different path.
 */
function escapeValue(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(`a menu entry cannot hold a line break: ${JSON.stringify(value)}`);
  }
  return value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t');
}

/**
 * One `Exec` argument, QUOTED.
 *
 * 🔴 TWO ESCAPING LAYERS, APPLIED IN THIS ORDER, and the spec says so outright:
 * inside double quotes `"` `` ` `` `$` `\` take a backslash (the quoting rule),
 * and then the whole value goes through the string rule, which doubles every
 * backslash again. A literal `\` in a path therefore reaches the file as FOUR
 * backslashes and a `$` as `\\$`. Get the order wrong and a folder named
 * `my $pace` starts the daemon against a folder that does not exist — with no
 * terminal to say so. `%` is a field code (`%f`, `%u`) and becomes `%%`.
 *
 * Every argument is quoted, including ones that do not need it: one rule with
 * no "is this one safe?" branch is the version that cannot be half-right.
 */
export function execArg(arg: string): string {
  return `"${arg.replace(/[\\"`$]/g, (c) => `\\${c}`).replace(/%/g, '%%')}"`;
}

export function desktopEntry(o: DesktopEntryInput): string {
  const exec = [
    'env',
    `${DESKTOP_LAUNCHER_ENV}=desktop`,
    execArg(o.node),
    execArg(o.cli),
    'start',
    '--dir',
    execArg(o.companyDir),
  ].join(' ');

  const lines = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${escapeValue(o.name)}`,
    `Comment=${escapeValue(o.companyDir)}`,
    // Hides the entry once this Node is gone, rather than a click that does nothing.
    `TryExec=${escapeValue(o.node)}`,
    `Exec=${escapeValue(exec)}`,
    ...(o.icon ? [`Icon=${escapeValue(o.icon)}`] : []),
    'Terminal=false',
    // `start` never exits while the company runs, so a startup-notify spinner
    // would spin until the desktop gives up on it.
    'StartupNotify=false',
    'Categories=Office;Utility;',
  ];
  return lines.join('\n') + '\n';
}
