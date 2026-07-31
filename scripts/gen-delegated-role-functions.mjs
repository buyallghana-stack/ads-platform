import { Client } from 'pg'
const db = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

const AREAS = {
  support: ['admin_get_support_thread', 'admin_send_support_message', 'admin_set_support_status', 'admin_mark_support_read'],
  ads: ['admin_get_ad', 'admin_save_ad', 'admin_delete_ad', 'admin_set_ad_status', 'admin_save_advertiser', 'admin_delete_advertiser'],
}

const out = []
for (const [area, names] of Object.entries(AREAS)) {
  for (const name of names) {
    const { rows } = await db.query(
      `select pg_get_functiondef(p.oid) as def, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [name],
    )
    if (rows.length !== 1) { console.error(`!! ${name}: ${rows.length} definitions`); continue }
    let def = rows[0].def
    // The support functions call the parameter p_admin, the ads ones
    // p_admin_id. Both are rewritten, and anything matching neither is
    // reported rather than silently skipped.
    const param = ['p_admin_id', 'p_admin'].find((n) =>
      def.includes(`perform public.assert_admin(${n});`),
    )
    if (!param) { console.error(`!! ${name}: no assert_admin(...) call`); continue }
    def = def.replace(
      `perform public.assert_admin(${param});`,
      `perform public.assert_admin_area(${param}, '${area}');`,
    )
    out.push({ name, area, args: rows[0].args, def })
  }
}
console.error(`generated ${out.length} functions`)
process.stdout.write(out.map((f) =>
  `-- ${f.name} — delegated to the ${f.area} role\n${f.def};\n\nrevoke execute on function public.${f.name}(${f.args})\n  from public, anon, authenticated;\n`,
).join('\n'))
await db.end()
