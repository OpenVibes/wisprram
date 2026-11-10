// Best-effort "which app is in front" for per-app styles. Never throws; failures → undefined.
import { execFile } from 'node:child_process'
import type { AppContext } from '@shared/api'

let cache: { at: number; value: AppContext | undefined } | null = null
const CACHE_MS = 1000

function run(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 64 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))))
  })
}

/** macOS: lsappinfo needs no Automation permission; osascript (System Events) is the fallback. */
async function macFrontmost(): Promise<AppContext | undefined> {
  try {
    const asn = (await run('/usr/bin/lsappinfo', ['front'], 600)).trim()
    if (asn) {
      const out = await run('/usr/bin/lsappinfo', ['info', '-only', 'name', '-only', 'bundleid', asn], 600)
      const name = /"LSDisplayName"\s*=\s*"([^"]*)"/.exec(out)?.[1]
      const bundle = /"CFBundleIdentifier"\s*=\s*"([^"]*)"/.exec(out)?.[1]
      const clean = name?.replace(/[\u200e\u200f\u202a-\u202e]/g, '').trim()
      if (clean) return bundle ? { name: clean, bundle_id: bundle } : { name: clean }
    }
  } catch {
    /* fall through */
  }
  try {
    const name = (
      await run('/usr/bin/osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], 800)
    ).trim()
    if (name) return { name }
  } catch {
    /* ignore */
  }
  return undefined
}

const PS_SCRIPT = `
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class WrFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
"@
$h = [WrFg]::GetForegroundWindow()
$p = 0
[void][WrFg]::GetWindowThreadProcessId($h, [ref]$p)
$sb = New-Object System.Text.StringBuilder 256
[void][WrFg]::GetWindowText($h, $sb, 256)
$proc = Get-Process -Id $p -ErrorAction SilentlyContinue
if ($proc) { Write-Output $proc.ProcessName; Write-Output $sb.ToString() }
`

async function winFrontmost(): Promise<AppContext | undefined> {
  try {
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], 800)
    const [name, title] = out.split(/\r?\n/)
    if (name?.trim()) {
      const ctx: AppContext = { name: name.trim() }
      if (title?.trim()) ctx.window_title = title.trim()
      return ctx
    }
  } catch {
    /* ignore */
  }
  return undefined
}

export async function getFrontmostApp(): Promise<AppContext | undefined> {
  const now = Date.now()
  if (cache && now - cache.at < CACHE_MS) return cache.value
  let value: AppContext | undefined
  try {
    if (process.platform === 'darwin') value = await macFrontmost()
    else if (process.platform === 'win32') value = await winFrontmost()
  } catch {
    value = undefined
  }
  cache = { at: Date.now(), value }
  return value
}
