/* gcloud 토큰으로 Firestore Security Rules를 배포 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const PROJECT_ID = 'wellshare-erp';
const GCLOUD = `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;

const token = execSync(`"${GCLOUD}" auth print-access-token`, { encoding: 'utf8' }).trim();
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

async function api(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': PROJECT_ID,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// 1) 새 ruleset 생성
const ruleset = await api(
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/rulesets`,
  'POST',
  { source: { files: [{ name: 'firestore.rules', content: rules }] } }
);
console.log('Ruleset:', ruleset.name);

// 2) cloud.firestore release 갱신 (없으면 생성, 있으면 업데이트)
try {
  await api(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases`,
    'POST',
    {
      name: `projects/${PROJECT_ID}/releases/cloud.firestore`,
      rulesetName: ruleset.name,
    }
  );
  console.log('Release created: cloud.firestore');
} catch (e) {
  if (e.message.includes('ALREADY_EXISTS') || e.message.includes('409')) {
    await api(
      `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/cloud.firestore?updateMask=rulesetName`,
      'PATCH',
      {
        release: {
          name: `projects/${PROJECT_ID}/releases/cloud.firestore`,
          rulesetName: ruleset.name,
        },
      }
    );
    console.log('Release updated: cloud.firestore');
  } else {
    throw e;
  }
}

console.log('✓ Firestore Security Rules deployed');
