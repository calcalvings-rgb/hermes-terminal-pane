# Terminal+ — Hermes Desktop plugin

A [Hermes Desktop](https://github.com/NousResearch/hermes-agent) plugin that adds
its **own terminal pane** with a shell picker — **WSL** / **PowerShell** / **cmd**
— instead of the app's single global shell.

> The built-in terminal spawns one fixed shell (the `HERMES_DESKTOP_SHELL` env
> var is global). This plugin gives you a pane where each shell is one click away.

<p align="center">
  <img src="https://img.shields.io/badge/Hermes_Desktop-plugin-181717?style=for-the-badge" alt="Hermes Desktop plugin">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT">
</p>

## Install

### Option A — download the built plugin (no toolchain needed)

1. Download **`plugin.js`** from the [latest release](../../releases/latest).
2. Drop it in the app's **local** plugin folder (create it if needed):

   | OS | Path |
   | --- | --- |
   | Windows | `%LOCALAPPDATA%\hermes\desktop-plugins\terminal-pane\plugin.js` |
   | macOS / Linux | `~/.hermes/desktop-plugins/terminal-pane/plugin.js` |

   > This is the **app's** local `HERMES_HOME/desktop-plugins`, **not** the
   > backend's. For a Windows app that is `%LOCALAPPDATA%\hermes` — even when the
   > agent backend runs in WSL.

3. In Hermes Desktop open **Capabilities ▸ Plugins**, find
   **Terminal (Pilih Shell)** and **enable** it. The disk door is fs-watched — no
   restart needed.
4. The **Terminal+** pane docks in the bottom zone, next to the built-in
   *Terminal* tab. You can also open it from the command palette:
   *"Terminal+: buka pane (pilih shell)"*.

### Option B — build from source

```bash
APP=/path/to/hermes-app-desktop \
DEST=/path/to/HERMES_HOME/desktop-plugins/terminal-pane/plugin.js \
bash build.sh
```

`build.sh` copies `plugin.tsx` into a scratch folder inside the app checkout so
esbuild resolves `@xterm/*` from the app's `node_modules`, bundles to a single
self-contained ESM file (SDK + React stay external), then cleans up.

## What it does

- Renders its **own xterm** and drives the host PTY bridge
  (`window.hermesDesktop.terminal.*`: `start` / `attach` / `write` / `resize` /
  `onData` / `onExit`).
- **WSL / PowerShell / cmd** buttons — each starts a fresh shell of that kind,
  plus a **restart** button.
- A live status line showing which shell the PTY actually reported.

## How shell switching works

`hermes:terminal:start` **ignores** any requested shell — the Electron main
process always resolves one global shell. So the pane spawns the default PTY,
reads the shell it reported (`res.shell`), and **types** the target shell's
launch command into it:

| Host shell | → PowerShell | → cmd | → WSL |
| --- | --- | --- | --- |
| WSL bash | `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` | `/mnt/c/Windows/System32/cmd.exe` | (already there) |
| PowerShell / cmd | `powershell.exe` | `cmd.exe` | `wsl.exe` |

Absolute Windows paths are used when the host is WSL bash, because a WSL that
does not append the Windows PATH cannot find `powershell.exe` by name.

## Why this is a plugin (and not a patch)

The runtime plugin loader evaluates plugins in the renderer realm with **full app
authority** (it is not a capability boundary), so a plugin can reach the very same
PTY bridge the built-in terminal uses. That makes this shippable as a plugin — and
a plugin lives in `desktop-plugins/`, **outside the app source tree**, so **app
updates do not wipe it**.

## Caveats

- The pane renders its **own** xterm (bundled, ~444 KB), so it is plainer than the
  built-in terminal — no app theme wiring, link handling, or context menu.
- Shell switching is by **typing the shell command** into the PTY, not by spawning
  it directly; a brief prompt flash is expected.
- Built and tested on **Windows app + WSL backend**. The shell table is what makes
  it adapt, but other platforms are untested.

## Files

| File | What |
| --- | --- |
| `plugin.tsx` | The plugin source (TSX; JSX compiled by esbuild). |
| `build.sh` | Bundles it into a single `plugin.js` for the disk door. |
| `LICENSE` | MIT. |

## Third-party

Bundles [`@xterm/xterm`](https://github.com/xtermjs/xterm.js) and
[`@xterm/addon-fit`](https://github.com/xtermjs/xterm.js) (MIT).

## License

MIT — see [LICENSE](./LICENSE).
