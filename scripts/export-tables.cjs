/*
  Writes every row of the named tables to JSON files, one per table.

    node scripts/export-tables.cjs <destination directory>

  This is the safety net before a destructive migration. It is not a substitute
  for a real backup: it captures rows, not schema, sequences, storage objects
  or auth users. What it is good for is answering "what was in there" after the
  fact, and putting a handful of rows back by hand.
*/
const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

const dest = process.argv[2]
if (!dest) {
  console.error('Usage: node scripts/export-tables.cjs <destination directory>')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]
    }),
)

;(async () => {
  fs.mkdirSync(dest, { recursive: true })
  const client = new Client({ connectionString: env.SUPABASE_DB_URL })
  await client.connect()

  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  )

  let total = 0
  const summary = []
  for (const { table_name: t } of tables) {
    const { rows } = await client.query(`select * from public.${t}`)
    if (rows.length === 0) continue
    fs.writeFileSync(path.join(dest, t + '.json'), JSON.stringify(rows, null, 1))
    summary.push(t + ': ' + rows.length)
    total += rows.length
  }

  // The accounts themselves, which live outside the public schema.
  const { rows: users } = await client.query(
    `select id, email, phone, created_at, last_sign_in_at, raw_user_meta_data from auth.users order by created_at`,
  )
  fs.writeFileSync(path.join(dest, '_auth_users.json'), JSON.stringify(users, null, 1))

  fs.writeFileSync(
    path.join(dest, '_manifest.txt'),
    'Exported ' + new Date().toISOString() + '\n' + summary.join('\n') + '\nauth.users: ' + users.length + '\n',
  )

  console.log('exported ' + summary.length + ' tables, ' + total + ' rows, plus ' + users.length + ' accounts')
  console.log('to: ' + path.resolve(dest))
  await client.end()
})().catch((e) => {
  console.error('ERROR: ' + e.message)
  process.exit(1)
})
