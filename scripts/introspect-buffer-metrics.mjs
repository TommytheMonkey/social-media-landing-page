// Introspects Buffer's `post` query + metrics types so Flow 6 matches the REAL
// schema (arg nullability, PostMetric fields, PostMetricType enum, metricsUpdatedAt).
// Read-only — no posts created. Usage: node scripts/introspect-buffer-metrics.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const key = env.BUFFER_API_KEY;
if (!key) { console.error('BUFFER_API_KEY missing'); process.exit(1); }

async function gql(query, variables) {
  const res = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables }),
  });
  const b = await res.json();
  return b;
}
function tn(t) {
  if (!t) return '?';
  if (t.kind === 'NON_NULL') return tn(t.ofType) + '!';
  if (t.kind === 'LIST') return '[' + tn(t.ofType) + ']';
  return t.name;
}

// 1. `post` query field: args + return type
const q = await gql(`{ __schema { queryType { fields { name
  args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
  type { kind name ofType { kind name } } } } } }`);
const postField = q.data?.__schema?.queryType?.fields?.find((f) => f.name === 'post');
if (!postField) {
  console.log('NO `post` query field found. Query fields:',
    q.data?.__schema?.queryType?.fields?.map((f) => f.name).join(', '));
} else {
  console.log('post args:', postField.args.map((a) => `${a.name}: ${tn(a.type)}`).join(', '));
  console.log('post returns:', tn(postField.type), '\n');
}

// 2. The input type for the post query (if any)
const inputArg = postField?.args?.[0];
const inputTypeName = inputArg ? (inputArg.type.name || inputArg.type.ofType?.name || inputArg.type.ofType?.ofType?.name) : null;
if (inputTypeName) {
  const it = await gql(`{ __type(name:"${inputTypeName}"){ kind inputFields { name type { kind name ofType { kind name } } } } }`);
  console.log(`${inputTypeName} fields:`,
    (it.data?.__type?.inputFields || []).map((f) => `${f.name}: ${tn(f.type)}`).join(', '), '\n');
}

// 3. Post type fields — confirm `metrics` + `metricsUpdatedAt`
const pt = await gql(`{ __type(name:"Post"){ fields { name type { kind name ofType { kind name ofType { kind name } } } } } }`);
const postFields = pt.data?.__type?.fields || [];
const interesting = postFields.filter((f) => /metric|id/i.test(f.name));
console.log('Post fields (metric/id):', interesting.map((f) => `${f.name}: ${tn(f.type)}`).join(', '), '\n');

// 4. PostMetric type fields
const pm = await gql(`{ __type(name:"PostMetric"){ fields { name type { kind name ofType { kind name } } } } }`);
console.log('PostMetric fields:', (pm.data?.__type?.fields || []).map((f) => `${f.name}: ${tn(f.type)}`).join(', '), '\n');

// 5. PostMetricType enum values
for (const en of ['PostMetricType', 'MetricType']) {
  const e = await gql(`{ __type(name:"${en}"){ enumValues(includeDeprecated:true) { name isDeprecated } } }`);
  const vals = e.data?.__type?.enumValues;
  if (vals) {
    console.log(`${en}:`, vals.map((v) => v.isDeprecated ? `${v.name}(DEP)` : v.name).join(', '), '\n');
  }
}
