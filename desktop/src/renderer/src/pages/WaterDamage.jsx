import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Tag } from './_shared.jsx'


export default function WaterDamage({ addLog }) {
  const [guide, setGuide] = useState(null)
  const [activeStep, setActiveStep] = useState(0)
  const [tab, setTab] = useState('steps')

  useEffect(() => {
    ft.waterdamage.guide().then(setGuide).catch(() => {})
  }, [])

  if (!guide) return (
    <PageWrap>
      <PageHeader title="Water Damage Recovery" icon=" " sub="Step-by-step recovery guide" />
      <div style={{ color:'var(--text3)', fontSize:13 }}>Loading guide...</div>
    </PageWrap>
  )

  const steps = guide.immediateSteps || []
  const checklist = guide.repairChecklist || []
  const successRate = guide.successRate || {}

  return (
    <PageWrap>
      <PageHeader title="Water Damage Recovery" icon=" " sub="Act fast -- every second counts" />

      {/* Tabs */}
      <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, width:'fit-content' }}>
        {[['steps','  Immediate Steps'],['checklist','  Repair Checklist'],['stats','  Success Rates']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
            background: tab===id ? 'var(--bg4)' : 'none',
            color: tab===id ? 'var(--text)' : 'var(--text3)',
            border: tab===id ? '1px solid var(--border)' : '1px solid transparent'
          }}>{label}</button>
        ))}
      </div>

      {tab === 'steps' && (
        <div style={{ display:'flex', gap:14, flex:1, overflow:'hidden', minHeight:400 }}>
          {/* Step list */}
          <div style={{ width:200, flexShrink:0, display:'flex', flexDirection:'column', gap:3, overflowY:'auto' }}>
            {steps.map((s, i) => (
              <button key={i} onClick={() => setActiveStep(i)} style={{
                padding:'8px 10px', borderRadius:7, textAlign:'left', cursor:'pointer', fontSize:11,
                background: activeStep===i ? 'var(--accent-dim)' : s.critical ? 'var(--red-dim)' : 'var(--bg2)',
                border: `1px solid ${activeStep===i ? 'var(--accent-border)' : s.critical ? 'rgba(248,113,113,0.2)' : 'var(--border)'}`,
                color: activeStep===i ? 'var(--accent)' : 'var(--text2)'
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                  <span style={{ fontWeight:700, color: s.critical ? 'var(--red)' : 'var(--text3)', fontSize:11 }}>{s.step}</span>
                  {s.critical && <span style={{ fontSize:9, color:'var(--red)', fontWeight:700 }}>CRITICAL</span>}
                </div>
                <div style={{ fontSize:11, fontWeight:500 }}>{s.action}</div>
                <div style={{ fontSize:10, color:'var(--text3)', marginTop:1 }}>{s.time}</div>
              </button>
            ))}
          </div>

          {/* Step detail */}
          {steps[activeStep] && (
            <div style={{ flex:1, overflow:'hidden' }}>
              <div className="card" style={{ height:'100%', display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background: steps[activeStep].critical ? 'var(--red-dim)' : 'var(--accent-dim)', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:14, color: steps[activeStep].critical ? 'var(--red)' : 'var(--accent)', flexShrink:0 }}>
                    {steps[activeStep].step}
                  </div>
                  <div>
                    <div style={{ fontSize:15, fontWeight:600, color:'var(--text)' }}>{steps[activeStep].action}</div>
                    <div style={{ fontSize:12, color:'var(--text3)', marginTop:2 }}>{steps[activeStep].time}</div>
                  </div>
                  {steps[activeStep].critical && <Tag color="red">CRITICAL</Tag>}
                </div>
                <div style={{ fontSize:13, color:'var(--text2)', lineHeight:1.8, flex:1 }}>
                  {steps[activeStep].detail}
                </div>
                <div style={{ display:'flex', gap:8 }}>
                  {activeStep > 0 && <button className="btn btn-sm" onClick={() => setActiveStep(s => s - 1)}>  Previous</button>}
                  {activeStep < steps.length - 1 && <button className="btn btn-primary btn-sm" onClick={() => setActiveStep(s => s + 1)}>Next Step  </button>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'checklist' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {checklist.map((item, i) => (
            <div key={i} className="card">
              <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:600, color:'var(--text)', marginBottom:4 }}>{item.component}</div>
                  <div style={{ fontSize:12, color:'var(--text3)', marginBottom:6 }}>
                    <span style={{ fontWeight:500, color:'var(--text2)' }}>Symptoms: </span>{item.symptoms}
                  </div>
                  <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.6 }}>
                    <span style={{ fontWeight:500 }}>Fix: </span>{item.fix}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'stats' && (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <div className="card" style={{ background:'var(--blue-dim)', border:'1px solid var(--blue-border)', marginBottom:4 }}>
            <div style={{ fontSize:13, fontWeight:600, color:'var(--blue)', marginBottom:4 }}>Recovery success rates</div>
            <div style={{ fontSize:12, color:'var(--text2)' }}>Based on devices powered off within 30 seconds of water exposure.</div>
          </div>
          {Object.entries(successRate).map(([type, rate]) => {
            const pct = parseInt(rate)
            const label = type.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
            const color = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--accent)' : 'var(--red)'
            return (
              <div key={type} className="card" style={{ padding:'12px 16px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                  <span style={{ fontSize:13, fontWeight:500 }}>{label}</span>
                  <span style={{ fontSize:14, fontWeight:700, color }}>{rate.split('%')[0]}%</span>
                </div>
                <div style={{ background:'var(--bg3)', borderRadius:2, height:6, overflow:'hidden' }}>
                  <div style={{ width:pct + '%', height:'100%', background:color, borderRadius:2, transition:'width 0.5s' }} />
                </div>
                <div style={{ fontSize:11, color:'var(--text3)', marginTop:5 }}>{rate.split('-').pop().trim()}</div>
              </div>
            )
          })}
        </div>
      )}
    </PageWrap>
  )
}
