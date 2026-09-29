import { useState, useEffect } from 'react'

const ft = window.ft

function Step({ n, text }) {
  return (
    <div style={{ display:"flex", gap:10, marginBottom:8 }}>
      <div style={{ width:24, height:24, borderRadius:"50%", background:"var(--accent)", color:"#000", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, flexShrink:0 }}>{n}</div>
      <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.7, paddingTop:3 }}>{text}</div>
    </div>
  )
}

function MethodCard({ method }) {
  const [open, setOpen] = useState(false)
  const c = method.requiresJailbreak ? "#f59e0b" : method.works ? "#4ade80" : "#888"
  return (
    <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, overflow:"hidden", borderLeft:"3px solid "+c }}>
      <div style={{ padding:"12px 14px", cursor:"pointer", display:"flex", alignItems:"center", gap:12 }} onClick={() => setOpen(o=>!o)}>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
            <span style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>{method.name}</span>
            {method.requiresJailbreak && <span style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"#f59e0b22", color:"#f59e0b", fontWeight:600 }}>Needs jailbreak</span>}
            {!method.requiresJailbreak && method.works && <span style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"#4ade8022", color:"#4ade80", fontWeight:600 }}>No jailbreak</span>}
            {method.tool && <span style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"var(--bg3)", color:"var(--text3)", fontWeight:600 }}>Tool: {method.tool}</span>}
          </div>
          <div style={{ fontSize:12, color:"var(--text3)" }}>{(method.description||"").slice(0,100)}...</div>
        </div>
        <span style={{ color:"var(--text3)", fontSize:16 }}>{open ? "^" : "v"}</span>
      </div>
      {open && (
        <div style={{ borderTop:"1px solid var(--border)", padding:"14px", background:"var(--bg2)" }}>
          <p style={{ fontSize:12, color:"var(--text2)", lineHeight:1.8, margin:"0 0 12px" }}>{method.description}</p>
          <div style={{ fontSize:11, fontWeight:600, color:"var(--text3)", marginBottom:10 }}>STEPS</div>
          {(method.steps||[]).map((s,i) => <Step key={i} n={i+1} text={s} />)}
        </div>
      )}
    </div>
  )
}

export default function iOSUnlock({ device, addLog }) {
  const [tab, setTab] = useState("unlock")
  const [iosVer, setIosVer] = useState("")
  const [methods, setMethods] = useState([])
  const [bypass, setBypass] = useState([])
  const [dfuGuide, setDfuGuide] = useState(null)
  const [activationResult, setActivationResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const udid = device?.udid || device?.serial

  useEffect(() => { ft?.iosUnlock?.bypassMethods().then(setBypass).catch(() => {}) }, [])

  const loadMethods = async () => {
    if (!iosVer) return addLog("Enter iOS version first")
    setLoading(true)
    const m = await ft.iosUnlock.methods({ iosVersion: iosVer, udid }).catch(() => [])
    setMethods(m)
    setLoading(false)
  }

  const loadDfuGuide = async () => {
    const r = await ft.iosUnlock.enterDfu({ udid }).catch(e => ({ error: e.message }))
    setDfuGuide(r)
  }

  const enterRecovery = async () => {
    const r = await ft.iosUnlock.enterRecovery({ udid }).catch(e => ({ error: e.message }))
    addLog(r.success ? "Entering recovery mode..." : r.error || r.note || "Sent")
  }

  const exitRecovery = async () => {
    const r = await ft.iosUnlock.exitRecovery({}).catch(e => ({ error: e.message }))
    addLog(r.success ? "Exiting recovery mode" : r.error || "Failed")
  }

  const checkActivation = async () => {
    setLoading(true)
    const r = await ft.iosUnlock.activationCheck({ udid, serial: device?.serial }).catch(e => ({ error: e.message }))
    setActivationResult(r)
    setLoading(false)
  }

  const TABS = [["unlock","Passcode Bypass"],["bypass","Lock Types"],["modes","DFU / Recovery"],["activation","Activation Lock"]]

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14, padding:"16px 20px", height:"100%", overflowY:"auto", boxSizing:"border-box" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <span style={{ fontSize:24 }}> </span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:19, fontWeight:700, color:"var(--text)" }}>iOS Unlock Tools</div>
          <div style={{ fontSize:12, color:"var(--text3)" }}>Passcode bypass, DFU, recovery mode, activation lock info</div>
        </div>
      </div>

      <div style={{ padding:"10px 14px", background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:8, fontSize:12, color:"var(--text2)", lineHeight:1.7 }}>
        These tools are for devices you own. Bypassing a lock on someone else's device is illegal.
      </div>

      <div style={{ display:"flex", gap:3, background:"var(--bg2)", borderRadius:9, padding:4 }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex:1, padding:"7px 4px", borderRadius:7, fontSize:11, fontWeight:600, cursor:"pointer", background: tab===id ? "var(--accent)" : "transparent", color: tab===id ? "#000" : "var(--text3)", border:"none" }}>{label}</button>
        ))}
      </div>

      {tab === "unlock" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Find Methods for Your iOS Version</div>
            <div style={{ display:"flex", gap:8, marginBottom:8 }}>
              <input value={iosVer} onChange={e => setIosVer(e.target.value)} placeholder="iOS version e.g. 16.5" style={{ flex:1 }} />
              <button onClick={loadMethods} disabled={loading} style={{ padding:"7px 16px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"var(--accent)", color:"#000", border:"none" }}>
                {loading ? "Loading..." : "Find Methods"}
              </button>
            </div>
            {device && <div style={{ fontSize:11, color:"var(--text3)" }}>Connected: {device.model || device.serial}</div>}
          </div>
          {methods.map(m => <MethodCard key={m.id} method={m} />)}
          {!methods.length && !loading && <div style={{ textAlign:"center", padding:30, color:"var(--text3)", fontSize:13 }}>Enter your iOS version above to see available methods</div>}
        </div>
      )}

      {tab === "bypass" && (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {bypass.map((m, i) => (
            <div key={i} style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14, borderLeft:"3px solid " + (m.id==="icloud-bypass-info" ? "#f87171" : "#f59e0b") }}>
              <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
                <span style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>{m.name}</span>
                <span style={{ fontSize:10, padding:"2px 6px", borderRadius:4, background:"var(--bg3)", color:"var(--text3)", fontWeight:600 }}>{m.type}</span>
              </div>
              <p style={{ fontSize:12, color:"var(--text2)", lineHeight:1.8, margin:"0 0 10px" }}>{m.description}</p>
              {(m.steps||[]).map((s,j) => <Step key={j} n={j+1} text={s} />)}
            </div>
          ))}
        </div>
      )}

      {tab === "modes" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <button onClick={loadDfuGuide} style={{ padding:"8px 16px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"var(--bg3)", color:"var(--text)", border:"1px solid var(--border)" }}>Show DFU Guide</button>
            <button onClick={enterRecovery} style={{ padding:"8px 16px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"rgba(96,165,250,0.2)", color:"#60a5fa", border:"1px solid rgba(96,165,250,0.3)" }}>Enter Recovery Mode</button>
            <button onClick={exitRecovery} style={{ padding:"8px 16px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"rgba(74,222,128,0.2)", color:"#4ade80", border:"1px solid rgba(74,222,128,0.3)" }}>Exit Recovery Mode</button>
          </div>
          {dfuGuide && Object.entries(dfuGuide.steps||{}).map(([model, steps]) => (
            <div key={model} style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14 }}>
              <div style={{ fontSize:13, fontWeight:600, marginBottom:10, color:"var(--accent)", textTransform:"capitalize" }}>{model.replace(/_/g," ").replace(/iphone/gi,"iPhone ")}</div>
              {steps.map((s,i) => <Step key={i} n={i+1} text={s} />)}
            </div>
          ))}
          <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Recovery vs DFU</div>
            {[
              ["Recovery Mode","Shows iTunes/Finder logo. Still loads iBoot. For normal restores. Exit: hold Home/Volume Down 10 seconds."],
              ["DFU Mode","Completely dark screen. Bypasses iBoot. Required for downgrades with SHSH blobs, checkm8 jailbreak, and baseband flashing."],
              ["Exit DFU","Hold Power + Home (or Power + Volume Down on iPhone 7+) for 10 seconds until Apple logo appears."],
            ].map(([t,d],i) => (
              <div key={i} style={{ padding:"10px 0", borderBottom:"1px solid var(--border)" }}>
                <div style={{ fontSize:12, fontWeight:600, color:"var(--text)", marginBottom:4 }}>{t}</div>
                <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.6 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "activation" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          <div style={{ background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Check Activation Lock Status</div>
            <button onClick={checkActivation} disabled={loading} style={{ padding:"8px 16px", borderRadius:7, fontSize:12, fontWeight:600, cursor:"pointer", background:"var(--accent)", color:"#000", border:"none", marginBottom:10 }}>
              {loading ? "Checking..." : "Check Connected Device"}
            </button>
            {activationResult && (
              <div style={{ padding:12, borderRadius:8, background: activationResult.locked ? "rgba(248,113,113,0.1)" : "rgba(74,222,128,0.1)", border:"1px solid " + (activationResult.locked ? "rgba(248,113,113,0.3)" : "rgba(74,222,128,0.3)") }}>
                <div style={{ fontSize:14, fontWeight:700, color: activationResult.locked ? "#f87171" : "#4ade80", marginBottom:4 }}>
                  {activationResult.locked ? "Activation Lock: ON" : "Activation Lock: OFF"}
                </div>
                {activationResult.note && <div style={{ fontSize:11, color:"var(--text3)" }}>{activationResult.note}</div>}
              </div>
            )}
          </div>
          <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.2)", borderRadius:10, padding:14 }}>
            <div style={{ fontSize:13, fontWeight:600, color:"#f87171", marginBottom:8 }}>Activation Lock Reality Check</div>
            <div style={{ fontSize:12, color:"var(--text2)", lineHeight:1.8, marginBottom:10 }}>
              iCloud Activation Lock on iOS 12+ with A12+ chips cannot be bypassed by any software. Secure Enclave enforces this at hardware level.
            </div>
            {[
              ["Have the Apple ID credentials","Sign in at iCloud.com and remove device from Find My"],
              ["Contact original owner","They remove via iCloud.com - Find My - Remove Device"],
              ["Apple Support with receipt","Proof of purchase sometimes gets Apple to remove it"],
              ["Pre-A9 devices only","iPhone 5S-6 era has some documented bypasses - extremely limited scope"],
            ].map(([t,d],i) => (
              <div key={i} style={{ display:"flex", gap:8, padding:"6px 0", borderBottom:"1px solid rgba(248,113,113,0.1)" }}>
                <span style={{ color:"var(--accent)", fontWeight:700, flexShrink:0 }}>{i+1}.</span>
                <div style={{ fontSize:12, color:"var(--text2)" }}><strong style={{ color:"var(--text)" }}>{t}: </strong>{d}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
