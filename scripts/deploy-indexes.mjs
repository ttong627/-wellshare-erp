/* Firestore composite indexes 배포 — firestore.indexes.json 기준 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PROJECT_ID = 'wellshare-erp';
const GCLOUD = `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;
const token = execSync(`"${GCLOUD}" auth print-access-token`, { encoding: 'utf8' }).trim();

const indexes = JSON.parse(readFileSync(new URL('../firestore.indexes.json', import.meta.url), 'utf8'));

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-Goog-User-Project': PROJECT_ID,
};

for (const idx of indexes.indexes) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/collectionGroups/${idx.collectionGroup}/indexes`;
  const body = {
    queryScope: idx.queryScope,
    fields: idx.fields.map((f) => ({ fieldPath: f.fieldPath, order: f.order })),
  };
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (res.ok) {
    const op = JSON.parse(text);
    console.log(`✓ ${idx.collectionGroup}: ${idx.fields.map(f => f.fieldPath + ' ' + f.order).join(' + ')} → ${op.name?.split('/').pop()}`);
  } else if (text.includes('ALREADY_EXISTS') || text.includes('already exists')) {
    console.log(`= ${idx.collectionGroup}: ${idx.fields.map(f => f.fieldPath).join(' + ')} (already exists)`);
  } else {
    console.error(`✗ ${idx.collectionGroup}: ${res.status} ${text}`);
  }
}
console.log('Done. Indexes build in background (1-5 min).');
