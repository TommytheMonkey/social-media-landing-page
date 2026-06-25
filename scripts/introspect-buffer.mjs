// Introspects Buffer's createPost schema so we can verify buffer.ts matches the
// REAL types (input field nullability, enum values, return-union members) without
// creating a test post. Usage: node scripts/introspect-buffer.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const key = env.BUFFER_API_KEY;

async function gql(query) {
  const res = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query }),
  });
  const b = await res.json();
  if (b.errors) throw new Error(JSON.stringify(b.errors).slice(0, 400));
  return b.data;
}
function tn(t) {
  if (!t) return '?';
  if (t.kind === 'NON_NULL') return tn(t.ofType) + '!';
  if (t.kind === 'LIST') return '[' + tn(t.ofType) + ']';
  return t.name;
}

// 1. createPost mutation field: arg + return type
const m = await gql(`{ __schema { mutationType { fields { name
  args { name type { kind name ofType { kind name ofType { kind name } } } }
  type { kind name ofType { kind name } } } } } }`);
const cp = m.__schema.mutationType.fields.find((f) => f.name === 'createPost');
console.log('createPost args:', cp.args.map((a) => `${a.name}: ${tn(a.type)}`).join(', '));
const retName = cp.type.name || cp.type.ofType?.name;
console.log('createPost returns:', tn(cp.type), '\n');

// 2. CreatePostInput fields
const ci = await gql(`{ __type(name:"CreatePostInput"){ inputFields { name type { kind name ofType { kind name ofType { kind name } } } } } }`);
console.log('CreatePostInput fields:');
for (const f of ci.__type.inputFields) console.log(`   ${f.name}: ${tn(f.type)}`);

// 3. Enums we rely on
for (const en of ['ShareMode', 'SchedulingType']) {
  const e = await gql(`{ __type(name:"${en}"){ enumValues { name } } }`);
  console.log(`\n${en}: ${e.__type?.enumValues?.map((v) => v.name).join(', ') ?? '(n/a)'}`);
}

// 4. Return union members + their fields
const u = await gql(`{ __type(name:"${retName}"){ kind name possibleTypes { name fields { name } } } }`);
console.log(`\n${retName} (${u.__type?.kind}): members =`,
  (u.__type?.possibleTypes || []).map((p) => `${p.name}{${(p.fields || []).map((x) => x.name).join(',')}}`).join('  '));

// 5. AssetInput shape
const a = await gql(`{ __type(name:"AssetInput"){ inputFields { name type { kind name } } } }`);
console.log('\nAssetInput fields:', (a.__type?.inputFields || []).map((f) => f.name).join(', '));
