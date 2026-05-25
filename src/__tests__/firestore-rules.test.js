/* Firestore Rules 권한 상승 차단 테스트 (베라 + 재이 권고)
 * 실행 전제: Firestore emulator가 127.0.0.1:8080에서 실행 중
 *   1. (별도 터미널) firebase emulators:start --only firestore
 *   2. npm test
 *
 * 이 테스트는 Java JRE 없으면 자동 skip — vitest 환경에서 안전 동작 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { setDoc, getDoc, updateDoc, doc, setLogLevel } from 'firebase/firestore';

/* emulator 가용성 — firebase emulators:exec 가 FIRESTORE_EMULATOR_HOST를 자동 설정.
 * 또는 사용자가 별도 터미널에서 firebase emulators:start 후 npm test 실행 시 env 수동 지정 가능.
 * Module load 시점에 평가되어야 it.runIf 정상 동작 */
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '';
const emulatorAvailable = EMULATOR_HOST.length > 0;
const [emHost, emPort] = (EMULATOR_HOST || '127.0.0.1:8080').split(':');

let testEnv;

beforeAll(async () => {
  if (!emulatorAvailable) {
    console.warn('[firestore-rules.test] FIRESTORE_EMULATOR_HOST 미설정 — SKIP. 실행: firebase emulators:exec --only firestore "npm test"');
    return;
  }
  try {
    setLogLevel('error');
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-wellshare-erp',
      firestore: {
        host: emHost,
        port: parseInt(emPort || '8080', 10),
        rules: readFileSync('firestore.rules', 'utf8'),
      },
    });
  } catch (err) {
    console.warn('[firestore-rules.test] 환경 초기화 실패 — SKIP:', err.message);
  }
}, 30000);

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

/* 시드 헬퍼 — 보안 룰 우회하여 초기 사용자 문서 생성 */
async function seedUser(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}

describe('Firestore Rules — users 권한 상승 차단 (코코 + 재이)', () => {
  it.runIf(emulatorAvailable)('본인이 자기 role을 admin으로 변경 시도 → DENIED', async () => {
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(alice, 'users', 'alice'), { role: 'admin' }));
  });

  it.runIf(emulatorAvailable)('본인이 자기 orgId를 변경 시도 → DENIED', async () => {
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(alice, 'users', 'alice'), { orgId: 'org2' }));
  });

  it.runIf(emulatorAvailable)('본인이 자기 email 변경 시도 → DENIED', async () => {
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(alice, 'users', 'alice'), { email: 'evil@x.com' }));
  });

  it.runIf(emulatorAvailable)('본인이 자기 minutesAccess를 approved로 변경 시도 → DENIED', async () => {
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(updateDoc(doc(alice, 'users', 'alice'), { minutesAccess: 'approved' }));
  });

  it.runIf(emulatorAvailable)('본인이 displayName/position 변경 → ALLOWED', async () => {
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(updateDoc(doc(alice, 'users', 'alice'), { displayName: '앨리스', position: '서기' }));
  });

  it.runIf(emulatorAvailable)('admin은 모든 필드 변경 → ALLOWED', async () => {
    await seedUser('boss', { email: 'boss@x.com', role: 'admin', orgId: null });
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const boss = testEnv.authenticatedContext('boss').firestore();
    await assertSucceeds(updateDoc(doc(boss, 'users', 'alice'), { role: 'manager', minutesAccess: 'approved' }));
  });

  it.runIf(emulatorAvailable)('매니저가 같은 단체 멤버를 admin으로 승격 시도 → DENIED', async () => {
    await seedUser('mgr', { email: 'mgr@x.com', role: 'manager', orgId: 'org1' });
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const mgr = testEnv.authenticatedContext('mgr').firestore();
    await assertFails(updateDoc(doc(mgr, 'users', 'alice'), { role: 'admin' }));
  });

  it.runIf(emulatorAvailable)('매니저가 같은 단체 멤버를 manager로 승격 → ALLOWED', async () => {
    await seedUser('mgr', { email: 'mgr@x.com', role: 'manager', orgId: 'org1' });
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const mgr = testEnv.authenticatedContext('mgr').firestore();
    await assertSucceeds(updateDoc(doc(mgr, 'users', 'alice'), { role: 'manager' }));
  });

  it.runIf(emulatorAvailable)('매니저가 다른 단체 멤버 수정 시도 → DENIED', async () => {
    await seedUser('mgr', { email: 'mgr@x.com', role: 'manager', orgId: 'org1' });
    await seedUser('bob', { email: 'bob@x.com', role: 'member', orgId: 'org2' });
    const mgr = testEnv.authenticatedContext('mgr').firestore();
    await assertFails(updateDoc(doc(mgr, 'users', 'bob'), { displayName: 'X' }));
  });

  it.runIf(emulatorAvailable)('매니저가 minutesAccess 변경 시도 → DENIED', async () => {
    await seedUser('mgr', { email: 'mgr@x.com', role: 'manager', orgId: 'org1' });
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    const mgr = testEnv.authenticatedContext('mgr').firestore();
    await assertFails(updateDoc(doc(mgr, 'users', 'alice'), { minutesAccess: 'approved' }));
  });
});

describe('Firestore Rules — meeting_minutes orgId 격리 (빌)', () => {
  it.runIf(emulatorAvailable)('같은 단체 멤버는 회의록 read → ALLOWED', async () => {
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'meeting_minutes', 'm1'), {
        orgId: 'org1', creatorUid: 'bob', rawTranscript: [], aiSummary: {}, security: {}, archivePolicy: {}
      });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(alice, 'meeting_minutes', 'm1')));
  });

  it.runIf(emulatorAvailable)('다른 단체 멤버가 회의록 read 시도 → DENIED', async () => {
    await seedUser('alice', { email: 'alice@x.com', role: 'member', orgId: 'org1' });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'meeting_minutes', 'm2'), {
        orgId: 'org2', creatorUid: 'bob', rawTranscript: [], aiSummary: {}, security: {}, archivePolicy: {}
      });
    });
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(alice, 'meeting_minutes', 'm2')));
  });

  it.runIf(emulatorAvailable)('admin은 다른 단체 회의록도 read → ALLOWED', async () => {
    await seedUser('boss', { email: 'boss@x.com', role: 'admin', orgId: null });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'meeting_minutes', 'm3'), {
        orgId: 'org2', creatorUid: 'bob', rawTranscript: [], aiSummary: {}, security: {}, archivePolicy: {}
      });
    });
    const boss = testEnv.authenticatedContext('boss').firestore();
    await assertSucceeds(getDoc(doc(boss, 'meeting_minutes', 'm3')));
  });
});

/* 환경 가드 — emulator 미실행 시 한 번만 알림 */
describe('[환경 안내]', () => {
  it('emulator 가용 여부 보고', () => {
    if (emulatorAvailable) {
      console.log('[firestore-rules.test] Emulator 가용 — 모든 시나리오 실제 검증');
    } else {
      console.log('[firestore-rules.test] Emulator 미가용 — 시나리오 테스트 SKIP. 실행: firebase emulators:start --only firestore');
    }
    expect(true).toBe(true);
  });
});
