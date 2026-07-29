import { readFileSync } from 'node:fs'
import { Client } from 'pg'

const url = process.env.SUPABASE_DB_URL
if (!url) { console.error('SUPABASE_DB_URL missing'); process.exit(1) }

const file = process.argv[2]
const sql = readFileSync(file, 'utf8')

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()
try {
  await client.query('begin')
  await client.query(sql)
  await client.query('commit')
  console.log('APPLIED', file)
} catch (e) {
  await client.query('rollback')
  console.error('FAILED:', e.message)
  if (e.position) console.error('position', e.position, '->', sql.slice(Math.max(0, e.position - 200), Number(e.position) + 200))
  process.exitCode = 1
} finally {
  await client.end()
}
