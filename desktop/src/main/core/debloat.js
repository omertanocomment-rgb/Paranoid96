import { join } from 'path'
import { app } from 'electron'
import { spawn } from 'child_process'

function bin(name) {
  const base = app.isPackaged ? join(process.resourcesPath, 'bin') : join(process.cwd(), 'bin')
  return join(base, process.platform === 'win32' ? name + '.exe' : name)
}

const PRESETS = {
  samsung: {
    name: 'Samsung One UI',
    logo: 'samsung',
    categories: {
      'Bixby & AI': [
        'com.samsung.android.bixby.agent', 'com.samsung.android.bixby.wakeup',
        'com.samsung.android.app.spage', 'com.samsung.android.bixby.service',
        'com.samsung.android.bixby.voiceinput', 'com.samsung.android.bixbyvision.framework'
      ],
      'Samsung Apps (Duplicates)': [
        'com.samsung.android.email.provider', 'com.sec.android.app.myfiles',
        'com.samsung.android.calendar', 'com.samsung.android.contacts',
        'com.samsung.android.messaging', 'com.samsung.android.app.notes',
        'com.samsung.android.app.watchmanagermobile'
      ],
      'Samsung Pay & Wallet': [
        'com.samsung.android.spay', 'com.samsung.android.samsungpay.gear',
        'com.samsung.android.samsung.pay.provisioning'
      ],
      'Samsung Account & Cloud': [
        'com.samsung.android.scloud', 'com.samsung.android.backuptext',
        'com.samsung.android.samsungaccount.half'
      ],
      'Carrier Bloat (Generic)': [
        'com.samsung.android.app.tv.mediaprovider', 'com.netflix.mediaclient',
        'com.facebook.katana', 'com.facebook.services', 'com.facebook.system',
        'com.facebook.appmanager', 'com.microsoft.teams', 'com.linkedin.android'
      ],
      'Samsung Kids & Extras': [
        'com.samsung.android.kidsinstaller', 'com.samsung.android.app.taskedge',
        'com.samsung.android.themestore', 'com.samsung.android.game.gos',
        'com.samsung.android.game.gametools', 'com.samsung.android.game.gamehome'
      ]
    }
  },
  xiaomi: {
    name: 'Xiaomi MIUI / HyperOS',
    logo: 'xiaomi',
    categories: {
      'Mi Apps (Duplicates)': [
        'com.miui.weather2', 'com.mi.globalbrowser', 'com.miui.videoplayer',
        'com.miui.player', 'com.miui.calculator', 'com.miui.compass',
        'com.miui.cleanmaster', 'com.miui.msa.global', 'com.xiaomi.midrop'
      ],
      'Ads & Analytics': [
        'com.miui.analytics', 'com.xiaomi.mistatistic', 'com.miui.daemon',
        'com.miui.systemAdSolution', 'com.miui.hybrid', 'com.miui.hybrid.accessory',
        'com.xiaomi.payment', 'com.mipay.wallet.in', 'com.mipay.wallet.id'
      ],
      'GetApps & Recommendations': [
        'com.xiaomi.market', 'com.miui.bugreport', 'com.miui.miservice',
        'com.xiaomi.gamecenter.sdk.service', 'com.miui.newmidrive'
      ],
      'Social (Preinstalled)': [
        'com.facebook.katana', 'com.facebook.services', 'com.twitter.android.lite',
        'com.tiktok.tv', 'com.netflix.mediaclient'
      ]
    }
  },
  oneplus: {
    name: 'OnePlus OxygenOS',
    logo: 'oneplus',
    categories: {
      'OnePlus Apps': [
        'com.oneplus.account', 'com.oneplus.gallery', 'com.oneplus.weather',
        'com.oneplus.filemanager', 'com.oneplus.music', 'com.oneplus.notes',
        'com.oneplus.bugreport', 'com.oneplus.shelf'
      ],
      'OPPO / Ads': [
        'com.coloros.safecenter', 'com.coloros.phonemanager',
        'com.oplus.appmarket', 'com.oplus.statistics.rom'
      ],
      'Social': [
        'com.facebook.katana', 'com.facebook.services', 'com.netflix.mediaclient',
        'com.booking', 'com.linkedin.android'
      ]
    }
  },
  motorola: {
    name: 'Motorola',
    logo: 'motorola',
    categories: {
      'Moto Apps': [
        'com.motorola.motodisplay', 'com.motorola.camera2', 'com.motorola.irblaster',
        'com.motorola.motocare', 'com.motorola.myaccount', 'com.motorola.brapps'
      ],
      'Social & Preinstalled': [
        'com.facebook.katana', 'com.facebook.services', 'com.facebook.system',
        'com.facebook.appmanager', 'com.netflix.mediaclient', 'com.amazon.mShop.android.shopping'
      ]
    }
  },
  google: {
    name: 'Google Pixel',
    logo: 'google',
    categories: {
      'Google Apps (Optional)': [
        'com.google.android.youtube', 'com.google.android.apps.youtube.music',
        'com.google.android.videos', 'com.google.android.keep',
        'com.google.android.apps.maps', 'com.google.android.apps.docs',
        'com.google.android.apps.photos', 'com.google.android.feedback'
      ],
      'Google Assistant & AI': [
        'com.google.android.googlequicksearchbox', 'com.google.android.apps.assistant',
        'com.google.android.apps.googleassistant'
      ]
    }
  },
  generic: {
    name: 'Generic Bloat (All Brands)',
    logo: 'generic',
    categories: {
      'Facebook Suite': [
        'com.facebook.katana', 'com.facebook.orca', 'com.facebook.lite',
        'com.facebook.services', 'com.facebook.system', 'com.facebook.appmanager',
        'com.instagram.android', 'com.whatsapp'
      ],
      'Microsoft Bloat': [
        'com.microsoft.office.outlook', 'com.microsoft.office.excel',
        'com.microsoft.office.word', 'com.microsoft.teams', 'com.microsoft.skydrive',
        'com.skype.raider', 'com.microsoft.launcher'
      ],
      'Amazon': [
        'com.amazon.mShop.android.shopping', 'com.amazon.appmanager', 'com.amazon.kindle'
      ],
      'OEM Services': [
        'com.netflix.mediaclient', 'com.booking', 'com.linkedin.android',
        'com.opera.browser', 'com.gameloft.android.ANMP'
      ]
    }
  }
}

export default class DebloatCore {
  getPresets() {
    return Object.entries(PRESETS).map(([id, preset]) => ({
      id, name: preset.name, logo: preset.logo,
      categories: Object.entries(preset.categories).map(([name, packages]) => ({
        name, packages, count: packages.length
      })),
      totalPackages: Object.values(preset.categories).flat().length
    }))
  }

  async scanDevice(serial) {
    const allPackages = Object.values(PRESETS).flatMap(p => Object.values(p.categories).flat())
    const found = []
    const batchSize = 20
    for (let i = 0; i < allPackages.length; i += batchSize) {
      const batch = allPackages.slice(i, i + batchSize)
      const cmd = batch.map(pkg => `pm list packages ${pkg}`).join(' && ')
      try {
        const result = await new Promise((res) => {
          const proc = spawn(bin('adb'), ['-s', serial, 'shell', cmd])
          let out = ''
          proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out))
        })
        const presentPkgs = batch.filter(pkg => result.includes(pkg))
        found.push(...presentPkgs)
      } catch {}
    }
    return found.map(pkg => {
      for (const [brandId, preset] of Object.entries(PRESETS)) {
        for (const [catName, pkgs] of Object.entries(preset.categories)) {
          if (pkgs.includes(pkg)) return { pkg, brand: preset.name, category: catName }
        }
      }
      return { pkg, brand: 'Unknown', category: 'Other' }
    })
  }

  async applyList(serial, packages, action = 'disable', onProgress) {
    const results = []
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i]
      onProgress?.({ percent: Math.round(i / packages.length * 100), message: `${action}: ${pkg}` })
      try {
        let cmd
        if (action === 'disable') cmd = `pm disable-user --user 0 ${pkg}`
        else if (action === 'uninstall') cmd = `pm uninstall --user 0 ${pkg}`
        else if (action === 'enable') cmd = `pm enable ${pkg}`
        const result = await new Promise((res) => {
          const proc = spawn(bin('adb'), ['-s', serial, 'shell', cmd])
          let out = ''
          proc.stdout.on('data', d => out += d)

      proc.on('error', e => { console.error('[Omerta] spawn error:', e.message) })
      proc.on('close', () => res(out.trim()))
        })
        results.push({ pkg, success: true, result })
      } catch (e) {
        results.push({ pkg, success: false, error: e.message })
      }
    }
    return results
  }
}
