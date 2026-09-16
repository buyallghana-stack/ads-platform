/*
  Compares two databases' public schemas: tables, columns, functions, triggers,
  enums and RLS.

    SOURCE_DB_URL=... TARGET_DB_URL=... node scripts/diff-schema.cjs

  Written to answer one question: is the database built from the migration
  history actually the same shape as the one the migrations were written
  against? A test database that quietly differs from production is worse than
  no test database, because every green run is then evidence about the wrong
  system.

  Read-only on both sides.
*/
const { Client } = require('pg')

const QUERIES = {
  tables: `select table_name from information_schema.tables
            where table_schema='public' and table_type='BASE TABLE' order by 1`,
  columns: `select table_name||'.'||column_name||' '||data_type||
                   case when is_nullable='NO' then ' NOT NULL' else '' end as c
              from information_schema.columns where table_schema='public' order by 1`,
  functions: `select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as f
                from pg_proc p join pg_namespace n on n.oid=p.pronamespace
               where n.nspname='public' order by 1`,
  triggers: `select c.relname||'.'||t.tgname as t
               from pg_trigger t join pg_class c on c.oid=t.tgrelid
               join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and not t.tgisinternal order by 1`,
  enums: `select t.typname||': '||string_agg(e.enumlabel, ',' order by e.enumsortorder) as e
            from pg_type t join pg_enum e on e.enumtypid=t.oid
            join pg_namespace n on n.oid=t.typnamespace
           where n.nspname='public' group by t.typname order by 1`,
  rls: `select c.relname||' rls='||c.relrowsecurity as r
          from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='public' and c.relkind='r' order by 1`,
  policies: `select tablename||'.'||policyname as p from pg_policies
              where schemaname='public' order by 1`,
}

const read = async (url) => {
  const c = new Client({ connectionString: url })
  await c.connect()
  const out = {}
  for (const [name, sql] of Object.entries(QUERIES)) {
    const { rows } = await c.query(sql)
    out[name] = new Set(rows.map((r) => Object.values(r)[0]))
  }
  await c.end()
  return out
}

;(async () => {
  const [source, target] = await Promise.all([
    read(process.env.SOURCE_DB_URL),
    read(process.env.TARGET_DB_URL),
  ])

  let differences = 0
  for (const name of Object.keys(QUERIES)) {
    const missing = [...source[name]].filter((x) => !target[name].has(x))
    const extra = [...target[name]].filter((x) => !source[name].has(x))
    if (missing.length === 0 && extra.length === 0) {
      console.log('SAME  ' + name.padEnd(10) + source[name].size)
      continue
    }
    differences += missing.length + extra.length
    console.log('DIFF  ' + name + '  (source ' + source[name].size + ', target ' + target[name].size + ')')
    missing.slice(0, 12).forEach((x) => console.log('   only in source: ' + x))
    if (missing.length > 12) console.log('   ...and ' + (missing.length - 12) + ' more')
    extra.slice(0, 12).forEach((x) => console.log('   only in target: ' + x))
    if (extra.length > 12) console.log('   ...and ' + (extra.length - 12) + ' more')
  }

  console.log('\n' + (differences === 0 ? 'The two schemas match.' : differences + ' differences.'))
})().catch((e) => {
  console.error('ERROR: ' + e.message)
  process.exit(1)
})
