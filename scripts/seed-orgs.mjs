/* Firestore REST API로 8개 기본 단체 시드 — 클라이언트 첫 방문 전에 즉시 데이터 생성 */
import { execSync } from 'node:child_process';

const PROJECT_ID = 'wellshare-erp';
const GCLOUD = `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;
const token = execSync(`"${GCLOUD}" auth print-access-token`, { encoding: 'utf8' }).trim();

const DEFAULT_ORGS = [
  { id: 'org1', name: '경기자활기업협회',    color: '#708A81', lightColor: '#E2ECE9' },
  { id: 'org2', name: '경기광역자활센터',    color: '#C97A53', lightColor: '#F5ECE6' },
  { id: 'org3', name: '컴윈',                color: '#6A85B6', lightColor: '#E6ECF5' },
  { id: 'org4', name: 'HD협동조합',          color: '#B19470', lightColor: '#F4EFE6' },
  { id: 'org5', name: '경기사회서비스사협',  color: '#889E73', lightColor: '#ECF0E6' },
  { id: 'org6', name: '웰쉐어사협',          color: '#9B72AA', lightColor: '#F2ECF5' },
  { id: 'org7', name: '클린쿱사협',          color: '#82A0D8', lightColor: '#E8EDF5' },
  { id: 'org8', name: '웰쉐어로지스',        color: '#D291BC', lightColor: '#F6ECF2' },
  { id: 'org9', name: '라윈시스템',          color: '#A89B8C', lightColor: '#EEEAE4' },
];

for (const org of DEFAULT_ORGS) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/organizations?documentId=${org.id}`;
  const body = {
    fields: {
      name: { stringValue: org.name },
      color: { stringValue: org.color },
      lightColor: { stringValue: org.lightColor },
      isDefault: { booleanValue: true },
      createdAt: { timestampValue: new Date().toISOString() },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-User-Project': PROJECT_ID,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    console.log(`✓ ${org.id} (${org.name}) seeded`);
  } else {
    const text = await res.text();
    if (text.includes('ALREADY_EXISTS')) {
      console.log(`= ${org.id} already exists, skipped`);
    } else {
      console.error(`✗ ${org.id}: ${res.status} ${text}`);
    }
  }
}
console.log('Done.');
