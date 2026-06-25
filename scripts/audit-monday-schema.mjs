// Introspects Monday's real arg types for every field the client calls, so we can
// compare to the variable nullability declared in monday.ts (the recurring bug
// class). Usage: node scripts/audit-monday-schema.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const token = env.MONDAY_API_TOKEN;

async function gql(query) {
  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token, 'API-Version': '2026-04' },
    body: JSON.stringify({ query }),
  });
  const b = await res.json();
  if (b.errors) throw new Error(JSON.stringify(b.errors));
  return b.data;
}
function tn(t) {
  if (!t) return '?';
  if (t.kind === 'NON_NULL') return tn(t.ofType) + '!';
  if (t.kind === 'LIST') return '[' + tn(t.ofType) + ']';
  return t.name;
}
const ARGS = `args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }`;

// Fields we care about, grouped by the type that declares them.
const WANT = {
  Query: ['boards', 'items', 'next_items_page', 'assets'],
  Mutation: ['change_multiple_column_values', 'change_simple_column_value', 'duplicate_item', 'create_item', 'create_update', 'move_item_to_group', 'add_file_to_column'],
  Board: ['items_page', 'columns', 'groups'],
  Item: ['column_values', 'updates'],
};

for (const [typeName, fields] of Object.entries(WANT)) {
  const isRoot = typeName === 'Query' || typeName === 'Mutation';
  const data = isRoot
    ? await gql(`{ __schema { ${typeName === 'Query' ? 'queryType' : 'mutationType'} { fields { name ${ARGS} } } } }`)
    : await gql(`{ __type(name:"${typeName}") { fields { name ${ARGS} } } }`);
  const all = isRoot ? data.__schema[typeName === 'Query' ? 'queryType' : 'mutationType'].fields : data.__type.fields;
  console.log(`\n=== ${typeName} ===`);
  for (const fname of fields) {
    const f = all.find((x) => x.name === fname);
    if (!f) { console.log(`  ${fname}: (NOT FOUND)`); continue; }
    console.log(`  ${fname}(${f.args.map((a) => `${a.name}: ${tn(a.type)}`).join(', ')})`);
  }
}
