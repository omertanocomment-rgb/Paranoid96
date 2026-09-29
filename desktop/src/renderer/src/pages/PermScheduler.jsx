import { useState, useEffect } from 'react'
import { ft, PageWrap, PageHeader, Empty, Tag } from './_shared.jsx'


export default function PermScheduler({ device, addLog }) {
  const [schedules, setSchedules] = useState([])
  const [pkg, setPkg] = useState('')
  const [perms, setPerms] = useState('')
  const [interval, setInterval] = useState('daily')

  const add = async () => {
    if (!pkg || !perms) return addLog('Enter package name and permissions')
    const serial = device?.serial
    const newSched = {
      serial, packageName: pkg,
      permissions: perms.split(',').map(p => p.trim()),
      interval
    }
    try {
      await ft.media.schedulePermReset(newSched)
      setSchedules(s => [...s, { ...newSched, id: Date.now(), enabled: true }])
      addLog('Schedule added for: ' + pkg)
      setPkg(''); setPerms('')
    } catch (e) { addLog('Schedule: ' + e.message) }
  }

  const COMMON = [
    ['ACCESS_FINE_LOCATION', 'Location'],
    ['RECORD_AUDIO', 'Microphone'],
    ['CAMERA', 'Camera'],
    ['READ_CONTACTS', 'Contacts'],
  ]

  return (
    <PageWrap>
      <PageHeader title="Permission Scheduler" icon=" " sub="Auto-revoke permissions on a timer -- no root needed" />

      <div className="card">
        <div style={{ fontSize:13, fontWeight:600, marginBottom:12 }}>Add schedule</div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          <input value={pkg} onChange={e => setPkg(e.target.value)} placeholder="Package name (e.g. com.facebook.katana)" />
          <input value={perms} onChange={e => setPerms(e.target.value)} placeholder="Permissions (comma separated)" />
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {COMMON.map(([p, label]) => (
              <button key={p} className="btn btn-sm" onClick={() => setPerms(v => v ? v + ', ' + p : p)}>{label}</button>
            ))}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <select value={interval} onChange={e => setInterval(e.target.value)} style={{ flex:1 }}>
              <option value="daily">Daily (3am)</option>
              <option value="weekly">Weekly (Sunday 3am)</option>
              <option value="hourly">Every 6 hours</option>
            </select>
            <button className="btn btn-primary" onClick={add}>+ Add</button>
          </div>
        </div>
      </div>

      <div>
        <div style={{ fontSize:13, fontWeight:600, marginBottom:8 }}>Active Schedules ({schedules.length})</div>
        {!schedules.length && <Empty icon=" " text="No schedules yet" sub="Add a schedule to auto-revoke permissions periodically" />}
        {schedules.map((s, i) => (
          <div key={i} className="card" style={{ marginBottom:6, display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:500, fontFamily:'var(--mono)' }}>{s.packageName}</div>
              <div style={{ fontSize:11, color:'var(--text3)', marginTop:2 }}>{s.permissions?.join(', ')}   {s.interval}</div>
            </div>
            <Tag color={s.enabled ? 'green' : 'gray'}>{s.enabled ? 'Active' : 'Paused'}</Tag>
            <button className="btn btn-red btn-sm" onClick={() => setSchedules(sc => sc.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
      </div>
    </PageWrap>
  )
}
