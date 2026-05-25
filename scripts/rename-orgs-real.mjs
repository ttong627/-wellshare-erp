/* Firestore 9개 단체로 일괄 변경:
 * - 기존 org1~org8: name PATCH
 * - org9: 신규 생성 (Warm Stone 컬러)
 * 컬러는 사양 고정(보존), 이름만 실제 단체명으로 교체 */
import { execSync } from 'node:child_process';

const PROJECT_ID = 'wellshare-erp';
const GCLOUD = `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`;
const token = execSync(`"${GCLOUD}" auth print-access-token`, { encoding: 'utf8' }).trim();

const ORGS = [
  { id: 'org1', name: '경기자활기업협회',    color: '#708A81', lightColor: '#E2ECE9', rename: true },
  { id: 'org2', name: '경기광역자활센터',    color: '#C97A53', lightColor: '#F5ECE6', rename: true },
  { id: 'org3', name: '컴윈',                color: '#6A85B6', lightColor: '#E6ECF5', rename: true },
  { id: 'org4', name: 'HD협동조합',          color: '#B19470', lightColor: '#F4EFE6', rename: true },
  { id: 'org5', name: '경기사회서비스사협',  color: '#889E73', lightColor: '#ECF0E6', rename: true },
  { id: 'org6', name: '웰쉐어사협',          color: '#9B72AA', lightColor: '#F2ECF5', rename: true },
  { id: 'org7', name: '클린쿱사협',          color: '#82A0D8', lightColor: '#E8EDF5', rename: true },
  { id: 'org8', name: '웰쉐어로지스',        color: '#D291BC', lightColor: '#F6ECF2', rename: true },
  { id: 'org9', name: '라윈시스템',          color: '#A89B8C', lightColor: '#EEEAE4', rename: false },
];

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-Goog-User-Project': PROJECT_ID,
};

for (const org of ORGS) {
  if (org.rename) {
    // 기존 문서 → name만 PATCH (color/lightColor는 보존)
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/organizations/${org.id}?updateMask.fieldPaths=name`;
    const body = { fields: { name: { stringValue: org.name } } };
    const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(body) });
    console.log(res.ok ? `✓ rename ${org.id} → ${org.name}` : `✗ ${org.id}: ${res.status} ${await res.text()}`);
  } else {
    // 신규 생성
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
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (res.ok) {
      console.log(`✓ create ${org.id} → ${org.name}`);
    } else {
      const text = await res.text();
      console.log(text.includes('ALREADY_EXISTS') ? `= ${org.id} already exists, skipped` : `✗ ${org.id}: ${res.status} ${text}`);
    }
  }
}
console.log('Done.');
