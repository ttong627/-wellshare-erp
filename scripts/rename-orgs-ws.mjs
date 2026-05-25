/* Firestore의 기존 8개 단체명 'AKP X' → 'WS X' 일괄 갱신 */
import { execSync } from 'node:child_process';

const PROJECT_ID = 'wellshare-erp';
const GCLOUD = `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;
const token = execSync(`"${GCLOUD}" auth print-access-token`, { encoding: 'utf8' }).trim();

const RENAMES = [
  { id: 'org1', name: 'WS 청년회' },
  { id: 'org2', name: 'WS 부녀회' },
  { id: 'org3', name: 'WS 장년회' },
  { id: 'org4', name: 'WS 예술단' },
  { id: 'org5', name: 'WS 복지재단' },
  { id: 'org6', name: 'WS 체육회' },
  { id: 'org7', name: 'WS 장학회' },
  { id: 'org8', name: 'WS 선교단' },
];

for (const org of RENAMES) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/organizations/${org.id}?updateMask.fieldPaths=name`;
  const body = { fields: { name: { stringValue: org.name } } };
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': PROJECT_ID,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    console.log(`✓ ${org.id} → ${org.name}`);
  } else {
    console.error(`✗ ${org.id}: ${res.status} ${await res.text()}`);
  }
}
console.log('Done.');
