/**
 * OMERTA - Web Preload Bridge
 * Replaces Electron's contextBridge with HTTP/WebSocket calls.
 * Injected as a <script> in index.html when running in web mode.
 */
;(function() {
  const BASE = window.location.origin
  let ws = null
  let wsReady = false
  let pendingMessages = []
  let callbackMap = {}
  let callId = 0
  const eventListeners = {}

  // ── WebSocket connection ────────────────────────────────────────────────
  function connectWS() {
    ws = new WebSocket(BASE.replace('http','ws'))
    ws.onopen = () => {
      wsReady = true
      pendingMessages.forEach(m => ws.send(m))
      pendingMessages = []
    }
    ws.onmessage = evt => {
      try {
        const data = JSON.parse(evt.data)
        // Event broadcast from server
        if (data.event) {
          ;(eventListeners[data.event] || []).forEach(fn => fn(data.data))
          return
        }
        // Response to a call
        if (data.id && callbackMap[data.id]) {
          callbackMap[data.id](data.error ? null : data.result, data.error)
          delete callbackMap[data.id]
        }
      } catch {}
    }
    ws.onclose = () => {
      wsReady = false
      setTimeout(connectWS, 2000)
    }
    ws.onerror = () => ws.close()
  }
  connectWS()

  // ── Core invoke function ───────────────────────────────────────────────
  async function invoke(channel, args) {
    try {
      const res = await fetch(`${BASE}/api/${channel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      })
      return res.json()
    } catch(e) {
      return { error: e.message }
    }
  }

  // ── Event system ───────────────────────────────────────────────────────
  function on(event, fn) {
    if (!eventListeners[event]) eventListeners[event] = []
    eventListeners[event].push(fn)
    return () => { eventListeners[event] = eventListeners[event].filter(f => f !== fn) }
  }

  // ── Build the ft namespace (mirrors Electron contextBridge) ────────────
  const ft = {
    on,
    openUrl: url => window.open(url, '_blank'),

    device: {
      list:       a => invoke('device:list', a),
      info:       a => invoke('device:info', a),
      screenshot: a => invoke('device:screenshot', a),
    },
    adb: {
      version:   () => invoke('adb:version'),
      shell:      a => invoke('adb:shell', a),
      reboot:     a => invoke('adb:reboot', a || {}),
      push:       a => invoke('adb:push', a),
      pull:       a => invoke('adb:pull', a),
    },
    quick: {
      battery:    a => invoke('quick:battery', a),
      screenshot: a => invoke('quick:screenshot', a),
      reboot:     a => invoke('quick:reboot', a),
      wifiToggle: a => invoke('quick:wifi-toggle', a),
      airplane:   a => invoke('quick:airplane', a),
      brightness: a => invoke('quick:brightness', a),
      volume:     a => invoke('quick:volume', a),
      lock:       a => invoke('quick:lock', a),
      home:       a => invoke('quick:home', a),
      back:       a => invoke('quick:back', a),
      wake:       a => invoke('quick:wake', a),
    },
    fastboot: {
      devices:   () => invoke('fastboot:devices'),
      reboot:     a => invoke('fastboot:reboot', a),
      getvar:     a => invoke('fastboot:getvar', a),
    },
    discover: {
      usbDevices: () => invoke('discover:usb-devices'),
      fastboot:   () => invoke('discover:fastboot-devices'),
      networkScan:a => invoke('discover:network-scan', a),
      enableAdb:  a => invoke('discover:enable-adb', a),
      connectWifi:a => invoke('discover:adb-connect-wifi', a),
    },
    android: {
      screenrecord: {
        start: a => invoke('android:screenrecord:start', a),
        stop:  a => invoke('android:screenrecord:stop', a),
      },
      input: {
        tap:      a => invoke('android:input:tap', a),
        swipe:    a => invoke('android:input:swipe', a),
        text:     a => invoke('android:input:text', a),
        keyevent: a => invoke('android:input:keyevent', a),
      },
      dumpsys: {
        battery:  a => invoke('android:dumpsys:battery', a),
        activity: a => invoke('android:dumpsys:activity', a),
        meminfo:  a => invoke('android:dumpsys:meminfo', a),
        window:   a => invoke('android:dumpsys:window', a),
      },
      info: {
        imei:    a => invoke('android:info:imei', a),
        sensors: a => invoke('android:info:sensors', a),
        cpuTemp: a => invoke('android:info:cpu-temp', a),
      },
      pm: {
        list:      a => invoke('android:pm:list', a),
        clearData: a => invoke('android:pm:clear-data', a),
        forceStop: a => invoke('android:pm:force-stop', a),
        disable:   a => invoke('android:pm:disable', a),
        enable:    a => invoke('android:pm:enable', a),
        grantAll:  a => invoke('android:pm:grant-all', a),
      },
      net: {
        ping:       a => invoke('android:net:ping', a),
        traceroute: a => invoke('android:net:traceroute', a),
        ports:      a => invoke('android:net:ports', a),
        arp:        a => invoke('android:net:arp', a),
        ipInfo:     a => invoke('android:net:ip-info', a),
      },
      settings: {
        get:  a => invoke('android:settings:get', a),
        set:  a => invoke('android:settings:set', a),
        list: a => invoke('android:settings:list', a),
      },
      dev: {
        overdraw:     a => invoke('android:dev:overdraw', a),
        layoutBounds: a => invoke('android:dev:layout-bounds', a),
        gpuRendering: a => invoke('android:dev:gpu-rendering', a),
        animScale:    a => invoke('android:dev:animator-scale', a),
        showTaps:     a => invoke('android:dev:show-taps', a),
      },
      a11y: {
        fontScale:   a => invoke('android:a11y:font-scale', a),
        displaySize: a => invoke('android:a11y:display-size', a),
        talkback:    a => invoke('android:a11y:talkback', a),
      },
      storage:   a => invoke('android:storage:usage', a),
      apk: { pull: a => invoke('android:apk:pull', a) },
    },
    ios: {
      listDevices: a => invoke('ios:list-devices', a),
      getInfo:     a => invoke('ios:get-info', a),
    },
    iosCustom: {
      shsh: {
        save:       a => invoke('ios:shsh:save', a),
        list:       () => invoke('ios:shsh:list'),
        openFolder: () => invoke('ios:shsh:open-folder'),
      },
      ipsw: {
        fetchVersions:  a => invoke('ios:ipsw:fetch-versions', a),
        download:       a => invoke('ios:ipsw:download', a),
        extractRamdisk: a => invoke('ios:ipsw:extract-ramdisk', a),
      },
      cydia: {
        search:      a => invoke('ios:cydia:search', a),
        installRepo: a => invoke('ios:cydia:install-repo', a),
      },
      bootargs:     a => invoke('ios:bootargs:get', a),
      tweaks:       () => invoke('ios:tweaks:list'),
      themeSources: () => invoke('ios:theme:sources'),
      signedCheck:  a => invoke('ios:signed:check', a),
    },
    iosExt: {
      apps: {
        detail:     a => invoke('ios:apps:detail', a),
        backupData: a => invoke('ios:apps:backup-data', a),
        installIpa: a => invoke('ios:apps:install-ipa', a),
      },
      sysinfo:    a => invoke('ios:sysinfo:deep', a),
      syslog: {
        start:  a => invoke('ios:syslog:start', a),
        stop:   () => invoke('ios:syslog:stop'),
      },
      activation: a => invoke('ios:activation:status', a),
      photos:     a => invoke('ios:photos:pull', a),
      contacts:   a => invoke('ios:contacts:export', a),
      profiles: {
        list:   a => invoke('ios:profiles:list', a),
        remove: a => invoke('ios:profiles:remove', a),
      },
      certs:      a => invoke('ios:certs:list', a),
      icloud:     () => invoke('ios:icloud:bypass-info'),
      ssh: {
        connect:     a  => invoke('ios:ssh:connect', a),
        disconnect:  () => invoke('ios:ssh:disconnect'),
        openTerminal:() => invoke('ios:ssh:open-terminal'),
      },
      frida: {
        check:    a => invoke('ios:frida:server-check', a),
        listApps: a => invoke('ios:frida:list-apps', a),
        trace:    a => invoke('ios:frida:trace', a),
      },
      plist:      a => invoke('ios:plist:read-device', a),
      net:        a => invoke('ios:net:wifi-list', a),
      power: {
        sleep:    a => invoke('ios:power:sleep', a),
        restart:  a => invoke('ios:power:restart', a),
        shutdown: a => invoke('ios:power:shutdown', a),
      },
      screenshot: {
        take:       a  => invoke('ios:screenshot:take', a),
        openFolder: () => invoke('ios:screenshot:open-folder'),
      },
    },
    iosExtra: {
      crash: {
        list:       a  => invoke('ios:crash:list', a),
        openFolder: () => invoke('ios:crash:open-folder'),
      },
      device: {
        getDate:  a => invoke('ios:device:get-date', a),
        setDate:  a => invoke('ios:device:set-date', a),
        getName:  a => invoke('ios:device:get-name', a),
        setName:  a => invoke('ios:device:set-name', a),
      },
      notif:    a => invoke('ios:notif:list', a),
      location: a => invoke('ios:location:spoof', a),
      trollstore: {
        check:   a  => invoke('ios:trollstore:check', a),
        install: a  => invoke('ios:trollstore:install', a),
      },
      devMode:   () => invoke('ios:devmode:enable'),
      entitlements: a => invoke('ios:entitlements:get', a),
      passcode:  () => invoke('ios:passcode:bypass-methods'),
      altstore:  () => invoke('ios:altstore:check-status'),
      diag:      a  => invoke('ios:diag:mobilegestalt', a),
      backup: {
        setEncryption: a => invoke('ios:backup:set-encryption', a),
        restore:       a => invoke('ios:backup:restore', a),
      },
    },
    iosErase: {
      viaBackupTool:  a  => invoke('ios:erase:via-backup-tool', a),
      enterRecovery:  a  => invoke('ios:erase:enter-recovery-for-restore', a),
      openItunes:     () => invoke('ios:erase:open-itunes'),
      dfuGuide:       () => invoke('ios:erase:dfu-guide'),
    },
    nand: {
      android: {
        listPartitions:  a => invoke('nand:android:list-partitions', a),
        readPartition:   a => invoke('nand:android:read-partition', a),
        flashPartition:  a => invoke('nand:android:flash-partition', a),
        ramdiskExtract:  a => invoke('nand:android:ramdisk-extract', a),
        ramdiskRepack:   a => invoke('nand:android:ramdisk-repack', a),
        openWorkdir:    () => invoke('nand:android:open-workdir'),
        openPartitions: () => invoke('nand:android:open-partitions'),
      },
      ios: {
        ramdiskInfo:   () => invoke('nand:ios:ramdisk-info'),
        enterRecovery:  a => invoke('nand:ios:enter-recovery', a),
        exitRecovery:   a => invoke('nand:ios:exit-recovery', a),
        backupFull:     a => invoke('nand:ios:backup-full', a),
      },
    },
    jailbreak: {
      detectDevice:      ()  => invoke('jailbreak:detect-device'),
      downloadCheckn1x:  ()  => invoke('jailbreak:download-checkn1x'),
      flashCheckn1x:     a  => invoke('jailbreak:flash-checkn1x', a),
      openFolder:        ()  => invoke('jailbreak:open-folder'),
      dfuHelp:           a  => invoke('jailbreak:dfu-help', a),
      sideloadIpa:       a  => invoke('jailbreak:sideload-ipa', a),
      magiskPatch:       ()  => invoke('jailbreak:magisk-patch'),
    },
    magisk: {
      modules:    () => invoke('magisk:modules'),
      install:    a  => invoke('magisk:install', a),
      installed:  a  => invoke('magisk:installed', a),
      status:     a  => invoke('magisk:status', a),
    },
    apk:       { analyse: a => invoke('apk:analyse', a) },
    logcat: {
      start:  a => invoke('logcat:start', a),
      stop:   () => invoke('logcat:stop'),
      clear:  a => invoke('logcat:clear', a),
    },
    scrcpy: { launch: a => invoke('scrcpy:launch', a) },
    sqlite: { query: a => invoke('sqlite:query', a) },
    theme: {
      get:    () => invoke('theme:get'),
      set:    a  => invoke('theme:set', a),
      list:   () => invoke('theme:list'),
    },
  }

  // Expose as window.ft
  window.ft = ft

  // Show a banner in web mode
  window.addEventListener('DOMContentLoaded', () => {
    const banner = document.createElement('div')
    banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(74,222,128,0.15);border-top:1px solid rgba(74,222,128,0.3);padding:4px 12px;font-size:11px;color:#4ade80;font-family:monospace;z-index:99999;display:flex;justify-content:space-between;align-items:center;'
    banner.innerHTML = `<span>OMERTA Web Mode — server at ${BASE}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;color:#4ade80;cursor:pointer;font-size:14px;">×</button>`
    document.body.appendChild(banner)
  })

  console.log('[OMERTA] Web bridge loaded — ft namespace ready, server:', BASE)
})()
