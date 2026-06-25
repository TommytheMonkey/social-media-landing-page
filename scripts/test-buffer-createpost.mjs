// Validates the createPost DOCUMENT/fragments by sending it with a bogus channel
// id (Buffer errors out -> no post is created). Confirms the mutation + the
// "... on MutationError" interface fragment are accepted. Usage: node scripts/test-buffer-createpost.mjs
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const key = env.BUFFER_API_KEY;

const mutation = `mutation ($channelId: ChannelId!, $text: String, $dueAt: DateTime,
           $assets: [AssetInput!]!, $metadata: PostInputMetaData) {
   createPost(input: {
     channelId: $channelId
     schedulingType: automatic
     mode: shareNow
     dueAt: $dueAt
     text: $text
     assets: $assets
     metadata: $metadata
   }) {
     __typename
     ... on PostActionSuccess { post { id } }
     ... on MutationError { message }
   }
 }`;

const res = await fetch('https://api.buffer.com', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({
    query: mutation,
    variables: { channelId: '0000fakechannelvalidation0000', text: 'validation', dueAt: null, assets: [], metadata: null },
  }),
});
const body = await res.json();
console.log(JSON.stringify(body, null, 2));
