// Validates BUFFER_API_KEY and lists channels (read-only) so we can build the
// Voice x Platform -> channel map in src/config/channels.ts.
// Usage: node scripts/test-buffer.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const key = env.BUFFER_API_KEY || process.env.BUFFER_API_KEY;
if (!key) {
  console.error('BUFFER_API_KEY not set');
  process.exit(1);
}

async function gql(query, variables = {}) {
  const res = await fetch('https://api.buffer.com', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

try {
  const acct = await gql('query { account { organizations { id name } } }');
  const orgs = acct?.account?.organizations || [];
  console.log(`✓ auth OK — ${orgs.length} organization(s)\n`);

  for (const org of orgs) {
    console.log(`org: ${org.name} (${org.id})`);
    const data = await gql(
      'query ($input: ChannelsInput!) { channels(input: $input) { id name displayName service isQueuePaused } }',
      { input: { organizationId: org.id } },
    );
    const channels = data?.channels || [];
    if (channels.length === 0) console.log('  (no channels)');
    for (const ch of channels) {
      console.log(`  • ${ch.service.padEnd(10)} ${ch.displayName || ch.name}`);
      console.log(`      id: ${ch.id}${ch.isQueuePaused ? '  [queue paused]' : ''}`);
    }
    console.log('');
  }
} catch (e) {
  console.error(`✗ Buffer error: ${e.message}`);
  process.exit(1);
}
