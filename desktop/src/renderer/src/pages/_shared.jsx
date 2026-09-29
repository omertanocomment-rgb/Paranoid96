import { useState, useEffect, useCallback } from 'react'

export const ft = window.ft

export function Section({ title, children, action }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--text)', letterSpacing:'0.02em' }}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function Card({ children, style, accent }) {
  return (
    <div style={{
      background: accent ? `var(--${accent}-dim)` : 'var(--bg1)',
      border: `1px solid ${accent ? `rgba(var(--${accent}-rgb),0.2)` : 'var(--border)'}`,
      borderRadius: 10, padding: 16, ...style
    }}>{children}</div>
  )
}

export function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid var(--border)' }}>
      <span style={{ fontSize:12, color:'var(--text3)', flexShrink:0 }}>{label}</span>
      <span style={{ fontSize:12, color:'var(--text2)', fontFamily: mono?'var(--mono)':undefined, textAlign:'right', marginLeft:12, wordBreak:'break-all' }}>{value ?? '--'}</span>
    </div>
  )
}

export function Spinner({ size=18 }) {
  return <div className="spinner" style={{ width:size, height:size, borderWidth: size > 16 ? 2 : 1.5 }} />
}

export function Empty({ icon=' ', text='Nothing here', sub }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8, padding:40, color:'var(--text3)', textAlign:'center' }}>
      <div style={{ fontSize:32, opacity:0.4 }}>{icon}</div>
      <div style={{ fontSize:13 }}>{text}</div>
      {sub && <div style={{ fontSize:12, opacity:0.7 }}>{sub}</div>}
    </div>
  )
}

export function Progress({ percent, message, color='var(--accent)' }) {
  return (
    <div className="card" style={{ padding:14 }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
        <Spinner />
        <span style={{ fontSize:13, color:'var(--text2)' }}>{message || 'Working...'}</span>
      </div>
      <div style={{ background:'var(--bg3)', borderRadius:2, height:4, overflow:'hidden' }}>
        <div style={{ width:(percent||0)+'%', height:'100%', background:color, transition:'width 0.3s', borderRadius:2 }} />
      </div>
      <div style={{ fontSize:11, color:'var(--text3)', marginTop:3 }}>{percent||0}%</div>
    </div>
  )
}

export function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display:'flex', gap:3, background:'var(--bg2)', borderRadius:8, padding:3, flexWrap:'wrap', marginBottom:16 }}>
      {tabs.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} style={{
          padding:'6px 12px', borderRadius:6, fontSize:12, fontWeight:500, cursor:'pointer',
          background: active===id ? 'var(--bg4)' : 'none',
          color: active===id ? 'var(--text)' : 'var(--text3)',
          border: active===id ? '1px solid var(--border)' : '1px solid transparent'
        }}>{label}</button>
      ))}
    </div>
  )
}

export function Checkbox({ checked, onChange, label }) {
  return (
    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
      <div onClick={onChange} style={{
        width:16, height:16, borderRadius:4, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
        background: checked ? 'var(--accent)' : 'var(--bg2)',
        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border2)'}`,
        transition:'all 0.1s'
      }}>
        {checked && <span style={{ color:'#000', fontSize:9, lineHeight:1 }}> </span>}
      </div>
      {label && <span style={{ fontSize:13, color:'var(--text2)' }}>{label}</span>}
    </label>
  )
}

export function Tag({ children, color='gray' }) {
  const colors = {
    gray: { bg:'var(--bg3)', text:'var(--text3)' },
    green: { bg:'var(--green-dim)', text:'var(--green)' },
    red: { bg:'var(--red-dim)', text:'var(--red)' },
    blue: { bg:'var(--blue-dim)', text:'var(--blue)' },
    amber: { bg:'var(--accent-dim)', text:'var(--accent)' },
  }
  const c = colors[color] || colors.gray
  return (
    <span style={{ display:'inline-flex', alignItems:'center', padding:'2px 8px', borderRadius:4, fontSize:11, fontWeight:500, background:c.bg, color:c.text, flexShrink:0 }}>
      {children}
    </span>
  )
}

export function PageWrap({ children }) {
  return (
    <div style={{ padding:24, display:'flex', flexDirection:'column', gap:16, overflowY:'auto', height:'100%' }} className="fade-in">
      {children}
    </div>
  )
}

export function PageHeader({ title, sub, icon }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:4 }}>
      {icon && <span style={{ fontSize:24 }}>{icon}</span>}
      <div>
        <h2 style={{ fontSize:18, fontWeight:600, color:'var(--text)', margin:0 }}>{title}</h2>
        {sub && <div style={{ fontSize:13, color:'var(--text3)', marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  )
}
