// bootloader-multichipset-ipc.js
// Multi-chipset bootloader identify/unlock/flash toolkit -- Unisoc, MediaTek,
// Qualcomm, Samsung/Exynos, and generic AOSP fastboot, mirroring the RootForge /
// omerta-bootloader-toolkit projects' identify.sh + master.sh flow.
import { app } from 'electron'
import { join } from 'path'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs-extra'

const execFileAsync = promisify(execFile)

function binDir() {
  return app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
}
function tool(name) {
  return join(binDir(), name)
}

const CHIPSETS = [
  {
    id: 'unisoc', label: 'Unisoc (SPD)', color: '#f97316',
    detectHint: 'fastboot getvar all | grep -i spreadtrum, or lsusb 1782:4d00',
    steps: [
      'Boot device to Download Mode (usually Vol Up+Down while plugging USB)',
      'Identify with SPD Research Tool / spd_dump over the diag port',
      'Read partition table (PAC) before any write',
      'Flash via SPD Flash Tool or open-source spd_dump write path',
    ],
  },
  {
    id: 'mediatek', label: 'MediaTek (MTK)', color: '#22c55e',
    detectHint: 'lsusb 0e8d:0003 (BROM) or 0e8d:2000 (Preloader)',
    steps: [
      'Boot to BROM/Preloader mode (battery out or test point short, per model)',
      'Identify SoC + auth state with mtkclient (python mtk)',
      'Dump preloader/boot/scatter before any write, verify against stock',
      'Unlock/flash via mtkclient payload (da_x.bin) once verified',
    ],
  },
  {
    id: 'qualcomm', label: 'Qualcomm (QCOM)', color: '#3b82f6',
    detectHint: 'lsusb 05c6:9008 (EDL / Sahara/Firehose)',
    steps: [
      'Boot to EDL 9008 mode (test point, key combo, or edl adb command)',
      'Identify with Firehose loader + qc_edl or QFIL',
      'Dump GPT + critical partitions before any write',
      'Flash raw programmer/firehose XML per model',
    ],
  },
  {
    id: 'exynos', label: 'Samsung / Exynos (Odin)', color: '#a855f7',
    detectHint: 'lsusb 04e8:685d (Download mode) - heimdall list',
    steps: [
      'Boot to Download Mode (Vol Down+Bixby+Power on most models)',
      'Identify with heimdall detect (open-source Odin-protocol client)',
      'Extract PIT + validate against stock firmware CSC/model',
      'Flash AP/BL/CP/CSC tars via heimdall flash --<partition> <file>',
    ],
  },
  {
    id: 'aosp', label: 'Generic AOSP (fastboot)', color: '#94a3b8',
    detectHint: 'fastboot devices',
    steps: [
      'adb reboot bootloader, confirm with fastboot devices',
      'fastboot getvar all to read unlock/security state',
      'fastboot flashing unlock (wipes data on most OEMs)',
      'Flash partitions individually or via fastboot flashall',
    ],
  },
]

export function registerBootloaderMultichipsetHandlers(ipcMain, dialog, shell, mainWindow) {
  ipcMain.handle('blt:chipsets:list', () => CHIPSETS)

  ipcMain.handle('blt:detect', async () => {
    const results = []
    // fastboot (AOSP + often works for many OEM bootloader modes too)
    try {
      const { stdout } = await execFileAsync(tool(process.platform === 'win32' ? 'fastboot.exe' : 'fastboot'), ['devices'])
      const lines = stdout.trim().split('\n').filter(Boolean)
      for (const l of lines) {
        const [serial] = l.trim().split(/\s+/)
        results.push({ chipset: 'aosp', mode: 'fastboot', serial })
      }
    } catch {}
    // lsusb-based heuristic detection for EDL / BROM / Download / SPD modes (Linux/Mac only)
    if (process.platform !== 'win32') {
      try {
        const { stdout } = await execFileAsync('lsusb', [])
        const map = [
          [/05c6:9008/i, 'qualcomm', 'EDL 9008'],
          [/0e8d:0003/i, 'mediatek', 'BROM'],
          [/0e8d:2000/i, 'mediatek', 'Preloader'],
          [/1782:4d00/i, 'unisoc', 'Download'],
          [/04e8:685d/i, 'exynos', 'Odin Download'],
        ]
        for (const line of stdout.split('\n')) {
          for (const [re, chipset, mode] of map) {
            if (re.test(line)) results.push({ chipset, mode, raw: line.trim() })
          }
        }
      } catch {}
    }
    return results
  })

  ipcMain.handle('blt:fastboot:getvar-all', async () => {
    try {
      const { stdout, stderr } = await execFileAsync(tool(process.platform === 'win32' ? 'fastboot.exe' : 'fastboot'), ['getvar', 'all'])
      return { ok: true, output: (stdout || '') + (stderr || '') }
    } catch (e) { return { ok: false, error: e.stderr || e.message } }
  })

  ipcMain.handle('blt:fastboot:unlock', async (e, { confirm }) => {
    if (!confirm) throw new Error('Confirmation required - this typically wipes user data')
    try {
      const { stdout, stderr } = await execFileAsync(tool(process.platform === 'win32' ? 'fastboot.exe' : 'fastboot'), ['flashing', 'unlock'])
      return { ok: true, output: (stdout || '') + (stderr || '') }
    } catch (e) { return { ok: false, error: e.stderr || e.message } }
  })

  ipcMain.handle('blt:fastboot:flash', async (e, { partition, confirm }) => {
    if (!confirm) throw new Error('Confirmation required')
    const { filePaths } = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] })
    if (!filePaths?.length) return { ok: false, cancelled: true }
    try {
      const { stdout, stderr } = await execFileAsync(
        tool(process.platform === 'win32' ? 'fastboot.exe' : 'fastboot'),
        ['flash', partition, filePaths[0]],
        { timeout: 180000 }
      )
      return { ok: true, output: (stdout || '') + (stderr || ''), file: filePaths[0] }
    } catch (e) { return { ok: false, error: e.stderr || e.message } }
  })

  // heimdall passthrough (Samsung/Exynos) - only runs if heimdall is present in bin/
  ipcMain.handle('blt:heimdall:detect', async () => {
    try {
      const { stdout } = await execFileAsync(tool('heimdall'), ['detect'])
      return { ok: true, output: stdout }
    } catch (e) { return { ok: false, error: e.stderr || e.message || 'heimdall not found in bin/ - see repo: https://github.com/Benjamin-Dobell/Heimdall' } }
  })

  ipcMain.handle('blt:heimdall:print-pit', async () => {
    try {
      const outDir = join(app.getPath('userData'), 'bootloader_work')
      fs.ensureDirSync(outDir)
      const outFile = join(outDir, `pit_${Date.now()}.pit`)
      const { stdout } = await execFileAsync(tool('heimdall'), ['print-pit', '--output', outFile])
      return { ok: true, output: stdout, file: outFile }
    } catch (e) { return { ok: false, error: e.stderr || e.message } }
  })

  // mtkclient passthrough (MediaTek) - invoked via python if present
  ipcMain.handle('blt:mtk:run', async (e, { args }) => {
    return new Promise((resolve) => {
      const proc = spawn('python3', ['-m', 'mtkclient.mtk', ...(args || ['printgpt'])], { cwd: binDir() })
      let out = ''
      proc.stdout.on('data', d => out += d.toString())
      proc.stderr.on('data', d => out += d.toString())
      proc.on('close', (code) => resolve({ ok: code === 0, output: out, code }))
      proc.on('error', (err) => resolve({ ok: false, error: err.message + ' - install mtkclient: pip install mtkclient' }))
    })
  })
}
