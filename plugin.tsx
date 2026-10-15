/**
 * Terminal+ — desktop plugin yang bikin PANE terminal SENDIRI dengan pilihan
 * shell (WSL / PowerShell / cmd), bukan satu shell global milik app.
 *
 * Kenapa bisa: runtime loader mengevaluasi plugin di realm renderer dengan
 * "FULL app authority" (bukan sandbox), jadi `window.hermesDesktop.terminal.*`
 * (start/attach/write/resize/onData/onExit) bisa dipanggil dari plugin.
 *
 * Pilih shell: `hermes:terminal:start` MENGABAIKAN shell yang diminta (main
 * process selalu pakai satu shell global). Jadi pane ini spawn PTY default,
 * lalu MENGETIK perintah shell tujuan ke dalamnya. Perintah dipilih dari shell
 * yang benar-benar dilaporkan PTY, jadi tetap benar entah default-nya WSL bash
 * atau Windows PowerShell.
 *
 * Build (dari root repo app, biar resolusi node_modules benar):
 *   npx esbuild plugin.tsx --bundle --format=esm --platform=browser \
 *     --target=es2022 --jsx=automatic --loader:.css=text \
 *     --external:@hermes/plugin-sdk --external:react \
 *     --external:react/jsx-runtime --external:react/jsx-dev-runtime \
 *     --outfile=<HERMES_HOME>/desktop-plugins/terminal-pane/plugin.js
 */

import { Codicon, cn, host, PALETTE_AREA } from '@hermes/plugin-sdk'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import xtermCss from '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState } from 'react'

const PLUGIN_ID = 'terminal-pane'
const PANE_LOCAL_ID = 'shells'
const PANE_ID = `${PLUGIN_ID}:${PANE_LOCAL_ID}`
const CSS_ID = 'terminal-pane-xterm-css'
const SYS32 = '/mnt/c/Windows/System32'

type ShellId = 'cmd' | 'powershell' | 'wsl'

const SHELLS: Array<{ icon: string; id: ShellId; label: string }> = [
  { icon: 'terminal-linux', id: 'wsl', label: 'WSL' },
  { icon: 'terminal-powershell', id: 'powershell', label: 'PowerShell' },
  { icon: 'terminal-cmd', id: 'cmd', label: 'cmd' }
]

interface TerminalBridge {
  attach: (id: string) => Promise<boolean>
  dispose: (id: string) => Promise<boolean>
  onData: (id: string, cb: (data: string) => void) => () => void
  onExit: (id: string, cb: (payload: unknown) => void) => () => void
  resize: (id: string, size: { cols: number; rows: number }) => Promise<boolean>
  start: (opts: { cols: number; cwd?: string; rows: number }) => Promise<{ cwd: null | string; id: string; shell: string }>
  write: (id: string, data: string) => Promise<boolean>
}

const bridge = (): TerminalBridge | undefined =>
  (window as unknown as { hermesDesktop?: { terminal?: TerminalBridge } }).hermesDesktop?.terminal

function injectCss(): void {
  if (document.getElementById(CSS_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = CSS_ID
  style.textContent = String(xtermCss ?? '')
  document.head.appendChild(style)
}

/** Keluarga shell dari nama shell yang dilaporkan PTY. */
function familyOf(shell: string): 'other' | ShellId {
  const s = (shell || '').toLowerCase()

  if (s.includes('bash') || s.includes('wsl')) {
    return 'wsl'
  }

  if (s.includes('pwsh') || s.includes('powershell')) {
    return 'powershell'
  }

  if (s.includes('cmd')) {
    return 'cmd'
  }

  return 'other'
}

/** Perintah untuk pindah dari shell saat ini ke `target`; null kalau sudah di
 *  sana. WSL tidak melihat PATH Windows, jadi target Windows dialamati dengan
 *  path absolut saat host-nya bash. */
function switchCommand(target: ShellId, current: 'other' | ShellId): null | string {
  if (current === target) {
    return null
  }

  const fromWsl = current === 'wsl'

  if (target === 'wsl') {
    return 'wsl.exe'
  }

  if (target === 'powershell') {
    return fromWsl ? `${SYS32}/WindowsPowerShell/v1.0/powershell.exe` : 'powershell.exe'
  }

  return fromWsl ? `${SYS32}/cmd.exe` : 'cmd.exe'
}

const chipStyle = (on: boolean): React.CSSProperties => ({
  alignItems: 'center',
  background: on ? 'var(--ui-bg-elevated, #26262b)' : 'transparent',
  border: 'none',
  borderRadius: 4,
  color: on ? 'var(--ui-text, #e6e6e6)' : 'var(--ui-text-tertiary, #9a9aa2)',
  cursor: 'pointer',
  display: 'inline-flex',
  fontSize: 11,
  gap: 4,
  padding: '2px 8px'
})

function TerminalPane(): React.ReactElement {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const sessionRef = useRef<null | string>(null)
  const dataOffRef = useRef<null | (() => void)>(null)
  const shellRef = useRef<ShellId>('wsl')
  const [active, setActive] = useState<ShellId>('wsl')
  const [note, setNote] = useState('menyiapkan…')

  const startPty = (target: ShellId): void => {
    const term = termRef.current
    const api = bridge()

    if (!term) {
      return
    }

    if (!api) {
      setNote('bridge terminal tidak tersedia')
      term.write('\r\n\x1b[31mwindow.hermesDesktop.terminal tidak ada di build ini.\x1b[0m\r\n')

      return
    }

    if (dataOffRef.current) {
      try {
        dataOffRef.current()
      } catch {
        /* ignore */
      }

      dataOffRef.current = null
    }

    if (sessionRef.current) {
      const old = sessionRef.current
      sessionRef.current = null
      void api.dispose(old).catch(() => undefined)
    }

    term.reset()
    setNote('memulai…')

    void (async () => {
      try {
        const res = await api.start({ cols: term.cols, rows: term.rows })
        sessionRef.current = res.id
        await api.attach(res.id)
        dataOffRef.current = api.onData(res.id, data => term.write(data))
        api.onExit(res.id, () => {
          term.write('\r\n\x1b[2m[shell berakhir — klik restart untuk mulai lagi]\x1b[0m\r\n')
        })
        term.onData(data => {
          void api.write(res.id, data).catch(() => undefined)
        })
        term.focus()

        const current = familyOf(res.shell)
        const cmd = switchCommand(target, current)
        setNote(`shell: ${res.shell || target}${cmd ? ` → ${target}` : ''}`)

        if (cmd) {
          window.setTimeout(() => {
            void api.write(res.id, `${cmd}\r`).catch(() => undefined)
          }, 350)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setNote(`gagal: ${message}`)
        term.write(`\r\n\x1b[31mGagal memulai terminal: ${message}\x1b[0m\r\n`)
      }
    })()
  }

  const pick = (target: ShellId): void => {
    shellRef.current = target
    setActive(target)
    startPty(target)
  }

  useEffect(() => {
    injectCss()

    const term = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: 'Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      scrollback: 5000,
      theme: { background: '#0b0b0d', foreground: '#e6e6e6' }
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    termRef.current = term
    fitRef.current = fit

    const mount = mountRef.current

    if (mount) {
      term.open(mount)
      try {
        fit.fit()
      } catch {
        /* belum ter-layout */
      }
    }

    let raf = 0

    const refit = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        try {
          fit.fit()

          if (sessionRef.current) {
            void bridge()?.resize(sessionRef.current, { cols: term.cols, rows: term.rows }).catch(() => undefined)
          }
        } catch {
          /* ignore */
        }
      })
    }

    const ro = new ResizeObserver(refit)

    if (mount) {
      ro.observe(mount)
    }

    window.addEventListener('resize', refit)
    // Pane bisa muncul dengan ukuran 0 lalu ter-layout — coba fit lagi.
    window.setTimeout(refit, 60)
    window.setTimeout(refit, 300)

    startPty(shellRef.current)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', refit)

      if (dataOffRef.current) {
        try {
          dataOffRef.current()
        } catch {
          /* ignore */
        }

        dataOffRef.current = null
      }

      if (sessionRef.current) {
        void bridge()?.dispose(sessionRef.current).catch(() => undefined)
        sessionRef.current = null
      }

      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      style={{
        background: '#0b0b0d',
        color: 'var(--ui-text, #e6e6e6)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        width: '100%'
      }}
    >
      <div
        style={{
          alignItems: 'center',
          borderBottom: '1px solid var(--ui-border, #2a2a30)',
          display: 'flex',
          flexShrink: 0,
          gap: 4,
          padding: '4px 8px'
        }}
      >
        {SHELLS.map(s => (
          <button key={s.id} onClick={() => pick(s.id)} style={chipStyle(active === s.id)} type="button">
            <Codicon name={s.icon} size="0.75rem" />
            {s.label}
          </button>
        ))}
        <button
          onClick={() => startPty(shellRef.current)}
          style={chipStyle(false)}
          title="Mulai ulang shell"
          type="button"
        >
          <Codicon name="refresh" size="0.75rem" />
          restart
        </button>
        <span
          className={cn()}
          style={{
            color: 'var(--ui-text-quaternary, #6f6f78)',
            fontSize: 11,
            marginLeft: 'auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
        >
          {note}
        </span>
      </div>
      <div ref={mountRef} style={{ flex: 1, minHeight: 0, padding: 4 }} />
    </div>
  )
}

export default {
  id: PLUGIN_ID,
  name: 'Terminal (Pilih Shell)',
  description: 'Pane terminal sendiri dengan pilihan shell: WSL, PowerShell, atau cmd.',
  defaultEnabled: false,
  register(ctx: { register: (contribution: unknown) => unknown }) {
    ctx.register({
      id: PANE_LOCAL_ID,
      area: 'panes',
      title: 'Terminal+',
      order: 95,
      data: {
        placement: 'bottom',
        height: '32vh',
        maxHeight: '80vh',
        lifecycleKeepAlive: true,
        tabTitleText: () => 'Terminal+'
      },
      render: () => <TerminalPane />
    })

    const reveal = (): void => {
      try {
        host.undismissPane?.(PANE_ID)
        host.revealPane?.(PANE_ID)
      } catch {
        /* shell lama tanpa API ini */
      }
    }

    ctx.register({
      id: 'open',
      area: PALETTE_AREA,
      order: 200,
      data: {
        id: `${PLUGIN_ID}:open`,
        label: 'Terminal+: buka pane (pilih shell)',
        keywords: ['terminal', 'shell', 'wsl', 'powershell', 'cmd', 'pane'],
        icon: 'terminal',
        run: reveal
      }
    })

    // Tampilkan sekali saat aktif, biar pane-nya ketemu.
    window.setTimeout(reveal, 500)
  }
}
