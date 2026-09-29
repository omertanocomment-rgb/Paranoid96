import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { ThemeProvider } from './theme/ThemeContext.jsx'

// Top-level error boundary for white/black screen debugging
class RootBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  componentDidCatch(e, info) { console.error('Root crash:', e, info) }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 40, fontFamily: 'monospace', color: '#e8e8e6', background: '#0d0d0d', height: '100vh', boxSizing: 'border-box', overflow: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#f87171', marginBottom: 16 }}>Omerta failed to start</div>
        <div style={{ fontSize: 13, color: '#f59e0b', marginBottom: 12 }}>{this.state.error.message}</div>
        <pre style={{ fontSize: 11, color: '#555', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          {this.state.error.stack}
        </pre>
        <button onClick={() => this.setState({ error: null })}
          style={{ marginTop: 20, padding: '8px 16px', background: '#f59e0b', color: '#000', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
          Retry
        </button>
      </div>
    )
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </RootBoundary>
  </React.StrictMode>
)
