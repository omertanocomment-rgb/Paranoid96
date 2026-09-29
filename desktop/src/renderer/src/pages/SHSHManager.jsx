import { useState, useEffect } from 'react'

const ft = window.ft

export default function SHSHManager({ device, addLog }) {
  const [savedBlobs, setSavedBlobs] = useState([])
  const [firmwares, setFirmwares] = useState([])
  const [signed, setSigned] = useState([])
  const [model, setModel] = useState("")
  const [udid, setUdid] = useState("")
  const [saving, setSaving] = useState(null)
  const [progress, setProgress] = useState({percent:0, msg:""})
  const [tab, setTab] = useState("save")

  useEffect(() => {
    if (device) {
      setModel(device.model || "")
      setUdid(device.udid || device.serial || "")
    }
    loadSaved()
    const r = ft?.on ? ft.on("shsh:progress", p => setProgress({percent:p.percent||0, msg:p.message||""})) : null
    return () => r && r()
  }, [device])

  const loadSaved = async () => {
    const blobs = await ft?.ios?.shsh?.listSaved().catch(() => []) || []
    setSavedBlobs(blobs)
  }

  const loadFirmwares = async () => {
    if (!model) return addLog("Enter device model first")
    const [all, signedFw] = await Promise.all([
      ft.ios.shsh.getFirmwares({ model }).catch(() => []),
      ft.ios.shsh.getSigned({ model }).catch(() => []),
    ])
    setFirmwares(all)
    setSigned(signedFw)
  }

  const saveBlob = async (fw) => {
    if (!udid) return addLog("Connect a device or enter UDID manually")
    setSaving(fw.buildid)
    setProgress({percent:0, msg:"Starting..."})
    const deviceInfo = { model, ecid: device?.ecid, boardconfig: device?.boardconfig }
    const r = await ft.ios.shsh.save({ udid, deviceInfo, firmwares:[fw] }).catch(e => ({error:e.message}))
    setSaving(null)
    if (r?.error) addLog("SHSH save failed: " + r.error)
    else { addLog("Saved blob for iOS " + fw.version); loadSaved() }
  }

  const saveAllSigned = async () => {
    if (!udid) return addLog("Connect a device or enter UDID")
    if (!signed.length) return addLog("Load firmware list first")
    setSaving("all")
    for (const fw of signed) {
      setProgress({percent:0, msg:"Saving " + fw.version + "..."})
      const deviceInfo = { model, ecid: device?.ecid }
      await ft.ios.shsh.save({ udid, deviceInfo, firmwares:[fw] }).catch(() => {})
    }
    setSaving(null)
    loadSaved()
    addLog("Saved " + signed.length + " SHSH blobs")
  }

  const importBlobs = async () => {
    const r = await ft.ios.shsh.import().catch(e => ({error:e.message}))
    if (!r?.cancelled) { loadSaved(); addLog("Imported " + (r.count||0) + " blobs") }
  }

  const openDir = () => ft.ios.shsh.openDir()

  const TABS = [["save","Save Blobs"],["saved","Saved Blobs"],["guide","Downgrade Guide"]]

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, padding:"16px 20px", height:"100%", overflowY:"auto", boxSizing:"border-box" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:"var(--text)" }}>SHSH Blob Manager</div>
          <div style={{ fontSize:12, color:"var(--text3)" }}>Save SHSH2 blobs to enable iOS downgrading with futurerestore</div>
        </div>
      </div>

      <div style={{ padding:"10px 14px", background:"rgba(96,165,250,0.1)", border:"1px solid rgba(96,165,250,0.2)", borderRadius:8, fontSize:12, color:"var(--text2)", lineHeight:1.7 }}>
        SHSH blobs are cryptographic signatures Apple issues per-device per-firmware. Save them NOW while firmwares are signed -- Apple stops signing old versions quickly. Once saved, use with futurerestore to downgrade.
      </div>

      <div style={{ display:"flex", gap:3, background:"var(--bg2)", borderRadius:9, padding:4 }}>
        {TABS.map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:"8px 6px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:tab===id?"var(--accent)":"transparent", color:tab===id?"#000":"var(--text3)", border:"none" }}>{label}</button>
        ))}
      </div>

      {tab === "save" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Device Info</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:10 }}>
              <div>
                <div style={{ fontSize:11, color:"var(--text3)", marginBottom:4 }}>Model (e.g. iPhone14,2)</div>
                <input value={model} onChange={e => setModel(e.target.value)} placeholder="iPhone14,2" style={{ width:"100%" }} />
              </div>
              <div>
                <div style={{ fontSize:11, color:"var(--text3)", marginBottom:4 }}>UDID (auto from connected device)</div>
                <input value={udid} onChange={e => setUdid(e.target.value)} placeholder="Connected device UDID" style={{ width:"100%" }} />
              </div>
            </div>
            <button onClick={loadFirmwares} style={{ padding:"8px 16px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"var(--bg3)", color:"var(--text)", border:"1px solid var(--border)" }}>
              Load Firmware List from IPSW.me
            </button>
          </div>

          {firmwares.length > 0 && (
            <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <div style={{ fontSize:13, fontWeight:600 }}>Available Firmwares ({firmwares.length})</div>
                <button onClick={saveAllSigned} disabled={!!saving}
                  style={{ padding:"7px 14px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"var(--accent)", color:"#000", border:"none" }}>
                  {saving==="all" ? "Saving all..." : "Save All Currently Signed"}
                </button>
              </div>
              {saving && saving !== "all" && (
                <div style={{ marginBottom:10 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:"var(--text3)", marginBottom:4 }}><span>{progress.msg}</span><span>{progress.percent}%</span></div>
                  <div style={{ background:"var(--bg3)", borderRadius:3, height:4, overflow:"hidden" }}>
                    <div style={{ width:progress.percent+"%", height:"100%", background:"var(--accent)", transition:"width 0.3s" }} />
                  </div>
                </div>
              )}
              <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                {firmwares.map((fw,i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", borderRadius:7, background:"var(--bg2)", border:"1px solid var(--border)" }}>
                    <div style={{ flex:1 }}>
                      <span style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>iOS {fw.version}</span>
                      <span style={{ fontSize:11, color:"var(--text3)", marginLeft:8 }}>{fw.buildid}</span>
                    </div>
                    <span style={{ fontSize:11, padding:"2px 8px", borderRadius:4, fontWeight:600, background: fw.signed ? "#4ade8022" : "#88888822", color: fw.signed ? "#4ade80" : "#666" }}>
                      {fw.signed ? "Signed" : "Not signed"}
                    </span>
                    <button onClick={() => saveBlob(fw)} disabled={!!saving}
                      style={{ padding:"5px 10px", borderRadius:6, fontSize:11, fontWeight:600, cursor: saving ? "not-allowed" : "pointer", background: fw.signed ? "var(--accent)" : "var(--bg3)", color: fw.signed ? "#000" : "var(--text3)", border:"none" }}>
                      {saving===fw.buildid ? "Saving..." : "Save"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "saved" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={loadSaved} style={{ padding:"7px 14px", borderRadius:7, fontSize:12, cursor:"pointer", background:"var(--bg3)", color:"var(--text)", border:"1px solid var(--border)" }}>Refresh</button>
            <button onClick={importBlobs} style={{ padding:"7px 14px", borderRadius:7, fontSize:12, cursor:"pointer", background:"var(--bg3)", color:"var(--text)", border:"1px solid var(--border)" }}>Import .shsh2 files</button>
            <button onClick={openDir} style={{ padding:"7px 14px", borderRadius:7, fontSize:12, cursor:"pointer", background:"var(--bg3)", color:"var(--text3)", border:"1px solid var(--border)" }}>Open Folder</button>
            <span style={{ display:"flex", alignItems:"center", fontSize:11, color:"var(--text3)", marginLeft:"auto" }}>{savedBlobs.length} blobs saved</span>
          </div>
          {savedBlobs.length ? savedBlobs.map((b,i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:8 }}>
              <span style={{ fontSize:20 }}> </span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:600, color:"var(--text)" }}>iOS {b.version} {b.build ? "("+b.build+")" : ""}</div>
                <div style={{ fontSize:11, color:"var(--text3)", fontFamily:"monospace" }}>{b.model} - {b.filename}</div>
              </div>
            </div>
          )) : (
            <div style={{ textAlign:"center", padding:40, color:"var(--text3)", fontSize:13 }}>No saved blobs yet. Go to Save Blobs tab to download them.</div>
          )}
        </div>
      )}

      {tab === "guide" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {[
            { title:"What are SHSH blobs?", body:"SHSH2 blobs are device-specific cryptographic tickets Apple signs when you restore iOS. They contain your device ECID (unique ID) and the firmware hash. When Apple stops signing a version, these saved blobs let you restore to it using futurerestore." },
            { title:"Step 1 - Save blobs NOW", body:"Apple typically stops signing an iOS version 2-4 weeks after the next version is released. Go to the Save Blobs tab, enter your model, and save all currently signed versions. You cannot save blobs for versions Apple has already stopped signing." },
            { title:"Step 2 - Download the IPSW", body:"Download the IPSW for the version you want from ipsw.me. Keep the blob and IPSW together." },
            { title:"Step 3 - Use futurerestore", body:"futurerestore (github.com/futurerestore/futurerestore) combines your saved blob with the IPSW to restore. Command: futurerestore -t <blob.shsh2> --latest-baseband <firmware.ipsw>. Requires the device to be in DFU mode." },
            { title:"Important limitations", body:"Blob restores only work on A9 and older chips (iPhone 6S and earlier) due to the SEP and baseband version requirements. On A10+ devices, futurerestore requires matching SEP and baseband -- making downgrades very difficult. A12+ devices cannot be downgraded at all." },
          ].map(({title, body}, i) => (
            <div key={i} style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14, borderLeft:"3px solid var(--accent)" }}>
              <div style={{ fontSize:13, fontWeight:600, color:"var(--accent)", marginBottom:8 }}>{title}</div>
              <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.8 }}>{body}</div>
            </div>
          ))}
          <div style={{ padding:12, background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:8 }}>
            <div style={{ fontSize:12, fontWeight:600, color:"#4ade80", marginBottom:4 }}>Recommended blob savers</div>
            <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.7 }}>
              This tool uses tsschecker. Also worth using: Shelly (iOS app), TSSSaver (web: tsssaver.1conan.com), or blobsaver (desktop app). Save from multiple sources for safety.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
