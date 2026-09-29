/**
 * db.js -- Pure JS SQLite wrapper using sql.js (no native compilation needed)
 * Drop-in replacement for better-sqlite3 for our use cases
 */
import { join, dirname } from 'path'
import { app } from 'electron'
import fs from 'fs-extra'

let SQL = null

async function getSql() {
  if (SQL) return SQL
  try {
    // Try better-sqlite3 first (faster, if available)
    const { default: Database } = await import('better-sqlite3')
    SQL = { type: 'better-sqlite3', Database }
    return SQL
  } catch {
    // Fall back to sql.js (pure JS, always works)
    const initSqlJs = (await import('sql.js')).default
    const wasmPath = app.isPackaged
      ? join(process.resourcesPath, 'node_modules/sql.js/dist/sql-wasm.wasm')
      : join(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm')

    let wasmBinary
    try {
      wasmBinary = await fs.readFile(wasmPath)
    } catch {
      // Try alternate paths
      const altPaths = [
        join(dirname(import.meta.url?.replace('file:///', '') || ''), '../../node_modules/sql.js/dist/sql-wasm.wasm'),
        'node_modules/sql.js/dist/sql-wasm.wasm'
      ]
      for (const p of altPaths) {
        if (await fs.pathExists(p)) { wasmBinary = await fs.readFile(p); break }
      }
    }

    const Sql = await initSqlJs(wasmBinary ? { wasmBinary } : {})
    SQL = { type: 'sql.js', Sql }
    return SQL
  }
}

/**
 * Open a SQLite database and return a query interface
 * Works identically whether using better-sqlite3 or sql.js
 */
export async function openDb(filePath, readonly = true) {
  const sql = await getSql()

  if (sql.type === 'better-sqlite3') {
    const db = new sql.Database(filePath, { readonly })
    return {
      all: (query, params = []) => db.prepare(query).all(...params),
      get: (query, params = []) => db.prepare(query).get(...params),
      run: (query, params = []) => db.prepare(query).run(...params),
      close: () => db.close()
    }
  }

  // sql.js path
  const fileData = await fs.readFile(filePath)
  const db = new sql.Sql.Database(fileData)

  return {
    all: (query, params = []) => {
      const stmt = db.prepare(query)
      const rows = []
      if (params.length) stmt.bind(params)
      while (stmt.step()) rows.push(stmt.getAsObject())
      stmt.free()
      return rows
    },
    get: (query, params = []) => {
      const stmt = db.prepare(query)
      if (params.length) stmt.bind(params)
      const row = stmt.step() ? stmt.getAsObject() : null
      stmt.free()
      return row
    },
    run: (query, params = []) => {
      db.run(query, params)
      return { changes: db.getRowsModified() }
    },
    close: () => db.close()
  }
}

export default { openDb }
