/* Firebase 클라이언트 초기화 + Firestore CRUD 헬퍼
 * - Anonymous Auth로 모든 방문자에게 임시 uid 부여
 * - 컬렉션: organizations, reservations, members
 * - 기획서 SECURITY_DATABASE.md §1 스키마와 일치 */

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as fbSignOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail as fbSendPwReset,
  sendEmailVerification as fbSendEmailVerify,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
  writeBatch,
  runTransaction,
  Timestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyAXHzgNCQhov5X9o7MrR2eVeH6S0pDJHE4',
  authDomain: 'wellshare-erp.firebaseapp.com',
  projectId: 'wellshare-erp',
  storageBucket: 'wellshare-erp.firebasestorage.app',
  messagingSenderId: '602764318866',
  appId: '1:602764318866:web:4d8ddfbd308bb4b911ae4b',
  measurementId: 'G-E8D5X0QP96',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/* ─── 브라우저 환경 감지 ───────────────────────────────────────────────────
 * Google OAuth 정책: 인앱 WebView(카카오·네이버·인스타 등)에서는
 * signInWithPopup / signInWithRedirect 모두 403 disallowed_useragent 차단.
 * 실제 모바일 브라우저(Chrome/Safari)에서는 redirect만 허용. */

/** 인앱 WebView 여부 — Google OAuth 사용 불가 환경 */
export function isWebView() {
  const ua = navigator.userAgent || '';
  if (/KAKAOTALK|NAVER|Line\/|FB_IAB|FBIOS|Instagram|Snapchat|Pinterest|Twitter\//i.test(ua)) return true;
  // Android에서 Chrome 미포함 = WebView
  if (/Android/i.test(ua) && !/Chrome\/\d+/.test(ua)) return true;
  // iOS에서 Safari 미포함 (WebKit만 있는 WebView)
  if (/iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) return true;
  return false;
}

/** 실제 모바일 브라우저 여부 (WebView 제외) — signInWithRedirect 사용 */
export function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '') && !isWebView();
}

/* 인증 초기화 — 콜백에 firebase user 전달 (익명 또는 실명).
 * autoAnonymous=true(기본)이면 로그인 안 된 상태에서 자동 익명 로그인.
 * 모바일 redirect 결과를 먼저 처리한 뒤 onAuthStateChanged 구독 시작. */
export function initAuth(onUser, { autoAnonymous = true } = {}) {
  getRedirectResult(auth).catch(() => {/* redirect 결과 없음 — 무시 */});
  onAuthStateChanged(auth, (user) => {
    if (user) onUser(user);
    else if (autoAnonymous) signInAnonymously(auth).catch((err) => console.error('Anonymous sign-in failed:', err));
    else onUser(null);
  });
}

/* Email + Password 로그인 */
export async function signInWithEmail(email, password) {
  return await signInWithEmailAndPassword(auth, email, password);
}

/* Email + Password 회원가입 + 이메일 인증 메일 자동 발송 */
export async function signUpWithEmail(email, password, displayName) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  try {
    await fbSendEmailVerify(cred.user);
  } catch (err) {
    console.warn('Verification email send failed:', err.message);
  }
  return cred;
}

/* 비밀번호 재설정 이메일 발송 */
export async function sendPasswordReset(email) {
  return await fbSendPwReset(auth, email);
}

/* 이메일 인증 메일 재발송 (이미 가입된 사용자) */
export async function resendEmailVerification(user) {
  return await fbSendEmailVerify(user);
}

/* Google 로그인
 * WebView(카카오·네이버 등): auth/webview-blocked 에러 throw → UI에서 외부 브라우저 유도
 * 실제 모바일 브라우저: signInWithRedirect → 페이지 reload 후 initAuth에서 처리
 * 데스크톱: signInWithPopup */
export async function signInWithGoogle() {
  if (isWebView()) {
    const err = new Error('인앱 브라우저에서는 Google 로그인을 사용할 수 없습니다.');
    err.code = 'auth/webview-blocked';
    throw err;
  }
  const provider = new GoogleAuthProvider();
  if (isMobileBrowser()) {
    await signInWithRedirect(auth, provider);
    return null; // 페이지가 Google로 이동 → 복귀 시 initAuth가 처리
  }
  return await signInWithPopup(auth, provider);
}

/* 로그아웃 */
export async function signOut() {
  return await fbSignOut(auth);
}

/* ===== users 컬렉션 (사용자 프로필 + 권한) ===== */
const INITIAL_ADMIN_EMAIL = 'ttong627@gmail.com';

export const usersCol = collection(db, 'users');

/* 사용자 프로필 가져오기 (없으면 null) */
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* 사용자 프로필 실시간 구독 */
export function subscribeUserProfile(uid, callback) {
  if (!uid) { callback(null); return () => {}; }
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/* 첫 로그인 시 사용자 프로필 생성 — INITIAL_ADMIN_EMAIL은 자동 admin
 * 가입과 동시에 members 컬렉션에도 자동 mirror (linkedUid로 연결) */
export async function createUserProfile(user, { orgId, position }) {
  const isInitialAdmin = user.email && user.email.toLowerCase() === INITIAL_ADMIN_EMAIL.toLowerCase();
  const effectiveOrgId = isInitialAdmin ? null : orgId;
  await setDoc(doc(db, 'users', user.uid), {
    email: user.email || null,
    displayName: user.displayName || '익명',
    photoURL: user.photoURL || null,
    orgId: effectiveOrgId,
    role: isInitialAdmin ? 'admin' : 'pending',
    position: position || '',
    joinedAt: serverTimestamp(),
    approvedAt: isInitialAdmin ? serverTimestamp() : null,
    approvedBy: isInitialAdmin ? 'system' : null,
    deletedAt: null,
  }, { merge: true });

  // members auto-mirror — 화자 보정 명부에 동시 등록 (admin은 단체 없으므로 스킵)
  if (effectiveOrgId) {
    try {
      await addDoc(collection(db, 'members'), {
        name: user.displayName || '익명',
        orgId: effectiveOrgId,
        voiceprintRegistered: false,
        linkedUid: user.uid,
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err) { console.warn('Member mirror skipped:', err.message); }
  }
}

/* 본인 프로필 수정 (이름/직책) */
export async function updateMyProfile(uid, { displayName, position }) {
  const patch = { updatedAt: serverTimestamp() };
  if (displayName !== undefined) patch.displayName = displayName;
  if (position !== undefined) patch.position = position;
  await updateDoc(doc(db, 'users', uid), patch);
}

/* 사용자 직책 변경 (admin/manager) */
export async function updateUserPosition(uid, position) {
  await updateDoc(doc(db, 'users', uid), { position, updatedAt: serverTimestamp() });
}

/* admin 전체 사용자 목록 구독 (검색/필터는 클라이언트) */
export function subscribeAllUsers(callback, { includeDeleted = false } = {}) {
  return onSnapshot(usersCol, (snap) => {
    let list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!includeDeleted) list = list.filter(u => !u.deletedAt);
    callback(list);
  });
}

/* 소프트 삭제 (deletedAt 설정 + orgId 해제) */
export async function softDeleteUser(uid) {
  await updateDoc(doc(db, 'users', uid), {
    deletedAt: serverTimestamp(),
    previousOrgId: null, // 캡처 — 필요 시 별도 트랜잭션으로 백업
    orgId: null,
    role: 'deleted',
  });
}

/* 사용자 복구 (admin 전용) */
export async function restoreUser(uid, orgId, role = 'member') {
  await updateDoc(doc(db, 'users', uid), {
    deletedAt: null,
    orgId,
    role,
  });
}

/* pending 사용자 목록 구독 (manager/admin 용) — orgId 필터 */
export function subscribePendingUsers(orgId, callback) {
  if (!orgId) { callback([]); return () => {}; }
  return onSnapshot(query(usersCol, where('orgId', '==', orgId), where('role', '==', 'pending')), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* 전체 pending 사용자 (admin 용) */
export function subscribeAllPendingUsers(callback) {
  return onSnapshot(query(usersCol, where('role', '==', 'pending')), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

/* 사용자 승인 — role을 member로 */
export async function approveUser(uid, approverUid) {
  await updateDoc(doc(db, 'users', uid), {
    role: 'member',
    approvedAt: serverTimestamp(),
    approvedBy: approverUid,
  });
}

/* 사용자 권한 변경 (admin만) */
export async function updateUserRole(uid, role) {
  await updateDoc(doc(db, 'users', uid), { role });
}

/* 회의록 사용 권한 부여/회수 (admin만)
 * - approved → 회의록 작성/녹음/STT/4중 검수 진입 허용
 * - denied(기본) → 회의록 관련 액션 차단 (admin은 필드와 무관하게 항상 허용) */
export async function setMinutesAccess(uid, allowed, approverUid) {
  await updateDoc(doc(db, 'users', uid), {
    minutesAccess: allowed ? 'approved' : 'denied',
    minutesAccessUpdatedAt: serverTimestamp(),
    minutesAccessBy: approverUid || null,
  });
}

/* 사용자 단체 변경 (admin만) */
export async function updateUserOrg(uid, orgId) {
  await updateDoc(doc(db, 'users', uid), { orgId });
}

/* 사용자 삭제 (admin만) */
export async function removeUser(uid) {
  await deleteDoc(doc(db, 'users', uid));
}

/* ===== organizations ===== */
export const orgsCol = collection(db, 'organizations');

export function subscribeOrgs(callback) {
  return onSnapshot(orgsCol, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  });
}

export async function createOrg(data) {
  // data: { name, color, lightColor, description? }
  return await addDoc(orgsCol, {
    ...data,
    isDefault: false,
    createdAt: serverTimestamp(),
  });
}

export async function updateOrg(orgId, data) {
  return await updateDoc(doc(db, 'organizations', orgId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/* 단체 삭제 — 의존 데이터 검사 후 차단 또는 진행
 * - 예약/멤버/사용자 중 하나라도 해당 orgId 참조 시 차단 (사용자에게 정리 요구)
 * - 강제 삭제 옵션은 의도적으로 제거 — 데이터 손실 방지 */
export async function deleteOrg(orgId) {
  // 1. 의존 데이터 검사
  const resSnap = await getDocs(query(reservationsCol, where('orgId', '==', orgId)));
  if (!resSnap.empty) {
    const err = new Error(`해당 단체에 ${resSnap.size}건의 예약이 있습니다. 먼저 정리하거나 다른 단체로 이전하세요.`);
    err.code = 'ORG_HAS_RESERVATIONS';
    throw err;
  }
  const memSnap = await getDocs(query(membersCol, where('orgId', '==', orgId)));
  if (!memSnap.empty) {
    // 멤버 명부는 자동 정리 (단체 종속이라 안전)
    const batch = writeBatch(db);
    memSnap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  const userSnap = await getDocs(query(usersCol, where('orgId', '==', orgId)));
  if (!userSnap.empty) {
    const err = new Error(`해당 단체에 소속된 사용자가 ${userSnap.size}명 있습니다. 다른 단체로 이동시킨 후 삭제하세요.`);
    err.code = 'ORG_HAS_USERS';
    throw err;
  }
  // 2. 모두 통과 시 단체 삭제
  return await deleteDoc(doc(db, 'organizations', orgId));
}

/* ===== reservations ===== */
export const reservationsCol = collection(db, 'reservations');
export const reservationLocksCol = collection(db, 'reservation_locks');
export const meetingMinutesCol = collection(db, 'meeting_minutes');

export function subscribeReservations(callback) {
  return onSnapshot(query(reservationsCol, orderBy('date', 'asc'), orderBy('startTime', 'asc')), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  });
}

/* 시간 겹침 판정 — "HH:mm" 두 구간이 겹치는지 */
function timesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function slugPart(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'room';
}

function timeToMinutesValue(time) {
  const [hours, minutes] = String(time || '00:00').split(':').map(Number);
  return (hours * 60) + minutes;
}

function minutesToTimeKey(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}${String(mins).padStart(2, '0')}`;
}

function reservationLockKeys({ room, date, startTime, endTime }) {
  const start = timeToMinutesValue(startTime);
  const end = timeToMinutesValue(endTime);
  const roomKey = slugPart(room);
  const keys = [];
  for (let cursor = start; cursor < end; cursor += 30) {
    keys.push(`${date}_${roomKey}_${minutesToTimeKey(cursor)}`);
  }
  return keys;
}

function semanticHashForReservation(data) {
  const normalized = `${data.orgId || ''}|${data.title || ''}|${data.date || ''}|${data.room || ''}`
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  return `sem_${Math.abs(hash).toString(36)}`;
}

/* 예약 생성 — reservation_locks 기반 원자적 충돌 방지
 * 같은 room+date의 30분 슬롯 lock 문서가 하나라도 있으면 abort */
export async function createReservation(data, user) {
  return await runTransaction(db, async (tx) => {
    const lockKeys = reservationLockKeys(data);
    if (lockKeys.length === 0) {
      const err = new Error('예약 시간이 올바르지 않습니다.');
      err.code = 'INVALID_RESERVATION_TIME';
      throw err;
    }

    const lockRefs = lockKeys.map((key) => doc(db, 'reservation_locks', key));
    const lockSnaps = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
    for (const lockSnap of lockSnaps) {
      if (lockSnap.exists()) {
        const locked = lockSnap.data();
        const err = new Error(`예약 충돌: ${data.room} ${locked.startTime || ''}-${locked.endTime || ''}에 이미 예약 존재`);
        err.code = 'RESERVATION_CONFLICT';
        err.conflict = locked;
        throw err;
      }
    }

    const newRef = doc(reservationsCol);
    const baseReservation = {
      ...data,
      semanticHash: data.semanticHash || semanticHashForReservation(data),
      isVoiceBooked: data.isVoiceBooked === true,
      stitchSourceId: data.stitchSourceId || null,
      lockKeys,
      creatorUid: user.uid,
      createdAt: serverTimestamp(),
    };

    lockRefs.forEach((lockRef) => {
      tx.set(lockRef, {
        reservationId: newRef.id,
        room: data.room,
        date: data.date,
        startTime: data.startTime,
        endTime: data.endTime,
        orgId: data.orgId,
        creatorUid: user.uid,
        createdAt: serverTimestamp(),
      });
    });

    tx.set(newRef, {
      ...baseReservation,
    });
    return newRef;
  });
}

export async function deleteReservation(resId) {
  const resRef = doc(db, 'reservations', resId);
  const snap = await getDoc(resRef);
  if (!snap.exists()) return;
  const data = snap.data();
  const batch = writeBatch(db);
  batch.delete(resRef);
  (data.lockKeys || []).forEach((key) => batch.delete(doc(db, 'reservation_locks', key)));
  await batch.commit();
}

export async function updateReservation(resId, data) {
  return await runTransaction(db, async (tx) => {
    const resRef = doc(db, 'reservations', resId);
    const snap = await tx.get(resRef);
    if (!snap.exists()) {
      const err = new Error('예약을 찾을 수 없습니다.');
      err.code = 'RESERVATION_NOT_FOUND';
      throw err;
    }

    const previous = snap.data();
    const next = {
      ...previous,
      title: data.title,
      date: data.date,
      startTime: data.startTime,
      endTime: data.endTime,
      room: data.room,
      orgId: data.orgId,
      creatorName: data.creatorName || previous.creatorName || '',
      updatedAt: serverTimestamp(),
    };
    const nextLockKeys = reservationLockKeys(next);
    if (nextLockKeys.length === 0) {
      const err = new Error('예약 시간이 올바르지 않습니다.');
      err.code = 'INVALID_RESERVATION_TIME';
      throw err;
    }

    const previousLockKeys = previous.lockKeys || [];
    const previousKeySet = new Set(previousLockKeys);
    const nextLockRefs = nextLockKeys.map((key) => doc(db, 'reservation_locks', key));
    const nextLockSnaps = await Promise.all(nextLockRefs.map((ref) => tx.get(ref)));
    for (const lockSnap of nextLockSnaps) {
      if (!lockSnap.exists()) continue;
      const locked = lockSnap.data();
      const isOwnExistingLock = previousKeySet.has(lockSnap.id) || locked.reservationId === resId;
      if (!isOwnExistingLock) {
        const err = new Error(`예약 충돌: ${next.room} ${locked.startTime || ''}-${locked.endTime || ''}에 이미 예약 존재`);
        err.code = 'RESERVATION_CONFLICT';
        err.conflict = locked;
        throw err;
      }
    }

    previousLockKeys
      .filter((key) => !nextLockKeys.includes(key))
      .forEach((key) => tx.delete(doc(db, 'reservation_locks', key)));

    nextLockRefs.forEach((lockRef) => {
      tx.set(lockRef, {
        reservationId: resId,
        room: next.room,
        date: next.date,
        startTime: next.startTime,
        endTime: next.endTime,
        orgId: next.orgId,
        creatorUid: previous.creatorUid,
        createdAt: previous.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    tx.update(resRef, {
      title: next.title,
      date: next.date,
      startTime: next.startTime,
      endTime: next.endTime,
      room: next.room,
      orgId: next.orgId,
      creatorName: next.creatorName,
      lockKeys: nextLockKeys,
      semanticHash: semanticHashForReservation(next),
      updatedAt: serverTimestamp(),
    });
    return resRef;
  });
}

function addYears(date, years) {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

export async function createMeetingMinutes(data, user) {
  const now = new Date();

  // 코코: 회의록 저장 직전 서버 PII 마스킹 호출 (실패 시 원본 유지 → 서비스 중단 방지)
  let finalTranscript = data.rawTranscript || [];
  let finalKeywords = data.security?.maskedKeywords || [];
  const wantsMasking = data.security?.isMasked !== false;
  if (wantsMasking && finalTranscript.length > 0) {
    try {
      const result = await maskPIICallable({ dialogues: finalTranscript });
      if (result?.data?.maskedDialogues) {
        finalTranscript = result.data.maskedDialogues;
        finalKeywords = Array.from(new Set([
          ...finalKeywords,
          ...(result.data.uniqueLabels || [])
        ]));
        console.info(`[maskPII] ${result.data.hitCount || 0}건 마스킹 적용 (라벨: ${finalKeywords.join(', ')})`);
      }
    } catch (err) {
      console.warn('[maskPII] 서버 호출 실패 — 원본으로 저장:', err.message);
    }
  }

  return await addDoc(meetingMinutesCol, {
    orgId: data.orgId,
    title: data.title || '회의록',
    createdAt: serverTimestamp(),
    creatorUid: user.uid,
    creatorName: data.creatorName || user.displayName || '담당자',
    location: data.location || '',
    audioFileUrl: data.audioFileUrl || null,
    rawTranscript: finalTranscript,
    agendaItems: data.agendaItems || [],
    aiSummary: data.aiSummary || { brief: '', decisions: [], actionItems: [] },
    attachedPhotos: data.attachedPhotos || [],
    security: {
      isMasked: wantsMasking,
      maskedKeywords: finalKeywords,
      accessLevelRequired: data.security?.accessLevelRequired || 'member',
    },
    isStitched: data.isStitched === true,
    archivePolicy: {
      isArchived: false,
      expireAt: Timestamp.fromDate(addYears(now, 5)),
      storageClass: 'STANDARD',
    },
  });
}

export async function createMeetingMinutesDraft(data, user) {
  const now = new Date();
  return await addDoc(meetingMinutesCol, {
    orgId: data.orgId,
    title: data.title || '실시간 회의록',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    status: 'recording',
    creatorUid: user.uid,
    creatorName: data.creatorName || user.displayName || '담당자',
    location: data.location || '',
    audioFileUrl: null,
    rawTranscript: [],
    agendaItems: data.agendaItems || [],
    aiSummary: { brief: '실시간 기록 중', decisions: [], actionItems: [], confidence: 0 },
    attachedPhotos: [],
    security: {
      isMasked: data.security?.isMasked !== false,
      maskedKeywords: data.security?.maskedKeywords || [],
      accessLevelRequired: data.security?.accessLevelRequired || 'member',
    },
    isStitched: false,
    archivePolicy: {
      isArchived: false,
      expireAt: Timestamp.fromDate(addYears(now, 5)),
      storageClass: 'STANDARD',
    },
  });
}

export async function updateMeetingMinutesTranscript(minutesId, rawTranscript, patch = {}) {
  if (!minutesId) return;
  return await updateDoc(doc(db, 'meeting_minutes', minutesId), {
    rawTranscript,
    updatedAt: serverTimestamp(),
    ...patch,
  });
}

export function subscribeMeetingMinutes(orgId, callback) {
  if (!orgId) {
    callback([]);
    return () => {};
  }
  return onSnapshot(
    query(meetingMinutesCol, where('orgId', '==', orgId), orderBy('createdAt', 'desc')),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
  );
}

/* ===== members ===== */
export const membersCol = collection(db, 'members');

export function subscribeMembers(orgId, callback) {
  if (!orgId) {
    callback([]);
    return () => {};
  }
  return onSnapshot(query(membersCol, where('orgId', '==', orgId)), (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    callback(list);
  });
}

export async function createMember(data, user) {
  return await addDoc(membersCol, {
    ...data,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });
}

export async function deleteMember(memberId) {
  return await deleteDoc(doc(db, 'members', memberId));
}


/* ============================================================
 *  Cloud Functions — maskPII (코코 PII 백엔드화)
 *  asia-northeast3 리전 / callable
 *  실패 시 throws — 호출부에서 try/catch + 클라이언트 1차 마스킹 fallback 권장
 * ============================================================ */
const functions = getFunctions(app, 'asia-northeast3');
const maskPIICallable = httpsCallable(functions, 'maskPII');
const healthCheckCallable = httpsCallable(functions, 'healthCheck');

export async function maskPII({ text, dialogues, minutesId } = {}) {
  const { data } = await maskPIICallable({ text, dialogues, minutesId });
  return data;
}

export async function functionsHealthCheck() {
  const { data } = await healthCheckCallable();
  return data;
}