#!/usr/bin/env node
/**
 * Run a SQL migration file against the Supabase database.
 *
 * Usage:
 *   node scripts/run-sql.mjs docs/migrations/002_retention_machine.sql
 *   node scripts/run-sql.mjs --inline "SELECT count(*) FROM gyms"
 *
 * Reads DATABASE_URL from .env.local automatically.
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Parse .env.local for DATABASE_URL
const envFile = readFileSync(join(root, '.env.local'), 'utf8')
const dbUrlMatch = envFile.match(/^DATABASE_URL="?([^"\n]+)"?/m)
const supabaseUrlMatch = envFile.match(/^NEXT_PUBLIC_SUPABASE_URL="?([^"\n]+)"?/m)
const serviceKeyMatch = envFile.match(/^SUPABASE_SERVICE_ROLE_KEY="?([^"\n]+)"?/m)

if (!supabaseUrlMatch || !serviceKeyMatch) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabaseUrl = supabaseUrlMatch[1].replace(/\\n$/, '')
const serviceKey = serviceKeyMatch[1].replace(/\\n$/, '')

const args = process.argv.slice(2)

let sql
if (args[0] === '--inline') {
  sql = args.slice(1).join(' ')
} else if (args[0]) {
  const filePath = args[0].startsWith('/') ? args[0] : join(root, args[0])
  sql = readFileSync(filePath, 'utf8')
} else {
  console.error('Usage: node scripts/run-sql.mjs <file.sql> | --inline "SQL"')
  process.exit(1)
}

console.log(`Running SQL (${sql.length} chars) against ${supabaseUrl}...`)

const res = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  },
  body: JSON.stringify({ query: sql }),
})

// The RPC approach may not work for raw DDL — fall back to the SQL endpoint
if (!res.ok) {
  // Try the Supabase Management API SQL endpoint instead
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\./)?.[1]
  if (!projectRef) {
    console.error('Could not extract project ref from URL')
    console.error(`REST error: ${res.status} ${await res.text()}`)
    process.exit(1)
  }

  // Use pg module if available, otherwise report the error
  console.log('REST RPC failed, trying direct pg connection...')

  if (dbUrlMatch) {
    const dbUrl = dbUrlMatch[1].replace(/\\n$/, '')
    try {
      const { default: pg } = await import('pg')
      const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
      await client.connect()
      const result = await client.query(sql)
      console.log('Migration executed successfully.')
      if (result.rows?.length) {
        console.table(result.rows.slice(0, 20))
      }
      await client.end()
    } catch (pgErr) {
      console.error('pg connection failed:', pgErr.message)
      console.log('\nTo install pg: npm install pg --save-dev')
      console.log('Or run the SQL manually in Supabase SQL Editor.')
      process.exit(1)
    }
  } else {
    console.error('No DATABASE_URL found and REST RPC failed.')
    process.exit(1)
  }
} else {
  const data = await res.json()
  console.log('Migration executed successfully.')
  if (Array.isArray(data) && data.length) {
    console.table(data.slice(0, 20))
  }
}
