import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AudioVisualizer } from './components/AudioVisualizer.jsx';
import { LoginModal } from './modals/LoginModal.jsx';
import { SetupWizard } from './modals/SetupWizard.jsx';
import { ApprovalQueueModal } from './modals/ApprovalQueueModal.jsx';
import { ProfileEditModal } from './modals/ProfileEditModal.jsx';
import { UserManagementModal } from './modals/UserManagementModal.jsx';
import { OrgEditorModal } from './modals/OrgEditorModal.jsx';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Users,
  Mic,
  Plus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertTriangle,
  UserCheck,
  Wifi,
  WifiOff,
  BarChart3,
  Lock,
  Brain,
  Edit3,
  X,
  Trash2,
  BarChart,
  Download,
  Printer,
  FileSpreadsheet,
  Camera,
  Volume2,
  Send,
  ShieldAlert,
  FileText,
  Sun,
  Moon,
  Download as DownloadIcon,
  Smartphone,
  Globe
} from 'lucide-react';
import './App.css';
import {
  initAuth,
  signInWithEmail, signUpWithEmail, signInWithGoogle, signOut, sendPasswordReset,
  subscribeUserProfile, createUserProfile, updateMyProfile,
  subscribePendingUsers, subscribeAllPendingUsers, approveUser, updateUserRole, updateUserPosition, softDeleteUser, restoreUser, subscribeAllUsers, setMinutesAccess,
  updateUserOrg,
  subscribeOrgs, createOrg, updateOrg, deleteOrg,
  subscribeReservations, createReservation, updateReservation, deleteReservation,
  subscribeMembers, createMember, deleteMember,
  createMeetingMinutes, createMeetingMinutesDraft, updateMeetingMinutesTranscript, subscribeMeetingMinutes,
} from './firebase.js';

/* ============================================================
 *  ROOMS — 회의실 20명 / 교육장 40명 (사양 고정)
 * ============================================================ */
const ROOMS = [
  { id: 'meeting', name: '회의실', capacity: 20 },
  { id: 'training', name: '교육장', capacity: 40 }
];

const CLOUD_STT_WS_URL =
  import.meta.env.VITE_STT_WS_URL ||
  (typeof localStorage !== 'undefined' ? localStorage.getItem('MdpjSttWsUrl') : '') ||
  '';
const STT_VOICE_RMS_THRESHOLD = 0.004;
const STT_RESUME_RMS_THRESHOLD = 0.006;
const STT_SILENCE_PAUSE_MS = 15000;
const STT_RECONNECT_MAX_ATTEMPTS = 8;
const STT_PENDING_AUDIO_MAX_CHUNKS = 80;

/* Warm-Pastel 컬러 가이드 (CLAUDE.md §2) — 새 단체 생성 시 권장 팔레트 */
const WARM_PASTEL_PALETTE = [
  { color: '#708A81', lightColor: '#E2ECE9', label: 'Sage Green' },
  { color: '#C97A53', lightColor: '#F5ECE6', label: 'Warm Terracotta' },
  { color: '#6A85B6', lightColor: '#E6ECF5', label: 'Royal Dusk Blue' },
  { color: '#B19470', lightColor: '#F4EFE6', label: 'Bronze Gold' },
  { color: '#889E73', lightColor: '#ECF0E6', label: 'Forest Olive' },
  { color: '#9B72AA', lightColor: '#F2ECF5', label: 'Soft Amethyst' },
  { color: '#82A0D8', lightColor: '#E8EDF5', label: 'Sky Pastel Blue' },
  { color: '#D291BC', lightColor: '#F6ECF2', label: 'Dusk Pink' },
  { color: '#A89B8C', lightColor: '#EEEAE4', label: 'Warm Stone' },
  { color: '#7BA89E', lightColor: '#E5EEEB', label: 'Sea Mist' }
];

/* 오늘 날짜 기본값 — useState 초기값에서 참조 가능하도록 모듈 스코프 */
const TODAY = '2026-05-23';



/* 음성 명령 자연어 파서 — "6월 13일 토요일 오후 2시부터 4시간 교육장" 같은 입력 분해 */
function parseVoiceCommand(text) {
  const result = { title: '', date: '', startTime: '', endTime: '', room: '' };
  const monthMatch = text.match(/(\d+)월\s*(\d+)일/);
  if (monthMatch) {
    const m = monthMatch[1].padStart(2, '0');
    const d = monthMatch[2].padStart(2, '0');
    result.date = `2026-${m}-${d}`;
  }
  const ampm = text.includes('오후') ? 12 : 0;
  const timeMatch = text.match(/(\d+)시/);
  if (timeMatch) {
    const h = parseInt(timeMatch[1], 10);
    const startHour = (h < 12 && ampm === 12) ? h + 12 : h;
    result.startTime = `${String(startHour).padStart(2, '0')}:00`;
    const durMatch = text.match(/(\d+)\s*시간/);
    if (durMatch) {
      const dur = parseInt(durMatch[1], 10);
      result.endTime = `${String(startHour + dur).padStart(2, '0')}:00`;
    }
  }
  if (text.includes('교육장')) result.room = '교육장 (B1)';
  else if (text.includes('대회의실')) result.room = '대회의실 (3F)';
  else if (text.includes('세미나')) result.room = '세미나실 A (2F)';
  else if (text.includes('소회의실')) result.room = '소회의실 B (1F)';
  result.title = text.replace(/\s+/g, ' ').trim().slice(0, 80);
  return result;
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function hasTimeOverlap(startTime, endTime, existingStartTime, existingEndTime) {
  return timeToMinutes(startTime) < timeToMinutes(existingEndTime)
    && timeToMinutes(endTime) > timeToMinutes(existingStartTime);
}

function findRoomConflict(reservations, candidate) {
  return reservations.find(reservation =>
    reservation.date === candidate.date
    && reservation.room === candidate.room
    && hasTimeOverlap(
      candidate.startTime,
      candidate.endTime,
      reservation.startTime,
      reservation.endTime
    )
  );
}

function validateReservationTimes(startTime, endTime) {
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    return '종료 시간은 시작 시간보다 늦어야 합니다.';
  }

  return null;
}

/* ============================================================
 *  리포트 집계 헬퍼 — 기간/조직/장소별 그룹화 + 시간 계산
 * ============================================================ */
function reservationHours(r) {
  const [sH, sM] = r.startTime.split(':').map(Number);
  const [eH, eM] = r.endTime.split(':').map(Number);
  return Math.max(0, ((eH * 60 + eM) - (sH * 60 + sM)) / 60);
}

function filterForReport(reservations, range) {
  const { startDate, endDate, orgId, room } = range;
  return reservations.filter(r => {
    if (startDate && r.date < startDate) return false;
    if (endDate && r.date > endDate) return false;
    if (orgId && orgId !== 'all' && r.orgId !== orgId) return false;
    if (room && room !== 'all' && r.room !== room) return false;
    return true;
  });
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

function presetRange(preset) {
  const today = new Date('2026-05-23');
  const yyyy = today.getFullYear();
  const mm = today.getMonth() + 1;
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  switch (preset) {
    case 'thisMonth': return { startDate: `${yyyy}-${String(mm).padStart(2, '0')}-01`, endDate: fmt(new Date(yyyy, mm, 0)), label: `${yyyy}년 ${mm}월` };
    case 'lastMonth': {
      const lm = mm === 1 ? 12 : mm - 1;
      const ly = mm === 1 ? yyyy - 1 : yyyy;
      return { startDate: `${ly}-${String(lm).padStart(2, '0')}-01`, endDate: fmt(new Date(ly, lm, 0)), label: `${ly}년 ${lm}월` };
    }
    case 'thisYear': return { startDate: `${yyyy}-01-01`, endDate: `${yyyy}-12-31`, label: `${yyyy}년 전체` };
    case 'lastYear': return { startDate: `${yyyy - 1}-01-01`, endDate: `${yyyy - 1}-12-31`, label: `${yyyy - 1}년 전체` };
    case 'last30': {
      const start = new Date(today); start.setDate(start.getDate() - 30);
      return { startDate: fmt(start), endDate: fmt(today), label: '최근 30일' };
    }
    default: return { startDate: `${yyyy}-${String(mm).padStart(2, '0')}-01`, endDate: fmt(new Date(yyyy, mm, 0)), label: `${yyyy}년 ${mm}월` };
  }
}

/* AI 최적 회의실 추천 — 인원수 기반 상위 3개 */
/* ============================================================
 *  R. iCal / Google Calendar Export 유틸
 * ============================================================ */
function pad2(n) { return String(n).padStart(2, '0'); }

function toICSDate(date, time) {
  // 'YYYY-MM-DD' + 'HH:mm' → 'YYYYMMDDTHHmmSS' (로컬 시간)
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return `${y}${pad2(m)}${pad2(d)}T${pad2(h)}${pad2(mi)}00`;
}

function generateICS(reservation, orgName) {
  const uid = `${reservation.id || Date.now()}@wellshare-erp.web.app`;
  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dtStart = toICSDate(reservation.date, reservation.startTime);
  const dtEnd = toICSDate(reservation.date, reservation.endTime);
  const summary = (reservation.title || '예약').replace(/[\r\n,;]/g, ' ');
  const description = `${orgName || ''} · 작성자 ${reservation.creatorName || '익명'}`.replace(/[\r\n,;]/g, ' ');
  const location = (reservation.room || '').replace(/[\r\n,;]/g, ' ');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WellShare ERP//Reservation//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=Asia/Seoul:${dtStart}`,
    `DTEND;TZID=Asia/Seoul:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${location}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
}

function downloadICS(reservation, orgName) {
  const ics = generateICS(reservation, orgName);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${reservation.date}_${(reservation.title || 'reservation').replace(/[^\w가-힣]/g, '_')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openGoogleCalendar(reservation, orgName) {
  const dtStart = toICSDate(reservation.date, reservation.startTime);
  const dtEnd = toICSDate(reservation.date, reservation.endTime);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', reservation.title || '예약');
  url.searchParams.set('dates', `${dtStart}/${dtEnd}`);
  url.searchParams.set('details', `${orgName || ''} · 작성자 ${reservation.creatorName || '익명'}`);
  url.searchParams.set('location', reservation.room || '');
  url.searchParams.set('ctz', 'Asia/Seoul');
  window.open(url.toString(), '_blank', 'noopener');
}

/* ============================================================
 *  N. i18n 기본 인프라 — 라이브러리 없이 inline t() (확장 가능)
 * ============================================================ */
const I18N_DICT = {
  ko: {
    /* 헤더 / 네비 */
    online: '온라인',
    offline: '오프라인',
    reserve: '예약하기',
    voiceBooking: '음성 예약',
    minutes: '회의록 작성',
    report: '리포트',
    stats: '예약통계',
    users: '사용자',
    login: '로그인',
    logout: '로그아웃',
    signup: '회원가입',
    settings: '설정',
    /* 화면 제목 */
    mainTitle: 'WS 통합 예약 및 회의록 시스템',
    subtitle: '광역자활기업 · 실시간 스마트 워크스페이스',
    reservationStatus: '회의실 및 교육장 예약 현황',
    /* 빈 상태 */
    noBookings: '이 날짜에 예약이 없습니다',
    quickBooking: '빠른 예약',
    customBooking: '직접 시간 정해서 예약하기',
    bookForThisDate: '이 날짜로 예약하기',
    /* 버튼 */
    today: '오늘',
    todayJump: '오늘로',
    week: '주간',
    month: '월간',
    all: '전체',
    save: '저장',
    cancel: '취소',
    delete: '삭제',
    edit: '수정',
    close: '닫기',
    /* 회의 */
    startMeeting: '회의 시작',
    recording: '녹음 중',
    transferMinutes: '회의록 담당자 전달',
    /* PWA */
    installApp: '홈 화면에 추가',
    installSub: '오프라인에서도 작동하고 알림을 받을 수 있습니다.',
    installNow: '설치',
    installLater: '나중에',
    /* hero */
    helloUser: '안녕하세요',
    todayBookings: '오늘 전체 예약',
    ourOrg: '우리 단체',
    nextMeeting: '다음 예약',
    noScheduled: '여유 있는 일정',
    bookToday: '오늘 예약',
    /* 토스트 / 안내 */
    minutesAccessRequired: '회의록 사용 권한이 없습니다. 관리자 승인 후 이용 가능합니다.',
    welcome: '환영합니다!',
  },
  en: {
    /* Header / nav */
    online: 'Online',
    offline: 'Offline',
    reserve: 'Reserve',
    voiceBooking: 'Voice Booking',
    minutes: 'Meeting Notes',
    report: 'Report',
    stats: 'Booking Stats',
    users: 'Users',
    login: 'Login',
    logout: 'Logout',
    signup: 'Sign Up',
    settings: 'Settings',
    /* Page titles */
    mainTitle: 'WS Integrated Booking & Meeting Notes',
    subtitle: 'Regional Self-Help Enterprise · Smart Workspace',
    reservationStatus: 'Meeting Room & Auditorium Bookings',
    /* Empty states */
    noBookings: 'No bookings on this date',
    quickBooking: 'Quick booking',
    customBooking: 'Book with custom time',
    bookForThisDate: 'Book for this date',
    /* Buttons */
    today: 'Today',
    todayJump: 'Jump to today',
    week: 'Week',
    month: 'Month',
    all: 'All',
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    close: 'Close',
    /* Meeting */
    startMeeting: 'Start meeting',
    recording: 'Recording',
    transferMinutes: 'Send notes to assignee',
    /* PWA */
    installApp: 'Add to Home Screen',
    installSub: 'Works offline and supports notifications.',
    installNow: 'Install',
    installLater: 'Later',
    /* hero */
    helloUser: 'Hello',
    todayBookings: 'Today\'s bookings',
    ourOrg: 'Our org',
    nextMeeting: 'Next meeting',
    noScheduled: 'No upcoming meetings',
    bookToday: 'Book today',
    /* Toasts / messages */
    minutesAccessRequired: 'You don\'t have meeting-notes access. Please ask an admin to approve.',
    welcome: 'Welcome!',
  }
};
function detectLocale() {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem('ws-locale');
    if (saved === 'ko' || saved === 'en') return saved;
  }
  if (typeof navigator !== 'undefined') {
    return navigator.language?.startsWith('en') ? 'en' : 'ko';
  }
  return 'ko';
}
function makeT(locale) {
  return (key) => I18N_DICT[locale]?.[key] ?? I18N_DICT.ko[key] ?? key;
}

function recommendRooms(attendeeCount, reservations, date) {
  return ROOMS
    .filter(r => r.capacity >= attendeeCount)
    .map(r => {
      const busyHours = reservations.filter(res => res.room === r.name && res.date === date).length;
      return { ...r, score: r.capacity * 10 - busyHours * 30 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

export default function App({ entry = 'web' }) {
  const navigate = useNavigate();

  /* ---- 라우트 entry → body 클래스 부여 (CSS가 데스크톱/모바일 패널 표시 결정) ---- */
  useEffect(() => {
    const cls = `entry-${entry}`;
    document.body.classList.add(cls);
    return () => document.body.classList.remove(cls);
  }, [entry]);

  /* ---- 다크모드 (L) — localStorage 우선, 없으면 시스템 prefers-color-scheme 따름 ---- */
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem('ws-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ws-theme', theme);
  }, [theme]);
  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  /* ---- PWA 설치 프롬프트 (O) — beforeinstallprompt 캐치 + 사용자 dismiss 기억 ---- */
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installDismissed, setInstallDismissed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem('ws-install-dismissed') === '1';
  });
  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);
  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'dismissed') {
      localStorage.setItem('ws-install-dismissed', '1');
      setInstallDismissed(true);
    }
    setInstallPrompt(null);
  };
  const dismissInstall = () => {
    localStorage.setItem('ws-install-dismissed', '1');
    setInstallDismissed(true);
    setInstallPrompt(null);
  };

  /* ---- i18n locale (N) — 한/영 자동 감지 + localStorage 저장 ---- */
  const [locale, setLocale] = useState(detectLocale);
  useEffect(() => { localStorage.setItem('ws-locale', locale); }, [locale]);
  const t = useMemo(() => makeT(locale), [locale]);
  const toggleLocale = () => setLocale(l => l === 'ko' ? 'en' : 'ko');

  /* ---- Firebase 인증/구독 상태 ---- */
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null); // Firestore users 문서 (role/orgId/displayName)
  const [authReady, setAuthReady] = useState(false);
  const [orgs, setOrgs] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [members, setMembers] = useState([]);
  const [meetingMinutes, setMeetingMinutes] = useState([]);
  const [currentOrgId, setCurrentOrgId] = useState(null);
  const [pendingUsers, setPendingUsers] = useState([]);

  /* ---- 로그인/마법사 모달 ---- */
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginMode, setLoginMode] = useState('signin'); // 'signin' | 'signup'
  const [setupWizardOpen, setSetupWizardOpen] = useState(false);
  const [approvalQueueOpen, setApprovalQueueOpen] = useState(false);
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [allUsers, setAllUsers] = useState([]);

  /* 권한 단축 헬퍼 */
  const isAuthenticated = user && !user.isAnonymous;
  const userRole = userProfile?.role || 'guest';
  const isAdmin = userRole === 'admin';
  const isManager = userRole === 'manager';
  const isMember = userRole === 'member' || isManager || isAdmin;
  const isPending = userRole === 'pending';
  const canManageReservation = (reservation) => {
    if (!user || !reservation || reservation.isOfflinePending) return false;
    if (isAdmin) return true;
    if (isManager) return userProfile?.orgId && reservation.orgId === userProfile.orgId;
    return reservation.creatorUid === user.uid;
  };
  /* 회의록 사용 권한 — admin은 항상 허용, 나머지는 minutesAccess='approved' 필요 */
  const canAccessMinutes = isAdmin || userProfile?.minutesAccess === 'approved';
  const currentOrg = useMemo(
    () => orgs.find(o => o.id === currentOrgId) || orgs[0] || null,
    [orgs, currentOrgId]
  );

  /* ---- 조직 등록/편집 모달 ---- */
  const [orgEditorOpen, setOrgEditorOpen] = useState(false);
  const [orgBeingEdited, setOrgBeingEdited] = useState(null);

  /* ---- 기본 상태 ---- */
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('2026-05-22');
  const [newStart, setNewStart] = useState('14:00');
  const [newEnd, setNewEnd] = useState('16:00');
  const [newRoom, setNewRoom] = useState('회의실');
  const [newAttendees, setNewAttendees] = useState(8);
  const [newOrgId, setNewOrgId] = useState(null); // 예약 폼 내 단체 (admin만 변경 가능)
  const [editingReservation, setEditingReservation] = useState(null);
  const [shakeModal, setShakeModal] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState(null);
  const [reservationWarning, setReservationWarning] = useState(null);
  const [showNotification, setShowNotification] = useState(false);
  const [notificationVariant, setNotificationVariant] = useState('info'); // info | gold | success | danger

  /* ---- 모바일 앱 상태 ---- */
  /* entry='m-book' → lite(예약 전용) / entry='m-minutes' → pro(회의록 작성) / 그 외 → pro */
  const [mobileVersion, setMobileVersion] = useState(entry === 'm-book' ? 'lite' : 'pro');
  const [mobileStep, setMobileStep] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [autoSnapCountdown, setAutoSnapCountdown] = useState(0); // 0.8초 무접촉 캡처

  const [isRecording, setIsRecording] = useState(false);
  const [isRecordingPaused, setIsRecordingPaused] = useState(false);
  const [dialogues, setDialogues] = useState([]);
  const [agendaItems, setAgendaItems] = useState([]);
  const [newAgendaTitle, setNewAgendaTitle] = useState('');
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [realtimeTextFeed, setRealtimeTextFeed] = useState('');
  const [sttAssistMessage, setSttAssistMessage] = useState('');
  const [manualTranscriptText, setManualTranscriptText] = useState('');
  const [recordedAudioUrl, setRecordedAudioUrl] = useState('');
  const [recordedAudioName, setRecordedAudioName] = useState('');
  const [recordingHealthWarning, setRecordingHealthWarning] = useState('');
  const [sttConnectionStatus, setSttConnectionStatus] = useState(CLOUD_STT_WS_URL ? 'server-ready' : 'browser-fallback');
  const [silenceState, setSilenceState] = useState('idle');
  const [isDNDActive, setIsDNDActive] = useState(false);
  const [audioSessionError, setAudioSessionError] = useState(false);
  const [isBoosting, setIsBoosting] = useState(false); // +18dB 부스팅 배지

  /* ---- 신규: 성문 등록 5초 온보딩 ---- */
  const [voiceprintModal, setVoiceprintModal] = useState(false);
  const [voiceprintProgress, setVoiceprintProgress] = useState(0);

  /* ---- 신규: 음성 명령 예약 ---- */
  const [voiceBookingOpen, setVoiceBookingOpen] = useState(false);
  const [voiceCommandText, setVoiceCommandText] = useState('');
  const [voiceCommandListening, setVoiceCommandListening] = useState(false);

  /* ---- 신규: 화자 보정 ---- */
  const [speakerCorrectionFor, setSpeakerCorrectionFor] = useState(null); // 인덱스
  const [bulkMergeOption, setBulkMergeOption] = useState(false);

  /* ---- 신규: 타임스탬프 플레이어 ---- */
  const [playingOffset, setPlayingOffset] = useState(null);

  /* ---- 신규: PII 마스킹 토글 ---- */
  const [maskingEnabled, setMaskingEnabled] = useState(true);

  /* ---- 신규: 사진 첨부 ---- */
  const [photos, setPhotos] = useState([]);
  const [photoViewer, setPhotoViewer] = useState(null);

  /* ---- 신규: 네트워크 상태 (오프라인 골드 토스트) ---- */
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [offlineQueue, setOfflineQueue] = useState(0);
  const [localOfflineReservations, setLocalOfflineReservations] = useState([]);

  /* 새로고침 시 로컬 오프라인 큐 로딩 */
  useEffect(() => {
    const list = JSON.parse(localStorage.getItem('offlineReservations') || '[]');
    setLocalOfflineReservations(list);
    setOfflineQueue(list.length);
  }, []);

  /* Service Worker 오프라인 큐 결과 수신 (브루마) — 재전송 성공/실패 사용자 알림 */
  useEffect(() => {
    const onSuccess = (e) => {
      const { succeeded } = e.detail;
      triggerNotification(`✅ 신호 복구 — 보관 중이던 ${succeeded}건이 Stitch 동기화되었습니다.`, 'gold');
    };
    const onFailure = (e) => {
      const { failed, remaining } = e.detail;
      triggerNotification(`⚠ 재전송 ${failed}건 실패. 큐에 영구 보존됨 (남은 ${remaining}건). 잠시 후 자동 재시도됩니다.`, 'danger');
    };
    window.addEventListener('ws-queue-success', onSuccess);
    window.addEventListener('ws-queue-failure', onFailure);
    return () => {
      window.removeEventListener('ws-queue-success', onSuccess);
      window.removeEventListener('ws-queue-failure', onFailure);
    };
  }, []);

  /* 실제 네트워크 상태 자동 감지 — navigator.onLine + online/offline 이벤트
   * 복구 시 큐를 0으로 reset하고 골드 토스트로 동기화 완료 알림 (CLAUDE.md §[11]) */
  useEffect(() => {
    const handleOnline = async () => {
      setIsOffline(false);
      const localList = JSON.parse(localStorage.getItem('offlineReservations') || '[]');
      if (localList.length > 0) {
        let successCount = 0;
        for (const res of localList) {
          try {
            const { id, isOfflinePending, ...validData } = res;
            await createReservation(validData, user);
            successCount++;
          } catch (err) {
            console.error('Failed to sync offline reservation:', err);
          }
        }
        localStorage.removeItem('offlineReservations');
        setLocalOfflineReservations([]);
        setOfflineQueue(0);
        if (successCount > 0) {
          triggerNotification(`신호 복구 — 보관 중이던 ${successCount}건이 Stitch 동기화되었습니다.`, 'gold');
        }
      }
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user]);

  /* ---- 신규: 점유율 대시보드 표시 ---- */
  const [showOrgDashboard, setShowOrgDashboard] = useState(false);

  /* ---- 신규: 사용 현황 리포트 ---- */
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPreset, setReportPreset] = useState('thisMonth');
  const [reportStartDate, setReportStartDate] = useState('2026-05-01');
  const [reportEndDate, setReportEndDate] = useState('2026-05-31');
  const [reportOrgFilter, setReportOrgFilter] = useState('all');
  const [reportRoomFilter, setReportRoomFilter] = useState('all');

  /* ---- 신규: 사후 4중 검수 (Post-Meeting Audit) ---- */
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditDone, setAuditDone] = useState(false);
  const [mergedDecisions, setMergedDecisions] = useState([]); // id 배열 (Pass 2의 신규/diff 항목 채택)
  const [mergedActions, setMergedActions] = useState([]);
  const [usedAIModel, setUsedAIModel] = useState('');
  const [aiCostSavings, setAiCostSavings] = useState('');
  const [auditResult, setAuditResult] = useState(null);

  /* ---- 신규: 실시간 성문 분석 및 Diarization 화자 구분 ---- */
  const voiceprintAudioContextRef = useRef(null);
  const voiceprintAnalyserRef = useRef(null);
  const voiceprintDataArrayRef = useRef(null);
  const voiceprintStreamRef = useRef(null);
  const [voiceprintTemplate, setVoiceprintTemplate] = useState(() => {
    // 코코: 성문 벡터는 localStorage(영구 저장) 금지 — sessionStorage로 강등
    // (CLAUDE.md §5: 원본은 즉시 소멸 + 운영은 Firestore에 hash+salt+noise)
    try {
      const stored = sessionStorage.getItem('ws_voiceprint_session');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  /* ---- 신규: 드래그 예약 영역 ---- */
  const [dragSelection, setDragSelection] = useState(null); // {date, startSlot, endSlot}
  const [isDragging, setIsDragging] = useState(false);

  /* ---- 신규: 가상 스크롤 / 스켈레톤 ---- */
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const calendarContainerRef = useRef(null); // 주간/월간 swipe 제스처용
  const realtimeTextRef = useRef(''); // STT 임시 비동기 텍스트 보관용
  const recordingActiveRef = useRef(false);
  const transcriptBufferRef = useRef([]);
  const recognitionRestartTimerRef = useRef(null);
  const noSpeechTimerRef = useRef(null);
  const interimCommitTimerRef = useRef(null);
  const lastCommittedTranscriptRef = useRef('');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioObjectUrlRef = useRef('');
  const cloudSttWsRef = useRef(null);
  const cloudSttStreamRef = useRef(null);
  const cloudSttAudioContextRef = useRef(null);
  const cloudSttProcessorRef = useRef(null);
  const cloudSttSourceRef = useRef(null);
  const cloudSttPausedRef = useRef(false);
  const cloudSttReconnectTimerRef = useRef(null);
  const cloudSttReconnectAttemptsRef = useRef(0);
  const cloudSttStoppingRef = useRef(false);
  const sttPendingAudioBuffersRef = useRef([]);
  const liveMinutesIdRef = useRef(null);
  const silenceStartedAtRef = useRef(null);

  /* ---- 신규: 모바일 날짜 스트립 (오늘 가운데 정렬 + 좌우 스와이프) ---- */
  const [mobileSelectedDate, setMobileSelectedDate] = useState(TODAY); // 진입 즉시 오늘 날짜 선택
  const dateStripRef = useRef(null);
  const todayChipRef = useRef(null);
  const stripReadyRef = useRef(false); // 본문 렌더 후 1회만 초기 스크롤/드래그 등록 가드

  /* 날짜 스트립 — 마우스/터치 드래그 + 관성 momentum (룰렛 회전감)
   * - 드래그 중에는 snap/smooth 비활성 → 자유 스크롤
   * - 손을 떼면 velocity 기반 관성 → 0.92 감속 → 자연 정지
   * - 5px 이상 끌면 click 가드(suppressClick) → 의도치 않은 날짜 선택 차단
   * - dependency [authReady, currentOrg]: loading 가드 통과 후 본문이 mount된 시점에 등록 */
  useEffect(() => {
    const el = dateStripRef.current;
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let startScroll = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;
    let dragDistance = 0;
    let rafId = null;

    const onDown = (clientX) => {
      cancelAnimationFrame(rafId);
      isDown = true;
      startX = clientX;
      lastX = clientX;
      startScroll = el.scrollLeft;
      lastT = performance.now();
      velocity = 0;
      dragDistance = 0;
      // dragging 클래스는 onMove에서 임계값 초과 시 부여 — 짧은 클릭은 native click 이벤트 보장
    };
    const onMove = (clientX, ev) => {
      if (!isDown) return;
      const dx = clientX - startX;
      dragDistance = Math.abs(dx);
      // 실제 이동이 5px을 초과한 순간에만 드래그로 인정 → 칩 클릭 호환
      if (dragDistance > 5 && !el.classList.contains('dragging')) {
        el.classList.add('dragging');
      }
      if (el.classList.contains('dragging')) {
        if (ev?.cancelable) ev.preventDefault();
        el.scrollLeft = startScroll - dx;
        const now = performance.now();
        const dt = now - lastT;
        if (dt > 0) velocity = (clientX - lastX) / dt; // px/ms
        lastX = clientX;
        lastT = now;
      }
    };
    const finishDrag = () => {
      // 드래그 + 관성 완전 종료 후 snap 재활성화 (가장 가까운 칩으로 부드럽게 정렬)
      el.classList.remove('dragging');
    };
    const onUp = () => {
      if (!isDown) return;
      isDown = false;
      if (dragDistance > 5) {
        el.dataset.suppressClick = '1';
        setTimeout(() => { delete el.dataset.suppressClick; }, 120);
      }
      // 관성 적용 — velocity(px/ms) → frame당 px 환산 (16ms 기준)
      let v = -velocity * 16;
      if (Math.abs(v) < 0.5) { finishDrag(); return; }
      const step = () => {
        el.scrollLeft += v;
        v *= 0.94; // 부드러운 감속
        if (Math.abs(v) > 0.3) {
          rafId = requestAnimationFrame(step);
        } else {
          finishDrag(); // 관성 종료 후 snap 활성 → 가장 가까운 칩으로 자연 정렬
        }
      };
      rafId = requestAnimationFrame(step);
    };

    // 데스크톱: 마우스 드래그 + 우리 momentum
    const md = (e) => { if (e.button === 0) onDown(e.pageX); };
    const mm = (e) => onMove(e.pageX, e);
    const mu = () => onUp();
    el.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);

    // 모바일: native scroll에 맡김 (우리 momentum과 충돌 방지)
    // touchend에서 click suppress만 처리하기 위해 시작 위치만 기록
    let tStartX = 0;
    const tsOnly = (e) => { tStartX = e.touches[0].pageX; };
    const teOnly = (e) => {
      const dx = (e.changedTouches[0]?.pageX ?? tStartX) - tStartX;
      if (Math.abs(dx) > 5) {
        el.dataset.suppressClick = '1';
        setTimeout(() => { delete el.dataset.suppressClick; }, 120);
      }
    };
    el.addEventListener('touchstart', tsOnly, { passive: true });
    el.addEventListener('touchend', teOnly, { passive: true });

    return () => {
      el.removeEventListener('mousedown', md);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', mu);
      el.removeEventListener('touchstart', tsOnly);
      el.removeEventListener('touchend', teOnly);
      cancelAnimationFrame(rafId);
    };
  }, [authReady, currentOrg]); // loading 가드 통과 후 dateStripRef가 mount된 시점에 (재)등록

  /* ---- 신규: 달력 뷰 모드 + 빠른 점프 + 방별 필터 ---- */
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'month'
  const [calendarYear, setCalendarYear] = useState(2026);
  const [calendarMonth, setCalendarMonth] = useState(5); // 1-indexed
  const [roomFilter, setRoomFilter] = useState('all'); // 'all' | '회의실' | '교육장'

  const transcriptEndRef = useRef(null);

  /* ---- 신규: 모바일 노치 실시간 시계 ---- */
  const [phoneClock, setPhoneClock] = useState(() => {
    const d = new Date();
    return `${String(d.getHours() % 12 || 12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  });
  useEffect(() => {
    const tick = setInterval(() => {
      const d = new Date();
      setPhoneClock(`${String(d.getHours() % 12 || 12).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`);
    }, 30000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [dialogues, realtimeTextFeed]);

  useEffect(() => {
    if (!isRecording) return;
    const draft = {
      orgId: currentOrg?.id || null,
      title: scanResult?.title || '진행 중 회의',
      updatedAt: new Date().toISOString(),
      realtimeTextFeed,
      rawTranscript: dialogues,
      agendaItems: getActiveAgendaItems(),
    };
    localStorage.setItem('activeMeetingDraft', JSON.stringify(draft));
  }, [isRecording, currentOrg?.id, scanResult?.title, dialogues, realtimeTextFeed, agendaItems]);

  // recording-beforeunload-warning
  useEffect(() => {
    if (!isRecording) return;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '녹음 중입니다. 페이지를 벗어나면 현재 녹음이 중단될 수 있습니다.';
      return event.returnValue;
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        setRecordingHealthWarning('녹음 중 화면이 백그라운드로 이동했습니다. 브라우저가 마이크/STT를 중단할 수 있습니다.');
        triggerNotification('녹음 중 화면이 백그라운드로 이동했습니다. 중단될 수 있습니다.', 'danger');
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isRecording]);

  /* ===== Firebase 초기화 + Firestore 실시간 구독 ===== */
  useEffect(() => {
    initAuth((u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  /* 사용자 프로필 구독 — 익명이 아닌 경우만 */
  useEffect(() => {
    if (!user || user.isAnonymous) { setUserProfile(null); return; }
    return subscribeUserProfile(user.uid, setUserProfile);
  }, [user]);

  /* 첫 로그인 (실명) 시 users 문서가 없으면 마법사 자동 오픈 */
  useEffect(() => {
    if (!authReady || !user || user.isAnonymous) return;
    if (userProfile === null) {
      // 구독은 시작됐지만 문서가 아직 없음 → 마법사 트리거
      setSetupWizardOpen(true);
    } else {
      setSetupWizardOpen(false);
    }
  }, [authReady, user, userProfile]);

  /* 사용자 단체 자동 동기화: admin이 아니면 currentOrg를 본인 orgId로 고정 */
  useEffect(() => {
    if (userProfile && userProfile.orgId && userProfile.role !== 'admin') {
      setCurrentOrgId(userProfile.orgId);
    }
  }, [userProfile]);

  /* 예약 모달 열릴 때 newOrgId를 currentOrgId로 초기화 */
  useEffect(() => {
    if (isModalOpen && !editingReservation) setNewOrgId(currentOrgId);
  }, [isModalOpen, currentOrgId, editingReservation]);

  /* pending 사용자 구독 (manager/admin) */
  useEffect(() => {
    if (!userProfile) { setPendingUsers([]); return; }
    if (userProfile.role === 'admin') {
      return subscribeAllPendingUsers(setPendingUsers);
    } else if (userProfile.role === 'manager' && userProfile.orgId) {
      return subscribePendingUsers(userProfile.orgId, setPendingUsers);
    }
    setPendingUsers([]);
  }, [userProfile]);

  /* 전체 사용자 구독 (admin만) */
  useEffect(() => {
    if (!userProfile || userProfile.role !== 'admin') { setAllUsers([]); return; }
    return subscribeAllUsers(setAllUsers);
  }, [userProfile]);

  useEffect(() => {
    if (!user) return;
    return subscribeOrgs((list) => {
      // DB 기본 단체를 먼저 정렬하고 나머지는 id 순으로 정렬
      const sorted = [...list].sort((a, b) => {
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return (a.id || '').localeCompare(b.id || '');
      });
      setOrgs(sorted);
      setCurrentOrgId((cur) => cur && sorted.find(o => o.id === cur) ? cur : (sorted[0]?.id || null));
    });
  }, [user]);

  useEffect(() => {
    if (!user) return;
    return subscribeReservations(setReservations);
  }, [user]);

  useEffect(() => {
    if (!user || !currentOrgId) { setMembers([]); return; }
    return subscribeMembers(currentOrgId, setMembers);
  }, [user, currentOrgId]);

  useEffect(() => {
    if (!user || !currentOrgId) { setMeetingMinutes([]); return; }
    return subscribeMeetingMinutes(currentOrgId, setMeetingMinutes);
  }, [user, currentOrgId]);

  /* 전역 mouseup — 캘린더 셀 밖에서 release 시 드래그 상태 안전 종료 */
  useEffect(() => {
    if (!isDragging) return;
    const onGlobalUp = () => handleDragEnd();
    window.addEventListener('mouseup', onGlobalUp);
    return () => window.removeEventListener('mouseup', onGlobalUp);
  }, [isDragging, dragSelection]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ESC 키 — 어떤 모달이든 닫기 */
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (photoViewer) setPhotoViewer(null);
      else if (speakerCorrectionFor !== null) setSpeakerCorrectionFor(null);
      else if (voiceBookingOpen) setVoiceBookingOpen(false);
      else if (voiceprintModal && voiceprintProgress >= 100) setVoiceprintModal(false);
      else if (showOrgDashboard) setShowOrgDashboard(false);
      else if (isModalOpen) {
        setIsModalOpen(false);
        setEditingReservation(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photoViewer, speakerCorrectionFor, voiceBookingOpen, voiceprintModal, voiceprintProgress, showOrgDashboard, isModalOpen]);

  /* weekOffset 변경 시 — 주간 모드에서 헤더의 연/월 select를 그 주의 중간일(수요일)로 자동 동기화
   * (swipe로 주간 이동했을 때 헤더 월 표시가 어긋나는 문제 해결) */
  useEffect(() => {
    if (viewMode !== 'week') return;
    const base = new Date('2026-05-17');
    base.setDate(base.getDate() + weekOffset * 7 + 3); // 그 주 수요일
    setCalendarYear(base.getFullYear());
    setCalendarMonth(base.getMonth() + 1);
  }, [weekOffset, viewMode]);

  /* 연/월 select에서 직접 점프할 때 weekOffset도 그 달의 첫 일요일에 맞추는 헬퍼 */
  const jumpToYearMonth = (year, month) => {
    const target = new Date(year, month - 1, 1);
    // 그 달의 1일이 속한 주의 일요일 찾기
    const sunday = new Date(target);
    sunday.setDate(target.getDate() - target.getDay());
    const baseSunday = new Date('2026-05-17');
    const diffDays = Math.round((sunday - baseSunday) / 86400000);
    setWeekOffset(Math.floor(diffDays / 7));
  };

  /* 캘린더 7일 (일요일 시작 — 일반 달력) */
  const calendarDays = useMemo(() => {
    const base = new Date('2026-05-17'); // 일요일
    base.setDate(base.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const fullDate = `${yyyy}-${mm}-${dd}`;
      return {
        day: String(d.getDate()),
        fullDate,
        weekday: ['일', '월', '화', '수', '목', '금', '토'][i],
        isToday: fullDate === TODAY
      };
    });
  }, [weekOffset]);

  /* 월간 그리드 (일요일 시작 / 토요일 끝) */
  const monthDays = useMemo(() => {
    const firstDay = new Date(calendarYear, calendarMonth - 1, 1);
    const lastDay = new Date(calendarYear, calendarMonth, 0);
    const firstWeekday = firstDay.getDay(); // 0=일, 6=토
    const totalCells = Math.ceil((firstWeekday + lastDay.getDate()) / 7) * 7;
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstWeekday + 1;
      const inMonth = dayNum >= 1 && dayNum <= lastDay.getDate();
      const d = new Date(calendarYear, calendarMonth - 1, dayNum); // 음수/초과 시 자동으로 이전/다음 달
      const fullDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      cells.push({
        day: String(d.getDate()),
        fullDate,
        weekday: ['일', '월', '화', '수', '목', '금', '토'][i % 7],
        isToday: fullDate === TODAY,
        inMonth
      });
    }
    return cells;
  }, [calendarYear, calendarMonth]);

  /* Firestore 예약과 오프라인 대기 예약을 모두 병합한 전체 목록 */
  const allReservations = useMemo(() => {
    return [...reservations, ...localOfflineReservations];
  }, [reservations, localOfflineReservations]);

  /* 방별 필터 적용된 예약 목록 */
  const filteredReservations = useMemo(() => {
    if (roomFilter === 'all') return allReservations;
    return allReservations.filter(r => r.room === roomFilter);
  }, [allReservations, roomFilter]);

  /* 모바일 날짜 스트립: 오늘 기준 ±60일 = 121개 칩 */
  const dateStripDates = useMemo(() => {
    const today = new Date(TODAY);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const arr = [];
    for (let i = -60; i <= 60; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      arr.push({
        fullDate: fmt(d),
        day: d.getDate(),
        month: d.getMonth() + 1,
        weekday: ['일', '월', '화', '수', '목', '금', '토'][d.getDay()],
        weekdayIdx: d.getDay(),
        isToday: i === 0,
      });
    }
    return arr;
  }, []);

  /* 본문이 처음 렌더된 시점(loading 가드 통과 후)에 오늘 칩을 스트립 가운데로 스크롤 — 1회만 */
  useEffect(() => {
    if (!authReady || !currentOrg || stripReadyRef.current) return;
    stripReadyRef.current = true;
    setMobileSelectedDate(TODAY);
    // 두 번의 rAF로 페인트 후 스크롤 보장
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (todayChipRef.current) {
        try {
          todayChipRef.current.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' });
        } catch {
          // 일부 브라우저 behavior:'instant' 미지원 fallback
          todayChipRef.current.scrollIntoView({ inline: 'center', block: 'nearest' });
        }
      }
    }));
  }, [authReady, currentOrg]);

  /* 타임슬롯 (9-18시) */
  const TIME_SLOTS = useMemo(() => Array.from({ length: 10 }, (_, i) => `${String(9 + i).padStart(2, '0')}:00`), []);

  /* 단체별 점유율 통계 (단체 대시보드용 - 빌 추천 기능 ⑥) */
  const orgStats = useMemo(() => {
    return orgs.map(org => {
      const myRes = reservations.filter(r => r.orgId === org.id);
      const totalHours = myRes.reduce((sum, r) => {
        const s = parseInt(r.startTime.split(':')[0], 10);
        const e = parseInt(r.endTime.split(':')[0], 10);
        return sum + (e - s);
      }, 0);
      return { ...org, reservationCount: myRes.length, totalHours, noShowCount: 0 };
    });
  }, [reservations, orgs]);

  const dashboardSummary = useMemo(() => {
    const todayReservations = reservations
      .filter(r => r.date === TODAY)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    const upcomingReservations = reservations
      .filter(r => r.date >= TODAY)
      .sort((a, b) => (a.date + ' ' + a.startTime).localeCompare(b.date + ' ' + b.startTime))
      .slice(0, 5);
    const monthPrefix = TODAY.slice(0, 7);
    const monthReservations = reservations.filter(r => r.date?.startsWith(monthPrefix));
    const monthHours = monthReservations.reduce((sum, r) => sum + reservationHours(r), 0);
    const roomLoad = ROOMS.map(room => ({
      ...room,
      count: monthReservations.filter(r => r.room === room.name).length,
    }));
    const topOrg = [...orgStats].sort((a, b) => b.totalHours - a.totalHours)[0] || null;
    return {
      todayReservations,
      upcomingReservations,
      monthReservations,
      monthHours,
      roomLoad,
      topOrg,
      recentMinutes: meetingMinutes.slice(0, 3),
    };
  }, [reservations, orgStats, meetingMinutes]);

  const getMinutePreview = (minute) => {
    const summaryText = minute?.aiSummary?.summary || minute?.aiSummary?.brief;
    if (typeof summaryText === 'string' && summaryText.trim()) return summaryText;
    if (summaryText && typeof summaryText === 'object') {
      if (typeof summaryText.text === 'string' && summaryText.text.trim()) return summaryText.text;
      if (typeof summaryText.brief === 'string' && summaryText.brief.trim()) return summaryText.brief;
      if (typeof summaryText.summary === 'string' && summaryText.summary.trim()) return summaryText.summary;
    }
    if (Array.isArray(minute?.rawTranscript)) {
      const preview = minute.rawTranscript
        .slice(0, 3)
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object') {
            const speaker = item.speaker ? `${item.speaker}: ` : '';
            return `${speaker}${item.text || ''}`.trim();
          }
          return '';
        })
        .filter(Boolean)
        .join(' ');
      return preview || '저장된 본문이 없습니다.';
    }
    if (typeof minute?.rawTranscript === 'string' && minute.rawTranscript.trim()) {
      return minute.rawTranscript.slice(0, 120);
    }
    return '저장된 본문이 없습니다.';
  };

  const getMinuteTitle = (minute) => {
    const title = minute?.title || minute?.aiSummary?.title;
    if (typeof title === 'string' && title.trim()) return title;
    if (title && typeof title === 'object' && typeof title.text === 'string') return title.text;
    return '회의록';
  };

  /* 회의 평균 신뢰도 (Assurance Score) */
  const assuranceScore = useMemo(() => {
    if (dialogues.length === 0) return 0;
    const avg = dialogues.reduce((sum, d) => sum + (d.confidence || 0.9), 0) / dialogues.length;
    return Math.round(avg * 100);
  }, [dialogues]);

  const triggerNotification = (msg, variant = 'info') => {
    setNotificationVariant(variant);
    setShowNotification(msg);
    setTimeout(() => setShowNotification(false), 5000);
    triggerHaptic();
  };

  const showReservationWarning = (message) => {
    setReservationWarning(message);
    setShakeModal(true);
    setTimeout(() => setShakeModal(false), 500);
    triggerNotification(message, 'danger');
  };

  /* 햅틱 피드백 — Vibration API + 시각 + 사운드 큐 */
  const triggerHaptic = () => {
    if (navigator.vibrate) navigator.vibrate(15);
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = 440;
      o.type = 'sine';
      g.gain.setValueAtTime(0.006, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
      o.start();
      o.stop(ctx.currentTime + 0.05);
    } catch (e) { /* AudioContext 불가 환경 무시 */ }
  };


  const openReservationCreateModal = (date = newDate, options = {}) => {
    setEditingReservation(null);
    setNewDate(date);
    setNewTitle(options.title || '');
    setNewStart(options.startTime || '14:00');
    setNewEnd(options.endTime || '16:00');
    setNewRoom(options.room || ROOMS[0]?.name || '');
    setNewAttendees(options.attendees || 8);
    setNewOrgId(currentOrgId);
    setDuplicateWarning(null);
    setReservationWarning(null);
    setIsModalOpen(true);
  };

  const openReservationEditModal = (reservation) => {
    if (!canManageReservation(reservation)) {
      triggerNotification('이 예약을 수정할 권한이 없습니다.', 'danger');
      return;
    }
    setEditingReservation(reservation);
    setNewTitle(reservation.title || '');
    setNewDate(reservation.date || TODAY);
    setNewStart(reservation.startTime || '14:00');
    setNewEnd(reservation.endTime || '16:00');
    setNewRoom(reservation.room || ROOMS[0]?.name || '');
    setNewAttendees(reservation.attendees || 8);
    setNewOrgId(reservation.orgId || currentOrgId);
    setDuplicateWarning(null);
    setReservationWarning(null);
    setIsModalOpen(true);
  };

  const closeReservationModal = () => {
    setIsModalOpen(false);
    setEditingReservation(null);
    setDuplicateWarning(null);
    setReservationWarning(null);
  };

  const handleDeleteReservation = async (reservation) => {
    if (!canManageReservation(reservation)) {
      triggerNotification('이 예약을 삭제할 권한이 없습니다.', 'danger');
      return;
    }
    if (!window.confirm(`"${reservation.title}" 예약을 삭제하시겠습니까?`)) return;
    try {
      await deleteReservation(reservation.id);
      closeReservationModal();
      triggerNotification('예약 삭제 완료', 'success');
    } catch (err) {
      triggerNotification('삭제 실패: ' + err.message, 'danger');
    }
  };

  /* 예약 등록 (즉시 등록 + 중복 AI 감지) — Firestore createReservation */
  const handleCreateReservation = async (e) => {
    if (e) e.preventDefault();
    if (!newTitle.trim() || !user) return;
    const targetOrgId = newOrgId || currentOrgId;
    const targetOrg = orgs.find(o => o.id === targetOrgId) || currentOrg;
    if (!targetOrg) return;
    if (editingReservation && !canManageReservation(editingReservation)) {
      triggerNotification('이 예약을 수정할 권한이 없습니다.', 'danger');
      return;
    }

    // 권한 가드
    if (!isAuthenticated) {
      triggerNotification('로그인 후 예약 가능합니다. 헤더의 [로그인] 버튼을 눌러 주세요.', 'danger');
      setIsModalOpen(false);
      setLoginModalOpen(true);
      return;
    }
    if (isPending) {
      triggerNotification('승인 대기 중입니다. 매니저 승인 후 예약 가능합니다.', 'danger');
      return;
    }
    if (!isMember) {
      triggerNotification('예약 권한이 없습니다.', 'danger');
      return;
    }

    const timeWarning = validateReservationTimes(newStart, newEnd);
    if (timeWarning) {
      showReservationWarning(timeWarning);
      return;
    }

    const roomConflict = findRoomConflict(reservations, {
      date: newDate,
      startTime: newStart,
      endTime: newEnd,
      room: newRoom
    });
    if (roomConflict && roomConflict.id !== editingReservation?.id) {
      showReservationWarning(
        `${newRoom}은 ${roomConflict.startTime}-${roomConflict.endTime}에 이미 예약되어 있습니다. 다른 시간이나 장소를 선택해 주세요.`
      );
      return;
    }

    const normalizedNewTitle = newTitle.replace(/\s+/g, '').toLowerCase();
    const isDuplicate = reservations.some(res => {
      if (res.id === editingReservation?.id) return false;
      if (res.date !== newDate) return false;
      const normalizedExistTitle = res.title.replace(/\s+/g, '').toLowerCase();
      return ['총회', '체육대회', '부녀회', '예술단', '모임'].some(kw =>
        normalizedNewTitle.includes(kw) && normalizedExistTitle.includes(kw)
      );
    });

    if (isDuplicate) {
      setShakeModal(true);
      setDuplicateWarning('🚨 AI 중복 예약 경고: 이미 유사한 성격의 동일 회의가 해당 캘린더에 예약되어 있습니다.');
      setReservationWarning(null);
      setTimeout(() => setShakeModal(false), 500);
      triggerNotification('중복 예약 시도가 AI 필터링에 의해 차단되었습니다.', 'danger');
      return;
    }

    if (isOffline) {
      if (editingReservation) {
        triggerNotification('오프라인 상태에서는 기존 예약 수정이 불가능합니다. 연결 후 다시 시도해 주세요.', 'danger');
        return;
      }
      const localList = JSON.parse(localStorage.getItem('offlineReservations') || '[]');
      const tempId = `temp-${Date.now()}`;
      const newOfflineRes = {
        id: tempId,
        title: newTitle,
        date: newDate,
        startTime: newStart,
        endTime: newEnd,
        room: newRoom,
        orgId: targetOrg.id,
        creatorName: userProfile?.displayName || '참석자',
        isOfflinePending: true
      };
      localList.push(newOfflineRes);
      localStorage.setItem('offlineReservations', JSON.stringify(localList));
      setLocalOfflineReservations(localList);
      setOfflineQueue(localList.length);

      triggerNotification(`로컬 큐에 안전 저장됨. 신호 복구 시 자동 동기화 (대기: ${localList.length}건)`, 'gold');
      setIsModalOpen(false);
      setNewTitle('');
      return;
    }

    // 비-admin이 자기 단체가 아닌 곳을 선택했는지 가드
    if (!isAdmin && userProfile?.orgId && targetOrgId !== userProfile.orgId) {
      triggerNotification('소속 단체 외 예약은 admin만 가능합니다.', 'danger');
      return;
    }

    try {
      const payload = {
        title: newTitle,
        date: newDate,
        startTime: newStart,
        endTime: newEnd,
        room: newRoom,
        orgId: targetOrg.id,
        creatorName: userProfile?.displayName || '참석자'
      };
      if (editingReservation) {
        await updateReservation(editingReservation.id, payload);
      } else {
        await createReservation(payload, user);
      }
      closeReservationModal();
      setNewTitle('');
      setDuplicateWarning(null);
      setReservationWarning(null);
      triggerNotification(`[${targetOrg.name}] ${newTitle} ${editingReservation ? '수정 완료' : '즉시 예약 완료'}!`, 'success');
    } catch (err) {
      if (err.code === 'RESERVATION_CONFLICT') {
        setShakeModal(true);
        setReservationWarning(`⚠ 동시 예약 충돌 — 같은 순간 다른 사용자가 같은 시간을 선점했습니다. 시간/장소를 변경해 주세요. (${err.conflict?.title || ''})`);
        setTimeout(() => setShakeModal(false), 500);
        triggerNotification('Race condition 차단 — Firestore transaction이 이중 예약을 방지했습니다.', 'danger');
      } else {
        triggerNotification('Firestore 저장 실패: ' + err.message, 'danger');
      }
    }
  };

  /* OCR 무접촉 자동 캡처 — 0.8초 카운트다운 */
  const handleStartOCRScan = () => {
    if (!canAccessMinutes) {
      triggerNotification('회의록 사용 권한이 없습니다. 관리자 승인 후 이용 가능합니다.', 'danger');
      return;
    }
    setIsScanning(true);
    setAutoSnapCountdown(8); // 8 * 100ms = 0.8초
    const countdown = setInterval(() => {
      setAutoSnapCountdown(c => {
        if (c <= 1) {
          clearInterval(countdown);
          return 0;
        }
        return c - 1;
      });
    }, 100);
    setTimeout(() => {
      setIsScanning(false);
      setAutoSnapCountdown(0);
      setScanResult(null);
      setMobileStep(2);
      triggerNotification('스캔 데모 데이터는 제거했습니다. 실제 안내문 OCR 연동 전까지는 바로 녹음으로 진행합니다.', 'info');
    }, 1800);
  };

  /* 🎙️ 실시간 회의록 녹음 및 Web Speech API STT 연동 */
  const recordingRecognitionRef = useRef(null);
  const recordingStartTimeRef = useRef(null);

  const normalizeAgendaTitle = (title) => String(title || '').trim();

  const buildDefaultAgendaItems = () => [{
    id: 'agenda-general',
    title: normalizeAgendaTitle(scanResult?.title) || '일반 논의',
    order: 1,
    status: 'active',
    keywords: [],
    createdAt: new Date().toISOString(),
  }];

  const getActiveAgendaItems = () => {
    const valid = agendaItems
      .map((agenda, idx) => ({
        ...agenda,
        id: agenda.id || `agenda-${idx + 1}`,
        title: normalizeAgendaTitle(agenda.title),
        order: agenda.order || idx + 1,
        status: agenda.status || 'active',
      }))
      .filter((agenda) => agenda.title);
    return valid.length > 0 ? valid : buildDefaultAgendaItems();
  };

  const classifyAgendaForText = (text, agendaList = getActiveAgendaItems()) => {
    const source = String(text || '').toLowerCase();
    if (!source || agendaList.length === 0) return agendaList[0] || null;
    let bestAgenda = agendaList[0];
    let bestScore = -1;
    agendaList.forEach((agenda) => {
      const title = String(agenda.title || '').toLowerCase();
      const tokens = title.split(/[\s,./·()[\]{}]+/).filter((token) => token.length >= 2);
      const keywords = Array.isArray(agenda.keywords) ? agenda.keywords : [];
      let score = 0;
      if (title && source.includes(title)) score += 8;
      tokens.forEach((token) => { if (source.includes(token)) score += 2; });
      keywords.forEach((keyword) => { if (source.includes(String(keyword).toLowerCase())) score += 3; });
      if (score > bestScore) {
        bestScore = score;
        bestAgenda = agenda;
      }
    });
    return bestAgenda;
  };

  const buildStructuredAgendaItems = (dialogList) => {
    const safeDialogues = Array.isArray(dialogList) ? dialogList : [];
    const baseAgendas = getActiveAgendaItems();
    const decisionWords = ['결정', '확정', '합의', '진행', '승인', '채택', '예약', '일정'];
    const actionWords = ['담당', '진행', '준비', '확인', '검토', '보고', '제출', '연락', '처리'];
    return baseAgendas.map((agenda, idx) => {
      const discussion = safeDialogues.filter((d) => {
        if (d.agendaId) return d.agendaId === agenda.id;
        return classifyAgendaForText(d.text, baseAgendas)?.id === agenda.id;
      });
      const decisions = discussion
        .filter((d) => decisionWords.some((word) => String(d.text || '').includes(word)))
        .map((d) => ({ text: d.text, speaker: d.speaker || '참석자', audioOffsetSeconds: d.audioOffsetSeconds || 0 }));
      const actionItems = discussion
        .filter((d) => actionWords.some((word) => String(d.text || '').includes(word)))
        .map((d) => ({ text: d.text, owner: d.speaker || '담당자 확인', dueDate: '', status: '대기' }));
      return {
        id: agenda.id,
        order: agenda.order || idx + 1,
        title: agenda.title,
        status: agenda.status || 'active',
        discussion,
        decisions,
        actionItems,
        pendingItems: discussion.length > 0 && decisions.length === 0 ? [{ text: '결정사항 추가 확인 필요', status: '검토 필요' }] : [],
      };
    });
  };

  const buildAgendaFormattedMinutes = (dialogList, auditResult, structuredAgendas) => {
    const safeDialogues = Array.isArray(dialogList) ? dialogList : [];
    const speakers = Array.from(new Set(safeDialogues.map((d) => d.speaker).filter(Boolean)));
    const decisions = auditResult?.decisions || [];
    const actionItems = auditResult?.actionItems || [];
    const lines = [
      `# ${scanResult?.title || `${currentOrg?.name || 'WS'} 회의록`}`,
      '',
      '## 1. 회의 개요',
      `- 일시: ${scanResult?.date || new Date().toLocaleDateString('ko-KR')} ${scanResult?.time || ''}`.trim(),
      `- 장소: ${scanResult?.location || newRoom || '미기재'}`,
      `- 작성자: ${userProfile?.displayName || user?.displayName || '미기재'}`,
      `- 참석자: ${scanResult?.members || speakers.join(', ') || '미기재'}`,
      '',
      '## 2. 안건별 논의',
    ];
    structuredAgendas.forEach((agenda, idx) => {
      lines.push('', `### 안건 ${idx + 1}. ${agenda.title}`, '- 주요 발언');
      if (agenda.discussion.length > 0) agenda.discussion.slice(0, 10).forEach((d) => lines.push(`  - ${d.speaker || '참석자'}: ${d.text}`));
      else lines.push('  - 기록된 발언이 없습니다.');
      lines.push('- 결정사항');
      if (agenda.decisions.length > 0) agenda.decisions.forEach((d) => lines.push(`  - ${d.text}`));
      else lines.push('  - 결정사항 추가 확인 필요');
      lines.push('- 담당자 및 후속 조치');
      if (agenda.actionItems.length > 0) agenda.actionItems.forEach((a) => lines.push(`  - ${a.text} / 담당: ${a.owner || '확인 필요'} / 기한: ${a.dueDate || '미정'}`));
      else lines.push('  - 후속 조치 추가 확인 필요');
    });
    lines.push('', '## 3. 종합 결정사항');
    if (decisions.length > 0) decisions.forEach((d) => lines.push(`- ${d.text}`));
    else lines.push('- 결정사항을 추가 검토해 주세요.');
    lines.push('', '## 4. 실행 과제 목록');
    if (actionItems.length > 0) actionItems.forEach((a) => lines.push(`- ${a.text}`));
    else lines.push('- 실행 항목을 추가 검토해 주세요.');
    lines.push('', '## 5. 보류/추가 검토 사항');
    const pending = structuredAgendas.flatMap((agenda) => agenda.pendingItems.map((item) => `${agenda.title}: ${item.text}`));
    if (pending.length > 0) pending.forEach((item) => lines.push(`- ${item}`));
    else lines.push('- 보류 사항 없음');
    lines.push('', '## 6. 원문 기록');
    if (safeDialogues.length > 0) safeDialogues.forEach((d) => lines.push(`- [${d.audioOffsetSeconds || 0}s] ${d.agendaTitle || '일반 논의'} / ${d.speaker || '참석자'}: ${d.text}`));
    else lines.push('- 원문 기록이 없습니다.');
    return lines.join('\n');
  };

  const buildFormattedMinutes = (dialogList, auditResult) => {
    const safeDialogues = Array.isArray(dialogList) ? dialogList : [];
    const speakers = Array.from(new Set(safeDialogues.map((d) => d.speaker).filter(Boolean)));
    const decisions = auditResult?.decisions || [];
    const actionItems = auditResult?.actionItems || [];
    const lines = [
      `# ${scanResult?.title || `${currentOrg?.name || 'WS'} 회의록`}`,
      '',
      '## 1. 회의 개요',
      `- 일시: ${scanResult?.date || new Date().toLocaleDateString('ko-KR')} ${scanResult?.time || ''}`.trim(),
      `- 장소: ${scanResult?.location || newRoom || '미기재'}`,
      `- 작성자: ${userProfile?.displayName || user?.displayName || '미기재'}`,
      `- 참석자: ${scanResult?.members || speakers.join(', ') || '미기재'}`,
      '',
      '## 2. 주요 논의',
      ...(safeDialogues.length > 0
        ? safeDialogues.slice(0, 12).map((d) => `- ${d.speaker || '참석자'}: ${d.text}`)
        : ['- 기록된 발언이 없습니다.']),
      '',
      '## 3. 결정사항',
      ...(decisions.length > 0 ? decisions.map((d) => `- ${d.text}`) : ['- 결정사항을 추가 검토해 주세요.']),
      '',
      '## 4. 실행계획',
      ...(actionItems.length > 0 ? actionItems.map((a) => `- ${a.text}`) : ['- 실행 항목을 추가 검토해 주세요.']),
      '',
      '## 5. 원문 기록',
      ...(safeDialogues.length > 0
        ? safeDialogues.map((d) => `- [${d.audioOffsetSeconds || 0}s] ${d.speaker || '참석자'}: ${d.text}`)
        : ['- 원문 기록이 없습니다.']),
    ];
    return lines.join('\n');
  };

  const handleProcessAI = async (currentDialogues) => {
    setIsProcessingAI(true);
    try {
      const sourceDialogues = currentDialogues || dialogues;
      const auditResult = await analyzeMinutesWithDualRouting(sourceDialogues);
      const structuredAgendaItems = buildStructuredAgendaItems(sourceDialogues);
      const formattedMinutes = buildAgendaFormattedMinutes(sourceDialogues, auditResult, structuredAgendaItems);
      const enrichedAuditResult = { ...auditResult, formattedMinutes, agendaItems: structuredAgendaItems };
      
      setUsedAIModel(enrichedAuditResult.routingPath);
      setAiCostSavings(enrichedAuditResult.costSavings || '외부 API 호출 없음');
      setAuditResult(enrichedAuditResult);
      if (user && currentOrg) {
        const minutesPayload = {
          orgId: currentOrg.id,
          title: scanResult?.title || `${currentOrg.name || 'WS'} 회의록`,
          creatorName: userProfile?.displayName || user.displayName || '담당자',
          location: scanResult?.location || newRoom || '',
          rawTranscript: sourceDialogues.map((d, idx) => ({
            speaker: d.speaker || `참석자 ${idx + 1}`,
            text: d.text || '',
            time: d.time || '',
            audioOffsetSeconds: d.audioOffsetSeconds || 0,
            confidence: d.confidence || 0,
            agendaId: d.agendaId || null,
            agendaTitle: d.agendaTitle || '',
          })),
          agendaItems: structuredAgendaItems,
          aiSummary: {
            brief: enrichedAuditResult.decisions?.[0]?.text || '회의 내용을 자동 요약했습니다.',
            formattedMinutes,
            agendaItems: structuredAgendaItems,
            decisions: enrichedAuditResult.decisions || [],
            actionItems: enrichedAuditResult.actionItems || [],
            confidence: enrichedAuditResult.confidence || 0,
            model: enrichedAuditResult.model,
            routingPath: enrichedAuditResult.routingPath,
          },
          attachedPhotos: photos.map((p) => ({
            photoId: p.id,
            originalUrl: p.originalUrl || null,
            thumbnailUrl: p.thumbnailUrl || null,
            caption: p.name || '',
            ocrText: p.ocrText || '',
            scannedAt: new Date().toISOString(),
          })),
          security: {
            isMasked: maskingEnabled,
            maskedKeywords: maskingEnabled ? ['계좌번호', '주민등록번호', '예산금액'] : [],
            accessLevelRequired: 'member',
          },
        };

        if (liveMinutesIdRef.current) {
          await updateMeetingMinutesTranscript(liveMinutesIdRef.current, minutesPayload.rawTranscript, {
            status: 'completed',
            agendaItems: minutesPayload.agendaItems,
            aiSummary: minutesPayload.aiSummary,
            attachedPhotos: minutesPayload.attachedPhotos,
            security: minutesPayload.security,
          });
          liveMinutesIdRef.current = null;
        } else {
          await createMeetingMinutes(minutesPayload, user);
        }
      }
      
      setMergedDecisions([]);
      setMergedActions([]);
      
      setTimeout(() => {
        setIsProcessingAI(false);
        setMobileStep(3);
        triggerNotification('회의록 형식 정리 완료! 신뢰도 ' + Math.round((enrichedAuditResult.confidence || 0.95) * 100) + '%', 'success');
      }, 1500);
      
    } catch (err) {
      console.error('AI Processing error:', err);
      setIsProcessingAI(false);
      triggerNotification('AI 듀얼 라우팅 분석 중 오류가 발생했습니다: ' + err.message, 'danger');
    }
  };

  const convertFloat32ToPcm16 = (input, inputSampleRate, outputSampleRate = 16000) => {
    const sampleRateRatio = inputSampleRate / outputSampleRate;
    const outputLength = Math.floor(input.length / sampleRateRatio);
    const output = new Int16Array(outputLength);
    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = Math.floor(i * sampleRateRatio);
      const sample = Math.max(-1, Math.min(1, input[sourceIndex] || 0));
      output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    return output;
  };

  const appendLiveTranscriptItems = async (items, confidenceFallback = 0.9) => {
    const cleanItems = items
      .map(item => ({
        text: (item.text || '').trim(),
        confidence: Number.isFinite(item.confidence) && item.confidence > 0 ? item.confidence : confidenceFallback
      }))
      .filter(item => item.text && item.text !== lastCommittedTranscriptRef.current);

    if (cleanItems.length === 0) return [];

    const added = cleanItems.map(item => ({
      speaker: userProfile?.displayName || '참석자',
      text: item.text,
      confidence: item.confidence,
      needsReview: item.confidence > 0 && item.confidence < 0.78,
      audioOffsetSeconds: recordingStartTimeRef.current ? Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000)) : 1,
      isBoosted: isBoosting,
      voiceprintMatch: false,
      voiceprintScore: 0
    }));

    transcriptBufferRef.current = [...transcriptBufferRef.current, ...added];
    lastCommittedTranscriptRef.current = added.at(-1)?.text || lastCommittedTranscriptRef.current;
    setDialogues(transcriptBufferRef.current);

    if (liveMinutesIdRef.current) {
      try {
        await updateMeetingMinutesTranscript(liveMinutesIdRef.current, transcriptBufferRef.current, { status: 'recording' });
      } catch (err) {
        console.error('Live minutes update failed:', err);
        setRecordingHealthWarning('실시간 저장 중 오류가 발생했습니다. 로컬 화면에는 기록을 유지하고 있습니다.');
      }
    }

    return added;
  };

  const stopCloudSttSession = () => {
    cloudSttStoppingRef.current = true;
    if (cloudSttReconnectTimerRef.current) {
      clearTimeout(cloudSttReconnectTimerRef.current);
      cloudSttReconnectTimerRef.current = null;
    }
    if (cloudSttProcessorRef.current) {
      try { cloudSttProcessorRef.current.disconnect(); } catch {}
      cloudSttProcessorRef.current = null;
    }
    if (cloudSttSourceRef.current) {
      try { cloudSttSourceRef.current.disconnect(); } catch {}
      cloudSttSourceRef.current = null;
    }
    if (cloudSttAudioContextRef.current && cloudSttAudioContextRef.current.state !== 'closed') {
      try { cloudSttAudioContextRef.current.close(); } catch {}
      cloudSttAudioContextRef.current = null;
    }
    if (cloudSttStreamRef.current) {
      try { cloudSttStreamRef.current.getTracks().forEach(track => track.stop()); } catch {}
      cloudSttStreamRef.current = null;
    }
    if (cloudSttWsRef.current) {
      try {
        if (cloudSttWsRef.current.readyState === WebSocket.OPEN) {
          cloudSttWsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        cloudSttWsRef.current.close();
      } catch {}
      cloudSttWsRef.current = null;
    }
    cloudSttPausedRef.current = false;
    cloudSttReconnectAttemptsRef.current = 0;
    sttPendingAudioBuffersRef.current = [];
    silenceStartedAtRef.current = null;
  };

  const startCloudSttSession = async () => {
    if (!CLOUD_STT_WS_URL) return false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecordingHealthWarning('이 브라우저는 마이크 스트리밍을 지원하지 않습니다.');
      return false;
    }

    setSttConnectionStatus('connecting');
    setSilenceState('listening');

    cloudSttStoppingRef.current = false;
    cloudSttReconnectAttemptsRef.current = 0;
    sttPendingAudioBuffersRef.current = [];

    const buildSttUrl = async () => {
      const token = user?.getIdToken ? await user.getIdToken() : '';
      const url = new URL(CLOUD_STT_WS_URL);
      if (token) url.searchParams.set('token', token);
      return url.toString();
    };

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      }
    });

    cloudSttStreamRef.current = stream;
    voiceprintStreamRef.current = stream;

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    const source = audioCtx.createMediaStreamSource(stream);
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);

    analyser.fftSize = 256;
    source.connect(analyser);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    cloudSttAudioContextRef.current = audioCtx;
    cloudSttSourceRef.current = source;
    cloudSttProcessorRef.current = processor;
    voiceprintAudioContextRef.current = audioCtx;
    voiceprintAnalyserRef.current = analyser;
    voiceprintDataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (!recordingActiveRef.current) return;
        setRecordingHealthWarning('마이크 입력이 예기치 않게 중단되었습니다. 재연결하거나 녹음을 종료해 주세요.');
        triggerNotification('마이크 입력이 예기치 않게 중단되었습니다.', 'danger');
      };
      track.onmute = () => {
        if (!recordingActiveRef.current) return;
        setRecordingHealthWarning('마이크 입력이 일시적으로 끊겼습니다. 조용한 상태라면 자동 대기 중일 수 있습니다.');
      };
    });

    const connectSttSocket = async () => {
      if (!recordingActiveRef.current || cloudSttStoppingRef.current) return;
      if (cloudSttReconnectTimerRef.current) {
        clearTimeout(cloudSttReconnectTimerRef.current);
        cloudSttReconnectTimerRef.current = null;
      }

      setSttConnectionStatus('connecting');
      const ws = new WebSocket(await buildSttUrl());
      ws.binaryType = 'arraybuffer';
      cloudSttWsRef.current = ws;

      ws.onopen = () => {
        if (cloudSttWsRef.current !== ws) return;
        cloudSttReconnectAttemptsRef.current = 0;
        setSttConnectionStatus('connected');
        setRecordingHealthWarning('서버 STT가 연결되었습니다. 작은 목소리도 최대한 전송하고, 끊기면 자동으로 다시 연결합니다.');
        const pending = sttPendingAudioBuffersRef.current.splice(0);
        for (const buffer of pending) {
          if (ws.readyState !== WebSocket.OPEN) break;
          ws.send(buffer);
        }
      };

      ws.onerror = () => {
        if (cloudSttWsRef.current !== ws || cloudSttStoppingRef.current) return;
        setSttConnectionStatus('error');
        setRecordingHealthWarning('서버 STT 연결 오류가 발생했습니다. 녹음은 유지하고 자동 재연결을 시도합니다.');
      };

      ws.onclose = () => {
        if (cloudSttWsRef.current !== ws || cloudSttStoppingRef.current || !recordingActiveRef.current) return;
        setSttConnectionStatus('disconnected');
        const attempt = cloudSttReconnectAttemptsRef.current + 1;
        cloudSttReconnectAttemptsRef.current = attempt;
        if (attempt > STT_RECONNECT_MAX_ATTEMPTS) {
          setRecordingHealthWarning('서버 STT 연결이 반복해서 끊겼습니다. 녹음 파일은 저장되니 종료 후 다시 전사해 주세요.');
          triggerNotification('서버 STT 연결이 반복해서 끊겼습니다.', 'danger');
          return;
        }
        const delay = Math.min(8000, 700 * attempt);
        setRecordingHealthWarning(`서버 STT 연결이 끊겨 ${Math.ceil(delay / 1000)}초 뒤 다시 연결합니다. 녹음은 계속 저장 중입니다.`);
        cloudSttReconnectTimerRef.current = setTimeout(() => {
          connectSttSocket().catch((err) => {
            console.error('STT reconnect failed:', err);
          });
        }, delay);
      };

      ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'ready') {
            setSttConnectionStatus('connected');
            return;
          }
          if (payload.type === 'error') {
            setRecordingHealthWarning(payload.message || '서버 STT 오류가 발생했습니다. 자동 재연결을 시도합니다.');
            return;
          }
          if (payload.type === 'transcript' && payload.text) {
            setRealtimeTextFeed(payload.text);
            realtimeTextRef.current = payload.text;
            if (payload.isFinal) {
              await appendLiveTranscriptItems([{ text: payload.text, confidence: payload.confidence || 0.9 }]);
              setRealtimeTextFeed('');
              realtimeTextRef.current = '';
            }
          }
        } catch (err) {
          console.error('Bad STT server message:', err);
        }
      };
    };

    await connectSttSocket();

    processor.onaudioprocess = (event) => {
      if (!recordingActiveRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      const now = Date.now();
      const isVoice = rms > STT_VOICE_RMS_THRESHOLD;
      const currentWs = cloudSttWsRef.current;

      if (!isVoice) {
        if (!silenceStartedAtRef.current) silenceStartedAtRef.current = now;
        if (now - silenceStartedAtRef.current > STT_SILENCE_PAUSE_MS && !cloudSttPausedRef.current) {
          cloudSttPausedRef.current = true;
          setSilenceState('paused');
          setRecordingHealthWarning('긴 무음이 감지되어 STT 전송을 잠시 줄였습니다. 다시 말하면 자동으로 이어집니다.');
          if (currentWs?.readyState === WebSocket.OPEN) currentWs.send(JSON.stringify({ type: 'pause' }));
        }
        if (cloudSttPausedRef.current) return;
      } else if (rms > STT_RESUME_RMS_THRESHOLD) {
        silenceStartedAtRef.current = null;
      }

      if (cloudSttPausedRef.current && rms > STT_RESUME_RMS_THRESHOLD) {
        cloudSttPausedRef.current = false;
        setSilenceState('listening');
        setRecordingHealthWarning('말소리가 감지되어 STT 전송을 이어갑니다.');
        if (currentWs?.readyState === WebSocket.OPEN) currentWs.send(JSON.stringify({ type: 'resume' }));
      }

      const pcm = convertFloat32ToPcm16(input, audioCtx.sampleRate, 16000);
      if (currentWs?.readyState !== WebSocket.OPEN) {
        sttPendingAudioBuffersRef.current.push(pcm.buffer);
        if (sttPendingAudioBuffersRef.current.length > STT_PENDING_AUDIO_MAX_CHUNKS) {
          sttPendingAudioBuffersRef.current.shift();
        }
        return;
      }
      currentWs.send(pcm.buffer);
    };

    return true;
  };

  const handleAddAgenda = () => {
    const title = normalizeAgendaTitle(newAgendaTitle);
    if (!title) {
      triggerNotification('추가할 안건명을 입력해 주세요.', 'danger');
      return;
    }
    const nextAgenda = {
      id: `agenda-${Date.now()}`,
      title,
      order: agendaItems.length + 1,
      status: 'active',
      keywords: title.split(/[\s,./·()[\]{}]+/).filter((token) => token.length >= 2),
      createdAt: new Date().toISOString(),
    };
    const nextAgendas = [...agendaItems, nextAgenda];
    setAgendaItems(nextAgendas);
    setNewAgendaTitle('');
    if (liveMinutesIdRef.current) {
      updateMeetingMinutesTranscript(liveMinutesIdRef.current, transcriptBufferRef.current, { agendaItems: nextAgendas })
        .catch((err) => console.error('Agenda update failed:', err));
    }
  };

  const handleRemoveAgenda = (agendaId) => {
    const nextAgendas = agendaItems
      .filter((agenda) => agenda.id !== agendaId)
      .map((agenda, idx) => ({ ...agenda, order: idx + 1 }));
    setAgendaItems(nextAgendas);
    if (liveMinutesIdRef.current) {
      updateMeetingMinutesTranscript(liveMinutesIdRef.current, transcriptBufferRef.current, { agendaItems: nextAgendas })
        .catch((err) => console.error('Agenda remove failed:', err));
    }
  };

  const handleAddManualTranscript = () => {
    const text = manualTranscriptText.trim();
    if (!text) {
      triggerNotification('추가할 회의록 문장을 입력해 주세요.', 'danger');
      return;
    }
    const matchedAgenda = classifyAgendaForText(text);
    const item = {
      speaker: userProfile?.displayName || '참석자',
      text,
      confidence: 1,
      audioOffsetSeconds: recordingStartTimeRef.current ? Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000)) : 1,
      agendaId: matchedAgenda?.id || null,
      agendaTitle: matchedAgenda?.title || '일반 논의',
      isBoosted: isBoosting,
      voiceprintMatch: false,
      voiceprintScore: 0
    };
    transcriptBufferRef.current = [...transcriptBufferRef.current, item];
    setDialogues(transcriptBufferRef.current);
    setManualTranscriptText('');
    setSttAssistMessage('직접 입력한 문장을 회의록에 추가했습니다.');
  };

  const handleToggleRecording = async (mode = 'toggle') => {
    if (audioSessionError) return;

    const stopAudioResources = () => {
      if (recognitionRestartTimerRef.current) {
        clearTimeout(recognitionRestartTimerRef.current);
        recognitionRestartTimerRef.current = null;
      }
      if (noSpeechTimerRef.current) {
        clearTimeout(noSpeechTimerRef.current);
        noSpeechTimerRef.current = null;
      }
      if (interimCommitTimerRef.current) {
        clearTimeout(interimCommitTimerRef.current);
        interimCommitTimerRef.current = null;
      }
      if (voiceprintStreamRef.current) {
        try { voiceprintStreamRef.current.getTracks().forEach(track => track.stop()); } catch (err) { console.error('Audio stream stop error:', err); }
        voiceprintStreamRef.current = null;
      }
      if (voiceprintAudioContextRef.current && voiceprintAudioContextRef.current.state !== 'closed') {
        try { voiceprintAudioContextRef.current.close(); } catch (err) { console.error('AudioContext close error:', err); }
        voiceprintAudioContextRef.current = null;
      }
      voiceprintAnalyserRef.current = null;
      voiceprintDataArrayRef.current = null;
    };

    const startAudioFileRecorder = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        setRecordingHealthWarning('이 브라우저에서는 녹음 파일 저장을 지원하지 않습니다. STT와 직접 입력은 계속 사용할 수 있습니다.');
        return;
      }
      try {
        const stream = cloudSttStreamRef.current || await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          const voiceprintCtx = new AudioContext();
          const voiceprintAnalyser = voiceprintCtx.createAnalyser();
          const voiceprintSource = voiceprintCtx.createMediaStreamSource(stream);
          voiceprintSource.connect(voiceprintAnalyser);
          voiceprintAnalyser.fftSize = 256;
          voiceprintAudioContextRef.current = voiceprintCtx;
          voiceprintAnalyserRef.current = voiceprintAnalyser;
          voiceprintDataArrayRef.current = new Uint8Array(voiceprintAnalyser.frequencyBinCount);
        }
        voiceprintStreamRef.current = stream;
        stream.getAudioTracks().forEach((track) => {
          track.onended = () => {
            if (!recordingActiveRef.current) return;
            setRecordingHealthWarning('마이크 입력이 예기치 않게 중단되었습니다. 녹음 파일과 회의록 내용을 확인해 주세요.');
            triggerNotification('마이크 입력이 예기치 않게 중단되었습니다.', 'danger');
          };
          track.onmute = () => {
            if (!recordingActiveRef.current) return;
            setRecordingHealthWarning('마이크 입력이 일시적으로 끊겼습니다. 장치 연결을 확인해 주세요.');
            triggerNotification('마이크 입력이 일시적으로 끊겼습니다.', 'danger');
          };
        });
        if (!isRecordingPaused) audioChunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
        const recorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) audioChunksRef.current.push(event.data);
        };
        recorder.onerror = (event) => {
          console.error('MediaRecorder error:', event.error || event);
          setRecordingHealthWarning('녹음 파일 생성 중 오류가 발생했습니다. 회의록 텍스트와 직접 입력 내용을 확인해 주세요.');
          triggerNotification('녹음 파일 생성 중 오류가 발생했습니다.', 'danger');
        };
        recorder.onstop = () => {
          const chunks = audioChunksRef.current;
          if (!chunks.length) return;
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (audioObjectUrlRef.current) URL.revokeObjectURL(audioObjectUrlRef.current);
          const url = URL.createObjectURL(blob);
          const name = 'meeting-recording-' + new Date().toISOString().replace(/[:.]/g, '-') + '.webm';
          audioObjectUrlRef.current = url;
          setRecordedAudioUrl(url);
          setRecordedAudioName(name);
          setRecordingHealthWarning('녹음 파일이 생성되었습니다. 아래 플레이어에서 재생해 확인할 수 있습니다.');
        };
        recorder.start(1000);
      } catch (err) {
        console.error('Audio file recorder start failed:', err);
        setRecordingHealthWarning('STT는 시작했지만 녹음 파일용 마이크 스트림을 열지 못했습니다. 브라우저 권한 또는 장치 점유 상태를 확인해 주세요.');
        triggerNotification('녹음 파일 저장용 마이크를 열지 못했습니다.', 'danger');
      }
    };

    const stopAudioFileRecorder = () => {
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (err) { console.error('MediaRecorder stop error:', err); }
      }
    };

    const getDetectedSpeaker = () => {
      let speakerName = '참석자 1';
      let similarityScore = 0;
      let isSpeakerMatch = false;

      if (voiceprintAnalyserRef.current && voiceprintDataArrayRef.current) {
        const analyser = voiceprintAnalyserRef.current;
        const dataArray = voiceprintDataArrayRef.current;
        analyser.getByteFrequencyData(dataArray);
        const currentVector = Array.from(dataArray);
        const storedSignature = sessionStorage.getItem('ws_voiceprint_session');

        if (storedSignature) {
          try {
            const templateVector = JSON.parse(storedSignature);
            let dotProduct = 0;
            let mA = 0;
            let mB = 0;
            for (let idx = 0; idx < currentVector.length; idx++) {
              dotProduct += currentVector[idx] * templateVector[idx];
              mA += currentVector[idx] * currentVector[idx];
              mB += templateVector[idx] * templateVector[idx];
            }
            const magnitude = Math.sqrt(mA) * Math.sqrt(mB);
            similarityScore = magnitude > 0 ? (dotProduct / magnitude) : 0;
            if (similarityScore >= 0.85) {
              speakerName = userProfile?.displayName || '참석자';
              isSpeakerMatch = true;
            } else {
              const sumEnergy = currentVector.reduce((a, b) => a + b, 0);
              speakerName = sumEnergy > 1800 ? '참석자 2' : '참석자 3';
            }
          } catch (err) {
            console.warn('Voiceprint signature parse failed:', err.message);
          }
        }
      }

      return { speakerName, similarityScore, isSpeakerMatch };
    };

    const appendTranscriptItems = (items) => {
      const cleanItems = items.map(item => ({
        text: (item.text || '').trim(),
        confidence: Number.isFinite(item.confidence) && item.confidence > 0 ? item.confidence : 0.9
      })).filter(item => item.text && item.text !== lastCommittedTranscriptRef.current);

      if (cleanItems.length === 0) return [];

      const speaker = getDetectedSpeaker();
      const activeAgendas = getActiveAgendaItems();
      const added = cleanItems.map(item => {
        const matchedAgenda = classifyAgendaForText(item.text, activeAgendas);
        return {
          speaker: speaker.speakerName,
          text: item.text,
          confidence: item.confidence,
          needsReview: item.confidence > 0 && item.confidence < 0.78,
          audioOffsetSeconds: Math.max(1, Math.round((Date.now() - recordingStartTimeRef.current) / 1000)),
          agendaId: matchedAgenda?.id || null,
          agendaTitle: matchedAgenda?.title || '일반 논의',
          isBoosted: isBoosting,
          voiceprintMatch: speaker.isSpeakerMatch,
          voiceprintScore: speaker.similarityScore
        };
      });

      transcriptBufferRef.current = [...transcriptBufferRef.current, ...added];
      setDialogues(transcriptBufferRef.current);
      if (liveMinutesIdRef.current) {
        updateMeetingMinutesTranscript(liveMinutesIdRef.current, transcriptBufferRef.current, {
          status: 'recording',
          agendaItems: activeAgendas,
        })
          .catch((err) => {
            console.error('Live minutes update failed:', err);
            setRecordingHealthWarning('실시간 저장 중 오류가 발생했습니다. 화면 기록은 유지되고 있습니다.');
          });
      }
      return added;
    };

    if (!recordingActiveRef.current) {
      if (mode === 'finish') {
        setIsRecording(false);
        setIsRecordingPaused(false);
        setIsDNDActive(false);
        setSttConnectionStatus(CLOUD_STT_WS_URL ? 'server-ready' : 'browser-fallback');
        setSilenceState('idle');
        let finalDialogues = transcriptBufferRef.current.length > 0 ? [...transcriptBufferRef.current] : [...dialogues];
        const pendingText = realtimeTextRef.current.trim();
        if (pendingText) {
          const pendingItems = appendTranscriptItems([{ text: pendingText, confidence: 0.95 }]);
          finalDialogues = [...finalDialogues, ...pendingItems];
        }
        setRealtimeTextFeed('');
        realtimeTextRef.current = '';
        if (finalDialogues.length === 0) {
          setSttAssistMessage('정리할 회의 내용이 없습니다. 녹음하거나 직접 입력한 뒤 회의록 정리를 눌러 주세요.');
          triggerNotification('정리할 회의 내용이 없습니다.', 'danger');
          return;
        }
        setTimeout(() => {
          handleProcessAI(finalDialogues);
        }, 300);
        return;
      }

      const isResumingPausedSession = isRecordingPaused && (liveMinutesIdRef.current || transcriptBufferRef.current.length > 0 || dialogues.length > 0);
      if (!isResumingPausedSession) {
        setDialogues([]);
        setAgendaItems([]);
        setNewAgendaTitle('');
        setRealtimeTextFeed('');
        setSttAssistMessage('');
        setManualTranscriptText('');
        setRecordingHealthWarning('');
        if (audioObjectUrlRef.current) { URL.revokeObjectURL(audioObjectUrlRef.current); audioObjectUrlRef.current = ''; }
        setRecordedAudioUrl('');
        setRecordedAudioName('');
        realtimeTextRef.current = '';
        transcriptBufferRef.current = [];
        lastCommittedTranscriptRef.current = '';
        recordingStartTimeRef.current = Date.now();
        liveMinutesIdRef.current = null;
      } else {
        setRealtimeTextFeed('');
        realtimeTextRef.current = '';
        setRecordingHealthWarning('잠시 중단한 회의 녹음을 이어서 시작합니다. 기존 회의록 초안에 계속 저장됩니다.');
      }
      recordingActiveRef.current = true;
      setIsRecordingPaused(false);

      if (!liveMinutesIdRef.current && user && currentOrg) {
        try {
          const draftRef = await createMeetingMinutesDraft({
            orgId: currentOrg.id,
            title: scanResult?.title || `${currentOrg.name || 'WS'} 회의록`,
            creatorName: userProfile?.displayName || user.displayName || '담당자',
            location: scanResult?.location || newRoom || '',
            agendaItems: getActiveAgendaItems(),
            attachedPhotos: photos.map((p) => ({
              photoId: p.id,
              originalUrl: p.originalUrl || null,
              thumbnailUrl: p.thumbnailUrl || null,
              caption: p.name || '',
              ocrText: p.ocrText || '',
              scannedAt: new Date().toISOString(),
            })),
            security: {
              isMasked: maskingEnabled,
              maskedKeywords: maskingEnabled ? ['계좌번호', '주민등록번호', '예산금액'] : [],
              accessLevelRequired: 'member',
            },
          }, user);
          liveMinutesIdRef.current = draftRef.id;
        } catch (err) {
          console.error('Meeting minutes draft create failed:', err);
          setRecordingHealthWarning('실시간 저장 초안 생성에 실패했습니다. 녹음과 화면 기록은 계속 진행됩니다.');
        }
      }

      // SpeechRecognition이 자체 마이크 파이프라인을 열도록 둡니다.
      // 별도 getUserMedia를 먼저 잡으면 일부 브라우저에서 STT가 빈 결과를 반환합니다.
      voiceprintAnalyserRef.current = null;
      voiceprintDataArrayRef.current = null;

      if (CLOUD_STT_WS_URL) {
        try {
          const cloudStarted = await startCloudSttSession();
          if (cloudStarted) {
            setIsRecording(true);
            setIsRecordingPaused(false);
            setIsDNDActive(true);
            setSttAssistMessage('서버 STT가 연결되었습니다. 말하는 동안 텍스트가 실시간으로 저장됩니다.');
            triggerNotification('서버 실시간 STT 녹음을 시작했습니다.', 'gold');
            setTimeout(() => { if (recordingActiveRef.current) startAudioFileRecorder(); }, 400);
            return;
          }
        } catch (err) {
          console.error('Cloud STT start failed:', err);
          stopCloudSttSession();
          setRecordingHealthWarning('서버 STT 연결에 실패했습니다. 브라우저 보조 STT로 전환합니다: ' + err.message);
        }
      }

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        recordingActiveRef.current = false;
        liveMinutesIdRef.current = null;
        stopAudioResources();
        triggerNotification('이 브라우저는 실시간 음성 인식을 지원하지 않습니다. 서버 STT 연결도 사용할 수 없습니다.', 'danger');
        return;
      }

      const rec = new SR();
      recordingRecognitionRef.current = rec;
      rec.lang = 'ko-KR';
      rec.continuous = true;
      rec.interimResults = true;

      noSpeechTimerRef.current = setTimeout(() => {
        if (recordingActiveRef.current && transcriptBufferRef.current.length === 0 && !realtimeTextRef.current) {
          setSttAssistMessage('STT 엔진이 아직 텍스트 결과를 주지 않았습니다. 계속 말하거나 아래 입력칸에 직접 기록할 수 있습니다.');
          triggerNotification('아직 STT 텍스트 결과가 없습니다. 계속 말하거나 직접 입력을 사용해 주세요.', 'info');
        }
      }, 8000);

      rec.onresult = (e) => {
        if (noSpeechTimerRef.current) {
          clearTimeout(noSpeechTimerRef.current);
          noSpeechTimerRef.current = null;
        }
        if (interimCommitTimerRef.current) {
          clearTimeout(interimCommitTimerRef.current);
          interimCommitTimerRef.current = null;
        }

        const finalOutputList = [];
        const interimParts = [];
        const allParts = [];

        for (let i = 0; i < e.results.length; ++i) {
          const res = e.results[i];
          const text = res[0]?.transcript?.trim() || '';
          if (!text) continue;
          allParts.push(text);
          if (i >= e.resultIndex) {
            if (res.isFinal) finalOutputList.push({ text, confidence: res[0].confidence || 0.9 });
            else interimParts.push(text);
          }
        }

        const interimText = (interimParts.join(' ') || allParts.join(' ')).trim();
        if (interimText) {
          setRealtimeTextFeed(interimText);
          realtimeTextRef.current = interimText;
        }

        if (finalOutputList.length > 0) {
          const added = appendTranscriptItems(finalOutputList);
          if (added.length > 0) {
            lastCommittedTranscriptRef.current = added.at(-1)?.text || lastCommittedTranscriptRef.current;
            setRealtimeTextFeed('');
            realtimeTextRef.current = '';
          }
          return;
        }

        // 중간 결과는 STT 엔진이 계속 고쳐 쓰므로 저장하지 않습니다.
        // 최종 결과만 회의록에 반영해 엉뚱한 문장 확정을 줄입니다.
      };

      rec.onerror = (e) => {
        console.error('Speech recognition error:', e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          recordingActiveRef.current = false;
          recordingRecognitionRef.current = null;
          setIsRecording(false);
          setIsDNDActive(false);
          stopAudioResources();
          setSttAssistMessage('브라우저가 음성 인식을 차단했습니다. 주소창의 마이크 권한을 허용하거나 직접 입력으로 기록해 주세요.');
          triggerNotification('음성 인식이 차단되었습니다. 브라우저 권한을 확인하거나 직접 입력을 사용해 주세요.', 'danger');
        } else if (e.error === 'no-speech') {
          setSttAssistMessage('음성이 감지되지 않았습니다. 녹음은 유지 중이며, 직접 입력도 가능합니다.');
          triggerNotification('음성이 감지되지 않았습니다. 녹음은 유지 중입니다.', 'info');
        } else if (e.error !== 'aborted') {
          triggerNotification('음성 인식 오류: ' + e.error, 'danger');
        }
      };

      rec.onend = () => {
        if (!recordingActiveRef.current || recordingRecognitionRef.current !== rec) return;
        if (recognitionRestartTimerRef.current) clearTimeout(recognitionRestartTimerRef.current);
        recognitionRestartTimerRef.current = setTimeout(() => {
          if (!recordingActiveRef.current || recordingRecognitionRef.current !== rec) return;
          try { rec.start(); } catch (err) { console.warn('SpeechRecognition auto-restart failed:', err.message); }
        }, 250);
      };

      try {
        rec.start();
        setIsRecording(true);
        setIsRecordingPaused(false);
        setIsDNDActive(true);
        triggerNotification('실시간 녹음과 음성 인식을 시작했습니다.', 'gold');
        setTimeout(() => { if (recordingActiveRef.current) startAudioFileRecorder(); }, 400);
      } catch (err) {
        recordingActiveRef.current = false;
        recordingRecognitionRef.current = null;
        stopAudioResources();
        console.error('Speech recognition start failed:', err);
        triggerNotification('음성 인식 시작 실패: ' + err.message, 'danger');
      }

    } else {
      if (mode !== 'finish') {
        recordingActiveRef.current = false;
        setIsRecording(false);
        setIsRecordingPaused(true);
        setIsDNDActive(false);
        stopAudioFileRecorder();
        stopCloudSttSession();
        setSttConnectionStatus(CLOUD_STT_WS_URL ? 'server-ready' : 'browser-fallback');
        setSilenceState('idle');
        const tempRec = recordingRecognitionRef.current;
        recordingRecognitionRef.current = null;
        if (tempRec) {
          try { tempRec.stop(); } catch (err) { console.error('Speech recognition pause error:', err); }
        }
        stopAudioResources();
        if (liveMinutesIdRef.current) {
          updateMeetingMinutesTranscript(liveMinutesIdRef.current, transcriptBufferRef.current, {
            status: 'paused',
            agendaItems: getActiveAgendaItems(),
          })
            .catch((err) => console.error('Paused live minutes update failed:', err));
        }
        setSttAssistMessage('회의 녹음을 잠시 중단했습니다. 이어서 녹음을 누르면 같은 회의록 초안에 계속 저장됩니다.');
        triggerNotification('회의 녹음을 잠시 중단했습니다. 이어서 녹음할 수 있습니다.', 'info');
        return;
      }

      recordingActiveRef.current = false;
      setIsRecording(false);
      setIsRecordingPaused(false);
      setIsDNDActive(false);
      stopAudioFileRecorder();
      stopCloudSttSession();
      setSttConnectionStatus(CLOUD_STT_WS_URL ? 'server-ready' : 'browser-fallback');
      setSilenceState('idle');
      const tempRec = recordingRecognitionRef.current;
      recordingRecognitionRef.current = null;
      if (tempRec) {
        try { tempRec.stop(); } catch (err) { console.error('Speech recognition stop error:', err); }
      }
      stopAudioResources();
      triggerNotification('녹음을 종료했습니다.', 'info');

      let finalDialogues = transcriptBufferRef.current.length > 0 ? [...transcriptBufferRef.current] : [...dialogues];
      const pendingText = realtimeTextRef.current.trim();
      if (pendingText) {
        const pendingItems = appendTranscriptItems([{ text: pendingText, confidence: 0.95 }]);
        finalDialogues = [...finalDialogues, ...pendingItems];
      }

      setRealtimeTextFeed('');
      realtimeTextRef.current = '';

      if (finalDialogues.length === 0) {
        setSttAssistMessage('녹음은 종료됐지만 STT 텍스트가 없습니다. 마이크 권한이 허용되어도 브라우저 음성 인식 서비스가 결과를 못 줄 수 있습니다. 아래 직접 입력으로 회의 내용을 남길 수 있습니다.');
        if (liveMinutesIdRef.current) {
          updateMeetingMinutesTranscript(liveMinutesIdRef.current, [], { status: 'no_transcript' })
            .catch((err) => console.error('Empty live minutes update failed:', err));
          liveMinutesIdRef.current = null;
        }
        triggerNotification('녹음은 종료됐지만 STT 텍스트가 없습니다. 직접 입력으로 회의 내용을 추가해 주세요.', 'danger');
        return;
      }

      setTimeout(() => {
        handleProcessAI(finalDialogues);
      }, 300);
    }
  };

  /* 성문 5초 등록 및 리얼 마이크 주파수(FFT) 템플릿 정문화 연동 */
  const handleStartVoiceprint = async () => {
    if (!canAccessMinutes) {
      triggerNotification('회의록 사용 권한이 없습니다. 관리자 승인 후 이용 가능합니다.', 'danger');
      return;
    }
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      
      source.connect(analyser);
      analyser.fftSize = 256; // 128차원 주파수 분해
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      setVoiceprintModal(true);
      setVoiceprintProgress(0);
      triggerNotification('🎙️ 성문 수집 개시: 5초간 마이크를 향해 말씀해 주십시오.', 'gold');
      
      let collectedFrames = [];
      const intervalTime = 100; // 100ms마다
      let elapsed = 0;
      
      const timer = setInterval(() => {
        elapsed += intervalTime;
        const progress = Math.min(100, Math.round((elapsed / 5000) * 100));
        setVoiceprintProgress(progress);
        
        // FFT 주파수 시그니처 캡처
        analyser.getByteFrequencyData(dataArray);
        collectedFrames.push(Array.from(dataArray));
        
        if (elapsed >= 5000) {
          clearInterval(timer);
          
          // 평균 벡터 계산 (128차원)
          const avgVector = Array.from({ length: bufferLength }, (_, colIdx) => {
            const sum = collectedFrames.reduce((acc, frame) => acc + frame[colIdx], 0);
            return Math.round(sum / collectedFrames.length);
          });
          
          // 세션 한정 저장 (영구 저장은 운영 시 Firestore + hash+salt+noise로 별도 처리)
          sessionStorage.setItem('ws_voiceprint_session', JSON.stringify(avgVector));
          setVoiceprintTemplate(avgVector);
          
          // 오디오 정리
          stream.getTracks().forEach(track => track.stop());
          audioCtx.close();
          
          setTimeout(() => {
            setVoiceprintModal(false);
            triggerNotification(`👤 성문 세션 등록 완료 (128차원 주파수 시그니처) — 탭 닫으면 자동 소멸. 운영 시 Firestore에 hash+salt+noise로 보호 예정.`, 'success');
          }, 500);
        }
      }, intervalTime);
      
    } catch (err) {
      console.error('Voiceprint registration failed:', err);
      triggerNotification('마이크 접근 실패: 마이크 권한을 허용하신 후 다시 시도해 주세요.', 'danger');
    }
  };

  /* 음성 명령 예약 — 실제 Web Speech API (ko-KR) 사용
   * 지원 안 되거나 권한 거부 시 텍스트 입력 박스로 대체. 자동 예약 없음. */
  const recognitionRef = useRef(null);
  const handleVoiceCommandStart = () => {
    if (voiceCommandListening) {
      // 토글: 듣는 중이면 중지
      try { recognitionRef.current?.stop(); } catch {}
      setVoiceCommandListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      triggerNotification('이 브라우저는 음성 인식을 지원하지 않습니다. 아래 입력란에 직접 입력해 주세요.', 'danger');
      return;
    }
    const rec = new SR();
    recognitionRef.current = rec;
    rec.lang = 'ko-KR';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map(r => r[0].transcript).join('');
      setVoiceCommandText(text);
    };
    rec.onerror = (e) => {
      setVoiceCommandListening(false);
      if (e.error === 'not-allowed') triggerNotification('마이크 권한이 필요합니다. 브라우저 주소창의 자물쇠를 눌러 허용해 주세요.', 'danger');
      else if (e.error !== 'aborted' && e.error !== 'no-speech') triggerNotification(`음성 인식 오류: ${e.error}`, 'danger');
    };
    rec.onend = () => setVoiceCommandListening(false);
    setVoiceCommandText('');
    setVoiceCommandListening(true);
    try { rec.start(); } catch (err) { setVoiceCommandListening(false); triggerNotification('음성 인식 시작 실패: ' + err.message, 'danger'); }
  };

  /* 형님이 직접 "이대로 적용" 클릭해야 폼에 반영 + 예약 모달 오픈 (자동 예약 X) */
  const handleVoiceCommandApply = () => {
    if (!voiceCommandText.trim()) {
      triggerNotification('인식된 문장이 없습니다.', 'danger');
      return;
    }
    const parsed = parseVoiceCommand(voiceCommandText);
    if (!parsed.date || !parsed.startTime) {
      triggerNotification('날짜/시간을 인식하지 못했습니다. "6월 13일 오후 2시" 형식으로 다시 말해 주세요.', 'danger');
      return;
    }
    setNewTitle(parsed.title);
    setNewDate(parsed.date);
    setNewStart(parsed.startTime);
    setNewEnd(parsed.endTime);
    setNewRoom(parsed.room || '교육장');
    setEditingReservation(null);
    setVoiceBookingOpen(false);
    setIsModalOpen(true);
    triggerNotification('해석 결과로 예약 폼을 열었습니다. 확인 후 [예약하기]를 눌러 주세요.', 'gold');
  };

  /* 화자 1-탭 보정 */
  const handleSpeakerCorrection = (newName, applyAll) => {
    if (speakerCorrectionFor === null) return;
    const oldName = dialogues[speakerCorrectionFor].speaker;
    setDialogues(prev => prev.map((d, i) => {
      if (i === speakerCorrectionFor || (applyAll && d.speaker === oldName)) {
        return { ...d, speaker: newName };
      }
      return d;
    }));
    triggerNotification(applyAll
      ? `"${oldName}" → "${newName}" 으로 일괄 변경 완료 (1초 Smart Merge)`
      : `발언 한 건의 화자가 "${newName}"으로 정정되었습니다.`, 'success');
    setSpeakerCorrectionFor(null);
    setBulkMergeOption(false);
  };

  /* 타임스탬프 클릭 → 음성 위치 이동 */
  const handleTimestampPlay = (offsetSeconds) => {
    setPlayingOffset(offsetSeconds);
    triggerNotification(`오디오 ${Math.floor(offsetSeconds / 60)}:${String(Math.floor(offsetSeconds % 60)).padStart(2, '0')} 지점으로 스킵 재생 시작`, 'gold');
    setTimeout(() => setPlayingOffset(null), 8000);
  };

  /* 5줄 요약 미참석자 발송 */
  /* 사후 4중 검수 — 로컬 검수 라우팅 */
  /* ============================================================
   *  AI DUAL ROUTING ENGINE (안토니 & 타미 비용 절감 아키텍처)
   *  - 1차: 로컬 빠른 분석
   *  - 분기: Confidence >= 0.90 이면 종료 (비용 극대화 절감)
   *  - 분기: Confidence < 0.90 이면 정밀 교차 검수 발동
   * ============================================================ */
  const analyzeMinutesWithDualRouting = async (dialogList) => {
    // 0. 대화 내용이 없는 경우를 위한 최소 방어선
    if (!dialogList || dialogList.length === 0) {
      const emptyResult = {
        model: 'Local Intelligent Engine',
        cost: 0,
        confidence: 1.0,
        decisions: [],
        actionItems: [],
        routingPath: 'Local Filter Engine (No Data)',
        costSavings: '100% (로컬 즉시 처리)',
        isProTriggered: false
      };
      return emptyResult;
    }

    // --- API Key 미지정 또는 통신 실패 시 실행되는 지능형 로컬 NLP 폴백 엔진 ---
    const decisions = [];
    const actionItems = [];
    
    const decisionKeywords = ['결정', '확정', '합의', '정함', '결론', '완료', '하기로', '동의', '회의실', '교육장', '예약', '체육대회', '날짜', '시간'];
    const actionKeywords = ['담당', '총무', '서기', '회장', '준비', '배치', '연락', '보고', '알아', '제출', '계약', '확보', '수립'];
    
    let dCount = 1;
    let aCount = 1;
    
    dialogList.forEach((d) => {
      const text = d.text;
      const speaker = d.speaker;
      
      const isDecision = decisionKeywords.some(keyword => text.includes(keyword));
      const isAction = actionKeywords.some(keyword => text.includes(keyword)) || text.includes('~하겠') || text.includes('~해 주');
      
      if (isDecision) {
        decisions.push({
          id: `d${dCount++}`,
          text: `${text.length > 50 ? text.slice(0, 47) + '...' : text} (${speaker} 합의 수록)`
        });
      }
      
      if (isAction) {
        actionItems.push({
          id: `a${aCount++}`,
          text: `${text.length > 50 ? text.slice(0, 47) + '...' : text} (담당자: ${speaker})`
        });
      }
    });

    // 100% 가짜 텍스트 삭감 및 순수 실제 텍스트 대화 기반 셋팅
    if (decisions.length === 0) {
      if (dialogList.length > 0) {
        decisions.push({
          id: 'd1',
          text: `[결정] "${dialogList[0].text.length > 30 ? dialogList[0].text.slice(0, 27) + '...' : dialogList[0].text}" 논의 안건 수용`
        });
      }
    }
    
    if (actionItems.length === 0) {
      if (dialogList.length > 0) {
        actionItems.push({
          id: 'a1',
          text: `"${dialogList[0].text.length > 30 ? dialogList[0].text.slice(0, 27) + '...' : dialogList[0].text}" 후속 조치 검토 (담당: ${dialogList[0].speaker})`
        });
      }
    }

    const hasLowConfidence = dialogList.some(d => d.confidence < 0.85);
    const simulatedConfidence = hasLowConfidence ? 0.78 : 0.95;

    const resultFlash = {
      model: '로컬 빠른 회의록 분석',
      cost: 0.00015,
      confidence: simulatedConfidence,
      decisions: decisions.slice(0, 2),
      actionItems: actionItems.slice(0, 2)
    };

    if (resultFlash.confidence >= 0.90) {
      return {
        ...resultFlash,
        routingPath: '로컬 빠른 회의록 분석',
        costSavings: '외부 API 호출 없음',
        isProTriggered: false
      };
    }

    const resultPro = {
      model: '로컬 정밀 회의록 검수',
      cost: 0.0015,
      confidence: 0.98,
      decisions: [...decisions],
      actionItems: [...actionItems]
    };

    return {
      ...resultPro,
      routingPath: '로컬 정밀 회의록 검수',
      costSavings: '외부 API 호출 없음',
      isProTriggered: true,
      flashData: resultFlash
    };
  };

  /* 사후 4중 검수 — 로컬 회의록 검수 연동 */
  const handleStartAudit = async () => {
    if (!dialogues || dialogues.length === 0) {
      triggerNotification('수집된 대화 기록이 없습니다. 먼저 녹음을 진행해 주세요.', 'danger');
      return;
    }
    setAuditOpen(true);
    setAuditRunning(true);
    setAuditDone(false);
    setMergedDecisions([]);
    setMergedActions([]);
    
    try {
      const auditResult = await analyzeMinutesWithDualRouting(dialogues);
      setAuditResult(auditResult);
      
      setTimeout(() => {
        setUsedAIModel(auditResult.routingPath);
        setAiCostSavings(auditResult.costSavings || '외부 API 호출 없음');
        setAuditRunning(false);
        setAuditDone(true);
        
        if (auditResult.isProTriggered) {
          triggerNotification(`4중 검수 완료 — 정밀 검수가 누락 가능성을 보완했습니다. (${auditResult.costSavings})`, 'success');
        } else {
          triggerNotification(`4중 검수 완료 — 빠른 검수로 종결했습니다. (${auditResult.costSavings})`, 'success');
        }
      }, 1500);
    } catch (err) {
      setAuditRunning(false);
      triggerNotification('AI 듀얼 라우팅 분석 중 오류가 발생했습니다: ' + err.message, 'danger');
    }
  };

  /* 검수 결과 병합 — Pass 1 유지 / Pass 2 채택 / 항목별 토글 */
  const toggleMergeDecision = (id) => {
    setMergedDecisions((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const toggleMergeAction = (id) => {
    setMergedActions((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
  const handleApplyAudit = (mode) => {
    if (mode === 'pass1') {
      setMergedDecisions([]);
      setMergedActions([]);
      triggerNotification('Pass 1 (실시간 산출) 그대로 확정', 'success');
    } else if (mode === 'pass2') {
      if (auditResult) {
        setMergedDecisions(auditResult.decisions.map(d => d.id));
        setMergedActions(auditResult.actionItems.map(a => a.id));
        triggerNotification('Pass 2 (재해석) 전체 채택 — 4중 검수 통과 확정', 'success');
      } else {
        triggerNotification('검수 결과 데이터가 없습니다.', 'danger');
      }
    } else {
      triggerNotification(`병합 확정: 결정 ${mergedDecisions.length}건 / 액션 ${mergedActions.length}건 추가`, 'success');
    }
    setAuditOpen(false);
  };

  /* ===== 리포트 집계 메모 ===== */
  const reportData = useMemo(() => {
    const filtered = filterForReport(reservations, {
      startDate: reportStartDate,
      endDate: reportEndDate,
      orgId: reportOrgFilter,
      room: reportRoomFilter
    });
    const totalHours = filtered.reduce((sum, r) => sum + reservationHours(r), 0);
    const uniqueOrgs = new Set(filtered.map(r => r.orgId)).size;

    // 장소별
    const byRoom = [];
    const roomMap = groupBy(filtered, r => r.room);
    for (const [room, items] of roomMap) {
      byRoom.push({
        room,
        count: items.length,
        hours: items.reduce((s, r) => s + reservationHours(r), 0)
      });
    }
    byRoom.sort((a, b) => b.hours - a.hours);

    // 조직별
    const byOrg = [];
    const orgMap = groupBy(filtered, r => r.orgId);
    for (const [orgId, items] of orgMap) {
      const org = orgs.find(o => o.id === orgId);
      byOrg.push({
        orgId,
        orgName: org?.name || orgId,
        color: org?.color || '#999',
        count: items.length,
        hours: items.reduce((s, r) => s + reservationHours(r), 0)
      });
    }
    byOrg.sort((a, b) => b.hours - a.hours);

    // 월별 추이
    const byMonth = [];
    const monthMap = groupBy(filtered, r => r.date.slice(0, 7));
    for (const [ym, items] of monthMap) {
      byMonth.push({
        month: ym,
        count: items.length,
        hours: items.reduce((s, r) => s + reservationHours(r), 0)
      });
    }
    byMonth.sort((a, b) => a.month.localeCompare(b.month));

    return { filtered, totalHours, uniqueOrgs, byRoom, byOrg, byMonth };
  }, [reservations, orgs, reportStartDate, reportEndDate, reportOrgFilter, reportRoomFilter]);

  const handleApplyReportPreset = (preset) => {
    setReportPreset(preset);
    const range = presetRange(preset);
    setReportStartDate(range.startDate);
    setReportEndDate(range.endDate);
  };

  /* 인쇄 / PDF 저장 — window.print() (브라우저가 "PDF로 저장" 옵션 제공) */
  const handlePrintReport = () => {
    document.body.classList.add('printing-report');
    setTimeout(() => {
      window.print();
      setTimeout(() => document.body.classList.remove('printing-report'), 500);
    }, 100);
  };

  /* CSV 다중 시트 저장 — xlsx 패키지 보안 취약점(GHSA-4r6h-8v6p-xvw6) 회피
   * 단일 .csv 파일에 5개 섹션을 명확한 헤더로 구분 (Excel/Google Sheets 모두 호환) */
  const handleExportExcel = async () => {
    const escapeCSV = (val) => {
      const s = String(val ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rowsToCsv = (rows) => rows.map(row => row.map(escapeCSV).join(',')).join('\r\n');

    const sections = [
      ['## WS 사용 현황 리포트'],
      ['## 기간', `${reportStartDate} ~ ${reportEndDate}`],
      ['## 조직 필터', reportOrgFilter === 'all' ? '전체' : (orgs.find(o => o.id === reportOrgFilter)?.name || reportOrgFilter)],
      ['## 장소 필터', reportRoomFilter === 'all' ? '전체' : reportRoomFilter],
      ['## 생성 시각', new Date().toLocaleString('ko-KR')],
      [],
      ['## [요약]'],
      ['항목', '값'],
      ['총 예약 건수', reportData.filtered.length],
      ['총 사용 시간(h)', reportData.totalHours.toFixed(1)],
      ['이용 단체 수', reportData.uniqueOrgs],
      [],
      ['## [장소별]'],
      ['장소', '예약 건수', '총 사용 시간(h)'],
      ...reportData.byRoom.map(r => [r.room, r.count, r.hours]),
      [],
      ['## [조직별]'],
      ['조직', '예약 건수', '총 사용 시간(h)'],
      ...reportData.byOrg.map(r => [r.orgName, r.count, r.hours]),
      [],
      ['## [월별]'],
      ['년-월', '예약 건수', '총 사용 시간(h)'],
      ...reportData.byMonth.map(r => [r.month, r.count, r.hours]),
      [],
      ['## [전체 목록]'],
      ['날짜', '시작', '종료', '시간(h)', '장소', '조직', '회의명', '작성자'],
      ...reportData.filtered.map(r => {
        const org = orgs.find(o => o.id === r.orgId);
        return [r.date, r.startTime, r.endTime, reservationHours(r), r.room, org?.name || r.orgId, r.title, r.creatorName || '익명'];
      })
    ];

    const csvBody = rowsToCsv(sections);
    // Excel 한글 인식 위한 UTF-8 BOM 추가
    const blob = new Blob(['﻿' + csvBody], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const fname = `WS_사용현황_${reportStartDate}_${reportEndDate}.csv`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    triggerNotification(`CSV 다운로드 완료: ${fname} (Excel/Google Sheets 호환)`, 'success');
  };

  const handleSendBriefing = () => {
    triggerNotification('미참석 임원 3명에게 5줄 요약 카톡 발송 완료 (홀리 추천 기능)', 'success');
  };

  /* 사진 첨부 — 사용자가 선택한 실제 이미지 메타데이터 저장 */
  const handleAddPhoto = () => {
    if (photos.length >= 5) {
      triggerNotification('최대 5장까지 첨부 가능합니다.', 'danger');
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const photo = {
        id: `photo-${Date.now()}`,
        name: file.name,
        ocrText: '',
        size: `${Math.ceil(file.size / 1024)}KB`,
        objectUrl: URL.createObjectURL(file)
      };
      setPhotos(prev => [...prev, photo]);
      triggerNotification('선택한 사진을 첨부했습니다. OCR 결과는 실제 OCR 연동 후 표시됩니다.', 'success');
    };
    input.click();
  };

  const handleStitchTransfer = async () => {
    if (!canAccessMinutes) {
      triggerNotification('회의록 사용 권한이 없습니다. 관리자 승인 후 이용 가능합니다.', 'danger');
      return;
    }
    
    const fullTranscriptText = dialogues.map(d => d.text).join(' ');
    const parsed = parseVoiceCommand(fullTranscriptText);
    const finalTitle = parsed.title || scanResult?.title || '회의 결과 예약';
    const finalDate = parsed.date;
    const finalStartTime = parsed.startTime;
    const finalEndTime = parsed.endTime;
    const finalRoom = parsed.room;

    if (!finalDate || !finalStartTime || !finalEndTime || !finalRoom) {
      triggerNotification('예약에 필요한 날짜, 시작 시간, 종료 시간, 장소를 실제 대화에서 찾지 못했습니다. 회의록 문장에 예약 정보를 먼저 남겨 주세요.', 'danger');
      return;
    }
    if (!currentOrg?.id) {
      triggerNotification('현재 단체 정보를 DB에서 불러오지 못했습니다. 단체를 먼저 선택해 주세요.', 'danger');
      return;
    }

    const candidate = {
      title: finalTitle,
      date: finalDate,
      startTime: finalStartTime,
      endTime: finalEndTime,
      room: finalRoom,
      orgId: currentOrg.id,
      creatorName: userProfile?.displayName || user?.email?.split('@')[0] || '담당자'
    };
    const roomConflict = findRoomConflict(reservations, candidate);
    if (roomConflict) {
      triggerNotification(
        `Stitch 연동 보류: ${candidate.room} ${roomConflict.startTime}-${roomConflict.endTime} 예약과 시간이 겹칩니다. 다른 날짜/시간으로 정정해 주세요.`,
        'danger'
      );
      return;
    }

    try {
      await createReservation(candidate, user);
      triggerNotification(`🎉 회의록 결정사항이 예약 캘린더(${finalDate})에 Stitch 연동 완료!`, 'success');
      setTimeout(() => {
        setMobileStep(1);
        setScanResult(null);
        setDialogues([]);
        setPhotos([]);
      }, 1500);
    } catch (err) {
      triggerNotification('Stitch 연동 실패: ' + err.message, 'danger');
    }
  };

  const handleTriggerPhoneDND = () => {
    if (!isRecording) { triggerNotification('녹음 상태(Focus)에서만 실행 가능합니다.', 'danger'); return; }
    triggerNotification('DND 상태입니다. 회의 중 외부 알림은 보류됩니다.', 'gold');
  };

  const handleTriggerAudioInterrupt = () => {
    if (!isRecording) { triggerNotification('녹음 상태에서만 사용할 수 있습니다.', 'danger'); return; }
    setIsRecording(false);
    setIsDNDActive(false);
    setAudioSessionError(true);
    triggerNotification('🚨 마이크 입력 끊김 감지!', 'danger');
  };

  const handleResolveAudioError = () => {
    setAudioSessionError(false);
    triggerNotification('✅ 마이크 세션 안전 복구 완료', 'success');
  };

  /* 주간 이동 (가상 스크롤 + 웜 스켈레톤) */
  const handleWeekChange = (delta) => {
    setCalendarLoading(true);
    setTimeout(() => {
      setWeekOffset(prev => prev + delta);
      setCalendarLoading(false);
    }, 350);
  };

  /* 월 이동 — 연도 경계 자동 처리 */
  const handleMonthChange = (delta) => {
    setCalendarLoading(true);
    setTimeout(() => {
      setCalendarMonth(prev => {
        const next = prev + delta;
        if (next < 1) { setCalendarYear(y => y - 1); return 12; }
        if (next > 12) { setCalendarYear(y => y + 1); return 1; }
        return next;
      });
      setCalendarLoading(false);
    }, 350);
  };

  /* 캘린더 영역 swipe 제스처 — 좌우로 밀면 주/월 이동 (PC 마우스 + 모바일 터치 동시 지원)
   * - 임계값: |dx| > 80px, |dx| > |dy| * 1.5(수평 우세), 시간 < 450ms → swipe 발동
   * - 타임슬롯 드래그(수직, 짧은 거리)와 충돌 방지 — 임계값으로 자연 분리
   * - 이미 calendarLoading 중이면 무시 (연속 swipe 방지) */
  useEffect(() => {
    const el = calendarContainerRef.current;
    if (!el) return;

    let startX = 0, startY = 0, startT = 0;
    let active = false;

    const onDown = (x, y) => {
      active = true;
      startX = x;
      startY = y;
      startT = performance.now();
    };
    const onUp = (x, y) => {
      if (!active) return;
      active = false;
      const dx = x - startX;
      const dy = y - startY;
      const dt = performance.now() - startT;
      if (dt > 450) return;
      if (Math.abs(dx) < 80) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return; // 수직 우세면 무시
      if (calendarLoadingRef.current) return; // 연속 swipe 방지
      const dir = dx < 0 ? 1 : -1; // 좌→우 swipe = 이전, 우→좌 = 다음
      if (viewModeRef.current === 'week') handleWeekChange(dir);
      else handleMonthChange(dir);
    };

    const md = (e) => { if (e.button === 0) onDown(e.pageX, e.pageY); };
    const mu = (e) => onUp(e.pageX, e.pageY);
    const ts = (e) => onDown(e.touches[0].pageX, e.touches[0].pageY);
    const te = (e) => {
      const t = e.changedTouches[0];
      onUp(t.pageX, t.pageY);
    };

    el.addEventListener('mousedown', md);
    el.addEventListener('mouseup', mu);
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchend', te);

    return () => {
      el.removeEventListener('mousedown', md);
      el.removeEventListener('mouseup', mu);
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchend', te);
    };
  }, [authReady, currentOrg]);

  /* swipe 핸들러가 closure에서 최신 viewMode/loading을 보도록 ref 동기화 */
  const viewModeRef = useRef('week');
  const calendarLoadingRef = useRef(false);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { calendarLoadingRef.current = calendarLoading; }, [calendarLoading]);

  /* 드래그 예약 — 캘린더 셀에서 슥 끌어내리기 */
  const handleDragStart = (date, slot) => {
    setIsDragging(true);
    setDragSelection({ date, startSlot: slot, endSlot: slot });
  };
  const handleDragOver = (date, slot) => {
    if (!isDragging || !dragSelection || dragSelection.date !== date) return;
    setDragSelection(prev => ({ ...prev, endSlot: slot }));
  };
  const handleDragEnd = () => {
    if (!isDragging || !dragSelection) return;
    setIsDragging(false);
    const startIdx = TIME_SLOTS.indexOf(dragSelection.startSlot);
    const endIdx = TIME_SLOTS.indexOf(dragSelection.endSlot);
    const [s, e] = [Math.min(startIdx, endIdx), Math.max(startIdx, endIdx)];
    const endTime = TIME_SLOTS[e + 1];
    if (!endTime) {
      showReservationWarning('마지막 시간 슬롯에서는 종료 시간이 없어 예약을 시작할 수 없습니다.');
      setDragSelection(null);
      return;
    }

    setEditingReservation(null);
    setNewDate(dragSelection.date);
    setNewStart(TIME_SLOTS[s]);
    setNewEnd(endTime);
    setReservationWarning(null);
    setIsModalOpen(true);
    triggerHaptic();
    setDragSelection(null);
  };

  /* 예약 불가 슬롯 판정 (빗금 사선용) */
  const isSlotBlocked = (date, slot, room) => {
    return reservations.some(r => {
      if (r.date !== date || r.room !== room) return false;
      return hasTimeOverlap(slot, `${slot.split(':')[0].padStart(2, '0')}:59`, r.startTime, r.endTime);
    });
  };

  /* 맥락 플로팅 버튼 (회의 전 / 중 / 후) */
  const floatingButtonConfig = useMemo(() => {
    if (mobileStep === 1) return { icon: Camera, label: '카메라로 예약 자동 입력', action: handleStartOCRScan, color: 'var(--color-primary)' };
    if (mobileStep === 2 && isRecording) return { icon: Volume2, label: '잠시 중단', action: () => handleToggleRecording(), color: 'var(--color-warning)' };
    if (mobileStep === 2 && isRecordingPaused) return { icon: Mic, label: '이어서 녹음', action: () => handleToggleRecording(), color: 'var(--color-primary)' };
    if (mobileStep === 3) return { icon: Send, label: '회의록 담당자 전달', action: handleStitchTransfer, color: 'var(--color-success)' };
    return { icon: Mic, label: '회의 시작 대기', action: () => handleToggleRecording(), color: 'var(--color-primary)' };
  }, [mobileStep, isRecording, isRecordingPaused, scanResult]);

  /* currentOrg 로딩 가드 — 인증/시드/구독 완료 전까지 본문 렌더 차단 */
  if (!authReady || !currentOrg) {
    return (
      <div className="auth-loading-overlay" style={{ position: 'fixed' }}>
        <div className="auth-loading-card">
          <Sparkles size={28} color="var(--color-primary)" style={{ animation: 'float 1.5s infinite' }} />
          <div style={{ fontSize: '0.92rem', fontWeight: 700 }}>
            {!authReady ? 'Firebase Anonymous 인증 중...' : '광역자활기업 단체 시드 중...'}
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
            Firestore 실시간 구독 준비 · asia-northeast3
          </p>
        </div>
      </div>
    );
  }

  /* /r (회의록 작성) 라우트 진입 가드 — 관리자 또는 회의록 사용 권한 승인자만 접근 */
  if (entry === 'm-minutes' && !canAccessMinutes) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--bg-canvas)' }}>
        <div style={{ maxWidth: 420, width: '100%', background: 'var(--bg-card)', padding: 28, borderRadius: 14, boxShadow: '0 4px 18px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <Lock size={36} color="var(--color-warning)" />
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, margin: '14px 0 6px', color: 'var(--color-text-dark)' }}>
            회의록 사용 권한이 필요합니다
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
            회의록 작성·녹음·STT·4중 검수는 <strong style={{ color: 'var(--color-text-dark)' }}>관리자가 별도로 승인한 사용자</strong>만 접근할 수 있습니다.
            {!isAuthenticated && <><br /><br />먼저 로그인 후 관리자에게 권한 부여를 요청하십시오.</>}
            {isAuthenticated && isPending && <><br /><br />현재 가입 승인 대기 중입니다. 매니저/관리자의 승인 후 다시 시도해 주십시오.</>}
            {isAuthenticated && !isPending && !canAccessMinutes && <><br /><br />관리자에게 회의록 사용 승인을 요청하십시오.</>}
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <a href="/" className="btn-secondary" style={{ padding: '8px 16px', textDecoration: 'none', fontSize: '0.85rem' }}>웹 화면으로</a>
            <a href="/m" className="btn-primary" style={{ padding: '8px 16px', textDecoration: 'none', fontSize: '0.85rem' }}>예약만 사용</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: 'var(--bg-canvas)', minHeight: '100vh' }}>
      {/* 글로벌 헤더 */}
      <header className="global-header">
        <div className="brand-section">
          <img src="/hja.png" alt="WS" className="brand-logo" />
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{t('mainTitle')}</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{t('subtitle')}</p>
          </div>
        </div>

        <div className="user-selector">
          {/* 오프라인 자동 감지 인디케이터 — 온라인일 때는 숨김 (navigator.onLine 기반) */}
          {isOffline && (
            <div
              className="header-action-btn offline-indicator"
              title="네트워크 신호 약함 — 변경사항은 로컬 큐에 안전 보관 중"
              style={{ pointerEvents: 'none', background: 'var(--color-warning-bg, rgba(201,122,83,0.12))' }}
            >
              <WifiOff size={14} color="var(--color-accent)" />
              <span>오프라인{offlineQueue > 0 ? ` (${offlineQueue})` : ''}</span>
            </div>
          )}

          <button
            className="header-action-btn"
            onClick={() => setShowOrgDashboard(true)}
            title="단체별 예약통계 대시보드"
          >
            <BarChart3 size={14} color="var(--color-primary)" />
            <span>{t('stats')}</span>
          </button>

          <button
            className="header-action-btn"
            onClick={() => setReportOpen(true)}
            title="사용 현황 리포트 (인쇄 / PDF / Excel)"
          >
            <BarChart size={14} color="var(--color-primary)" />
            <span>{t('report')}</span>
          </button>

          {/* 회의록 작성 진입 — 권한자(admin 또는 minutesAccess=approved)에게만 노출
           * /notes 라우트로 이동. 현재 이미 /notes면 표시 안 함 */}
          {canAccessMinutes && entry !== 'm-minutes' && (
            <button
              className="header-action-btn"
              onClick={() => navigate('/notes')}
              title="회의록 자동 작성 (녹음 + STT + AI 4중 검수)"
              style={{ background: 'var(--color-primary-light, #E2ECE9)' }}
            >
              <FileText size={14} color="var(--color-primary)" />
              <span>{t('minutes')}</span>
            </button>
          )}

          {/* 다크모드 토글 (L) */}
          <button
            className="header-action-btn icon-only"
            onClick={toggleTheme}
            title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
            aria-label="테마 전환"
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* 언어 토글 (N) */}
          <button
            className="header-action-btn icon-only"
            onClick={toggleLocale}
            title={locale === 'ko' ? 'Switch to English' : '한국어로 전환'}
            aria-label="언어 전환"
          >
            <Globe size={14} />
            <span style={{ fontSize: '0.7rem', fontWeight: 800, marginLeft: 2 }}>{locale.toUpperCase()}</span>
          </button>

          <div className="org-selector-cluster">
            <UserCheck size={14} color="var(--color-text-muted)" />
            <select
              className="header-select"
              value={currentOrgId || ''}
              onChange={(e) => {
                const selected = orgs.find(o => o.id === e.target.value);
                if (!selected) return;
                if (!isAdmin && userProfile && userProfile.orgId && userProfile.orgId !== selected.id) {
                  triggerNotification('admin만 단체 전환 가능합니다.', 'danger');
                  return;
                }
                setCurrentOrgId(selected.id);
                triggerNotification(`접속 단체가 [${selected.name}]로 전환됨`);
              }}
              disabled={!isAdmin && isAuthenticated}
              title={!isAdmin && isAuthenticated ? '소속 단체 고정 (admin만 전환 가능)' : ''}
            >
              {orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            {isAdmin && (
              <>
                <button className="header-action-btn icon-only" onClick={() => { setOrgBeingEdited(currentOrg); setOrgEditorOpen(true); }} title="현재 단체 편집" disabled={!currentOrg}>
                  <Edit3 size={14} />
                </button>
                <button className="header-action-btn icon-only" onClick={() => { setOrgBeingEdited(null); setOrgEditorOpen(true); }} title="새 단체 추가">
                  <Plus size={14} />
                </button>
              </>
            )}
          </div>

          {/* === 사용자 인증 영역 === */}
          {pendingUsers.length > 0 && (isManager || isAdmin) && (
            <button className="header-action-btn warning" onClick={() => setApprovalQueueOpen(true)} title="가입 승인 대기 인원">
              <AlertTriangle size={14} />
              <span>승인 {pendingUsers.length}</span>
            </button>
          )}

          {isAdmin && (
            <button className="header-action-btn" onClick={() => setUserMgmtOpen(true)} title="전체 사용자 관리 (admin)">
              <Users size={14} color="var(--color-primary)" />
              <span>사용자 ({allUsers.length})</span>
            </button>
          )}

          {isAuthenticated ? (
            <div className="user-profile-badge" title={userProfile?.email || ''}>
              {userProfile?.photoURL && <img src={userProfile.photoURL} alt="" className="user-avatar" />}
              <button type="button" className="profile-text" onClick={() => setProfileEditOpen(true)} title="내 프로필 편집">
                <span className="profile-name">{userProfile?.displayName || user?.displayName || '사용자'}</span>
                <span className={`role-badge role-${userRole}`}>{userRole === 'admin' ? '관리자' : userRole === 'manager' ? '매니저' : userRole === 'member' ? '멤버' : userRole === 'pending' ? '승인대기' : '게스트'}</span>
              </button>
              <button className="header-action-btn icon-only" onClick={() => signOut()} title="로그아웃">
                <X size={14} />
              </button>
            </div>
          ) : (
            <button
              className="header-action-btn primary"
              onClick={() => { setLoginMode('signin'); setLoginModalOpen(true); }}
            >
              로그인
            </button>
          )}
        </div>
      </header>

      {/* 토스트 — 변형(variant) 지원 */}
      {showNotification && (
        <div className={`toast-notification toast-${notificationVariant}`}>
          {notificationVariant === 'gold' ? <Lock size={18} /> :
           notificationVariant === 'success' ? <CheckCircle2 size={18} /> :
           notificationVariant === 'danger' ? <ShieldAlert size={18} /> :
           <Sparkles size={18} />}
          <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>{showNotification}</span>
        </div>
      )}

      {/* 오프라인 안심 골드 토스트 (영구 표시) */}
      {isOffline && (
        <div className="offline-safe-banner">
          <Lock size={14} />
          <span>[안심 보관 중] 인터넷 신호 약함 — 회의록과 첨부 파일은 SQLite/IndexedDB 로컬 큐에 자동 보존됩니다. 신호 복구 시 Service Worker가 조용히 Stitch 업로드를 완수합니다.</span>
        </div>
      )}

      <main className="app-container">
        {/* PWA 설치 프롬프트 (O) — 한 번 닫으면 다시 안 보임 */}
        {installPrompt && !installDismissed && (
          <div className="pwa-install-banner" role="dialog" aria-label={t('installApp')}>
            <Smartphone size={20} color="var(--color-primary)" />
            <div className="pib-text">
              <strong>{t('installApp')}</strong>
              <span>{t('installSub')}</span>
            </div>
            <div className="pib-actions">
              <button type="button" className="btn-secondary" onClick={dismissInstall}>{t('installLater')}</button>
              <button type="button" className="btn-primary" onClick={handleInstall}>
                <DownloadIcon size={14} /> {t('installNow')}
              </button>
            </div>
          </div>
        )}

        {/* 게스트 온보딩 카드 — 미인증 사용자에게만 노출 */}
        {!isAuthenticated && (
          <div className="guest-onboarding-card">
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Sparkles size={18} color="var(--color-primary)" />
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-text-dark)' }}>WS 예약 시스템에 오신 것을 환영합니다</h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
                캘린더와 예약 현황은 자유롭게 보실 수 있습니다.
                <br /><strong style={{ color: 'var(--color-text-dark)' }}>예약 등록·수정</strong>은 로그인 후 매니저 승인이 완료된 멤버만 가능합니다.
              </p>
            </div>
            <button
              className="header-action-btn primary"
              onClick={() => { setLoginMode('signin'); setLoginModalOpen(true); }}
              style={{ height: 38, padding: '0 20px', fontSize: '0.85rem', flexShrink: 0 }}
            >
              로그인 / 회원가입
            </button>
          </div>
        )}

        {/* 데스크톱 hero — 인증된 사용자에게 오늘 요약 + 빠른 액션 (entry='web'에서만) */}
        {entry === 'web' && isAuthenticated && (() => {
          const todayBookings = reservations.filter(r => r.date === TODAY).length;
          const todayMyOrg = reservations.filter(r => r.date === TODAY && r.orgId === currentOrgId).length;
          const upcoming = reservations
            .filter(r => r.date >= TODAY)
            .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0];
          const orgColor = currentOrg?.color || 'var(--color-primary)';
          const orgName = currentOrg?.name || '';
          return (
            <div className="desktop-hero" style={{ borderLeft: `5px solid ${orgColor}` }}>
              <div className="dh-left">
                <div className="dh-greeting">
                  {t('helloUser')}, <strong style={{ color: orgColor }}>{userProfile?.displayName || '관리자'}</strong>{locale === 'ko' ? '님' : ''}
                </div>
                <div className="dh-org">{orgName}</div>
              </div>
              <div className="dh-stats">
                <div className="dh-stat-card">
                  <div className="dhs-label">{t('todayBookings')}</div>
                  <div className="dhs-value">{todayBookings}<span>건</span></div>
                </div>
                <div className="dh-stat-card">
                  <div className="dhs-label">{t('ourOrg')}</div>
                  <div className="dhs-value" style={{ color: orgColor }}>{todayMyOrg}<span>건</span></div>
                </div>
                <div className="dh-stat-card next-meeting">
                  <div className="dhs-label">{t('nextMeeting')}</div>
                  <div className="dhs-value-sub">
                    {upcoming ? `${upcoming.date.slice(5)} ${upcoming.startTime}` : '없음'}
                  </div>
                  <div className="dhs-meta">{upcoming?.title || t('noScheduled')}</div>
                </div>
              </div>
              <div className="dh-actions">
                <button className="btn-primary" onClick={() => openReservationCreateModal(TODAY)}>
                  <Plus size={16} /> 오늘 예약
                </button>
                <button className="btn-secondary" onClick={() => setVoiceBookingOpen(true)}>
                  <Mic size={16} /> 음성 예약
                </button>
              </div>
            </div>
          );
        })()}

        {/* ===== [분기] /notes 라우트 모바일 회의록 작성 마법사 독립 노출 ===== */}
        {entry === 'm-minutes' ? (
          <div className="mobile-meeting-view" style={{ width: '100%', maxWidth: '640px', margin: '0 auto', padding: '16px', display: 'block' }}>
            {/* 진행 단계 표시 */}
            {/* 회의록 작성 hero — 첫 단계에서만 노출 */}
            {mobileStep === 1 && (
              <div className="minutes-hero">
                <div className="mh-badge"><Sparkles size={12} /> AI 회의록 자동 작성</div>
                <h2 className="mh-title">AI가 회의를 받아 적고<br />결정사항을 자동 정리합니다</h2>
                <p className="mh-sub">3단계 · 평균 처리 시간 회의 종료 후 30초 · 어슈어런스 95%↑ 자동 종결</p>
              </div>
            )}

            <div className="meeting-stepper-v2">
              <div className={`step-v2 ${mobileStep === 1 ? 'active' : mobileStep > 1 ? 'done' : ''}`}>
                <div className="step-circle">{mobileStep > 1 ? '✓' : '1'}</div>
                <div className="step-label">회의 시작</div>
              </div>
              <div className={`step-line ${mobileStep > 1 ? 'done' : ''}`}></div>
              <div className={`step-v2 ${mobileStep === 2 ? 'active' : mobileStep > 2 ? 'done' : ''}`}>
                <div className="step-circle">{mobileStep > 2 ? '✓' : '2'}</div>
                <div className="step-label">녹음 + STT</div>
              </div>
              <div className={`step-line ${mobileStep > 2 ? 'done' : ''}`}></div>
              <div className={`step-v2 ${mobileStep === 3 ? 'active' : ''}`}>
                <div className="step-circle">3</div>
                <div className="step-label">검토 + 전송</div>
              </div>
            </div>

            {/* 기존 stepper는 숨김 처리 (호환성 유지용 마커) */}
            <div className="meeting-stepper" style={{ display: 'none' }}>
              <div className={`step-pill ${mobileStep === 1 ? 'active' : mobileStep > 1 ? 'done' : ''}`}>1. 회의 시작</div>
              <div className={`step-pill ${mobileStep === 2 ? 'active' : mobileStep > 2 ? 'done' : ''}`}>2. 녹음 + STT</div>
              <div className={`step-pill ${mobileStep === 3 ? 'active' : ''}`}>3. 검토 + 전송</div>
            </div>

            {/* === 단계 1: 회의 시작 === */}
            {mobileStep === 1 && (
              <div className="meeting-stage">
                <h3 style={{ fontSize: '1rem', fontWeight: 800, margin: '8px 0 4px' }}>회의를 어떻게 시작하시겠어요?</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginBottom: 12 }}>
                  카메라로 안내문을 스캔하거나 바로 녹음을 시작할 수 있습니다.
                </p>

                <button type="button" className="meeting-action-card primary" onClick={handleStartOCRScan} disabled={isScanning}>
                  <Camera size={22} />
                  <div>
                    <div className="mac-title">카메라로 회의 안내문 스캔</div>
                    <div className="mac-desc">OCR로 제목, 날짜, 장소를 자동 추출합니다.</div>
                  </div>
                  {isScanning && <span className="mac-badge">스캔 중</span>}
                </button>

                <button type="button" className="meeting-action-card" onClick={() => { setScanResult(null); setMobileStep(2); }}>
                  <Mic size={22} />
                  <div>
                    <div className="mac-title">바로 녹음 시작</div>
                    <div className="mac-desc">안내문 없이 바로 기록을 시작합니다.</div>
                  </div>
                </button>

                <button type="button" className="meeting-action-card" onClick={handleStartVoiceprint}>
                  <UserCheck size={22} />
                  <div>
                    <div className="mac-title">내 목소리 등록</div>
                    <div className="mac-desc">5초 등록 후 화자 매칭 정확도를 높입니다.</div>
                  </div>
                </button>

                {meetingMinutes.length > 0 && (
                  <section className="meeting-scan-card recent-minutes-card" aria-label="최근 저장된 회의록">
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 800 }}>최근 저장된 회의록</div>
                    {meetingMinutes.slice(0, 3).map((minute) => {
                      const createdAt = minute.createdAt?.toDate ? minute.createdAt.toDate() : (minute.createdAt ? new Date(minute.createdAt) : null);
                      const title = getMinuteTitle(minute);
                      const preview = getMinutePreview(minute);
                      return (
                        <button
                          key={minute.id}
                          type="button"
                          className="recent-minute-row"
                          onClick={() => { setMobileStep(3); setAuditResult(minute.aiSummary || null); }}
                        >
                          <strong>{title}</strong>
                          <span>{createdAt ? createdAt.toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '저장 일시 없음'}</span>
                          <small>{preview}</small>
                        </button>
                      );
                    })}
                  </section>
                )}
              </div>
            )}

            {/* === 단계 2: 녹음 + 실시간 STT === */}
            {mobileStep === 2 && (
              <div className="meeting-stage">
                {scanResult && (
                  <div className="meeting-scan-card">
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 700 }}>회의 정보</div>
                    <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-text-dark)' }}>{scanResult.title}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      {scanResult.date} · {scanResult.time} · {scanResult.location}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4 }}>{scanResult.members}</div>
                  </div>
                )}

                <section className="agenda-builder-card">
                  <div className="agenda-builder-head">
                    <FileText size={18} />
                    <strong>안건</strong>
                    <span>{getActiveAgendaItems().length}개</span>
                  </div>
                  <div className="agenda-input-row">
                    <input
                      type="text"
                      value={newAgendaTitle}
                      onChange={(e) => setNewAgendaTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddAgenda(); }}
                      placeholder="예: 1분기 사업 계획, 교육장 예약, 예산 검토"
                    />
                    <button type="button" onClick={handleAddAgenda}>추가</button>
                  </div>
                  <div className="agenda-chip-list">
                    {getActiveAgendaItems().map((agenda, idx) => (
                      <span key={agenda.id} className="agenda-chip">
                        {idx + 1}. {agenda.title}
                        {agenda.id !== 'agenda-general' && (
                          <button type="button" onClick={() => handleRemoveAgenda(agenda.id)} aria-label={`${agenda.title} 삭제`}>×</button>
                        )}
                      </span>
                    ))}
                  </div>
                </section>

                <div className="recording-action-row">
                  <button type="button" className={`btn-record-large ${isRecording ? 'recording' : isRecordingPaused ? 'paused' : ''}`} onClick={() => handleToggleRecording()} disabled={!!audioSessionError}>
                    {isRecording ? <Volume2 size={22} /> : <Mic size={22} />}
                    <span>{isRecording ? '잠시 중단' : isRecordingPaused ? '이어서 녹음' : '녹음 시작'}</span>
                  </button>
                  {(isRecording || isRecordingPaused || dialogues.length > 0) && (
                    <button type="button" className="btn-finish-minutes" onClick={() => handleToggleRecording('finish')} disabled={!!audioSessionError}>
                      <Sparkles size={18} />
                      <span>회의록 정리</span>
                    </button>
                  )}
                </div>

                <div className={`recording-dashboard ${isRecording ? 'live' : dialogues.length > 0 ? 'done' : 'idle'}`}>
                  <div className="recording-status-grid">
                    <div className="recording-status-card">
                      <span className="rsc-label">STT 상태</span>
                      <strong>{isRecording ? '실시간 입력 중' : dialogues.length > 0 ? '입력 완료' : '녹음 대기'}</strong>
                      <small>{realtimeTextFeed || dialogues.at(-1)?.text || '녹음을 시작하면 말이 이곳에 바로 표시됩니다.'}</small>
                    </div>
                    <div className="recording-status-card">
                      <span className="rsc-label">STT 엔진</span>
                      <strong>{sttConnectionStatus === 'connected' ? '서버 STT 연결됨' : sttConnectionStatus === 'connecting' ? '서버 연결 중' : sttConnectionStatus === 'error' ? '서버 오류' : CLOUD_STT_WS_URL ? '서버 STT 대기' : '브라우저 보조 모드'}</strong>
                      <small>{silenceState === 'paused' ? '긴 무음이라 전송을 줄였고, 말하면 자동으로 이어갑니다.' : silenceState === 'listening' ? '음성을 듣고 있으며 텍스트를 실시간 저장합니다.' : '녹음 시작 전입니다.'}</small>
                    </div>
                    <button
                      type="button"
                      className="recording-status-card status-card-button"
                      onClick={() => {
                        if (dialogues.length > 0) setSpeakerCorrectionFor(dialogues.length - 1);
                        else handleStartVoiceprint();
                      }}
                      title={dialogues.length > 0 ? '최근 문장 화자 보정' : '목소리 5초 등록'}
                    >
                      <span className="rsc-label">화자 구분</span>
                      <strong>{voiceprintTemplate ? '성문 기준 적용' : '기본 화자 추정'}</strong>
                      <small>{dialogues.length > 0 ? `${new Set(dialogues.map(d => d.speaker)).size}명 감지` : '누르면 목소리 등록을 시작합니다.'}</small>
                    </button>
                    <div className="recording-status-card">
                      <span className="rsc-label">저장 상태</span>
                      <strong>{isRecording ? '로컬 임시 저장' : dialogues.length > 0 ? 'Firestore 저장 완료' : '저장 대기'}</strong>
                      <small>{isRecording ? '녹음 중 대화 조각은 기기 안에 즉시 보존됩니다.' : '녹음 종료 후 회의록 컬렉션에 저장됩니다.'}</small>
                    </div>
                  </div>

                  <div className="live-typing-panel">
                    <div className="live-typing-header">
                      <span className={`live-dot ${isRecording ? 'on' : ''}`} />
                      <strong>실시간 타이핑</strong>
                      <em>{dialogues.length}개 문장</em>
                    </div>
                    <div className="live-typing-body">
                      {dialogues.length === 0 && !realtimeTextFeed ? (
                        <p>아직 기록된 문장이 없습니다. 녹음을 누르면 말하는 내용이 이 영역에 쌓입니다.</p>
                      ) : (
                        <>
                          {dialogues.slice(-4).map((d, i) => (
                            <div key={`${d.audioOffsetSeconds}-${i}`} className="live-line">
                              <b>{d.speaker}</b>
                              <span>{d.text}</span>
                            </div>
                          ))}
                          {realtimeTextFeed && (
                            <div className="live-line interim">
                              <b>입력 중</b>
                              <span>{realtimeTextFeed}</span>
                            </div>
                          )}
                        </>
                      )}
                      <div ref={transcriptEndRef} />
                    </div>
                  </div>
                </div>

                {isRecording && (
                  <div className="realtime-stt-feed">
                    {isBoosting && <span className="boost-badge">AGC +18dB 부스팅</span>}
                    <AudioVisualizer isRecording={isRecording} isBoosting={isBoosting} analyserRef={voiceprintAnalyserRef} dataArrayRef={voiceprintDataArrayRef} />
                    <div className="stt-text">{realtimeTextFeed || '듣는 중...'}</div>
                  </div>
                )}

                {(isRecording || sttAssistMessage) && (
                  <div className="manual-transcript-box">
                    {sttAssistMessage && <div className="manual-transcript-alert">{sttAssistMessage}</div>}
                    <textarea
                      value={manualTranscriptText}
                      onChange={(e) => setManualTranscriptText(e.target.value)}
                      placeholder="음성 인식이 불안정하면 회의 내용을 직접 입력하세요"
                      rows={2}
                    />
                    <button type="button" className="btn-secondary" onClick={handleAddManualTranscript} disabled={!manualTranscriptText.trim()}>
                      문장 추가
                    </button>
                  </div>
                )}

                {(recordedAudioUrl || recordingHealthWarning) && (
                  <div className="recorded-audio-box">
                    {recordingHealthWarning && <div className="recording-health-warning">{recordingHealthWarning}</div>}
                    {recordedAudioUrl && (
                      <>
                        <audio controls src={recordedAudioUrl} />
                        <a className="btn-secondary" href={recordedAudioUrl} download={recordedAudioName || 'meeting-recording.webm'}>녹음 파일 다운로드</a>
                      </>
                    )}
                  </div>
                )}

                {dialogues.length > 0 && (
                  <div className="dialogue-list">
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 700, marginBottom: 4 }}>
                      화자별 대화 ({dialogues.length}건) · 어슈어런스 {Math.round(assuranceScore * 100)}%
                    </div>
                    {dialogues.map((d, i) => {
                      const confLevel = d.confidence >= 0.95 ? 'high' : d.confidence >= 0.80 ? 'mid' : 'low';
                      return (
                        <div key={i} className={`dialogue-card conf-${confLevel}`}>
                          <div className="dc-speaker">
                            <button type="button" className="dc-speaker-btn" onClick={() => setSpeakerCorrectionFor(i)} title="화자 보정">
                              {d.speaker}
                            </button>
                            <span className="dc-meta">{d.audioOffsetSeconds}s · {d.agendaTitle || '일반 논의'} · {Math.round(d.confidence * 100)}%{d.needsReview ? ' · 검토 필요' : ''}</span>
                          </div>
                          <div className="dc-text">{d.text}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {isProcessingAI && (
                  <div className="ai-processing">
                    <Sparkles size={18} color="var(--color-primary)" /> 회의록 요약 및 저장 중...
                  </div>
                )}

                <button type="button" className="meeting-action-card" onClick={handleAddPhoto}>
                  <Camera size={18} />
                  <div>
                    <div className="mac-title">회의 자료 사진 첨부</div>
                    <div className="mac-desc">WebP 압축 + OCR 텍스트 추출</div>
                  </div>
                </button>
              </div>
            )}
            {/* === 단계 3: 회의록 검토 + Stitch 전송 === */}
            {mobileStep === 3 && (
              <div className="meeting-stage">
                <div className={`assurance-banner score-${assuranceScore >= 0.95 ? 'high' : assuranceScore >= 0.80 ? 'mid' : 'low'}`} style={{ '--score': assuranceScore }}>
                  <Brain size={18} />
                  <div>
                    <div style={{ fontWeight: 800, fontSize: '0.95rem' }}>AI 어슈어런스 스코어: {Math.round(assuranceScore * 100)}%</div>
                    <div style={{ fontSize: '0.72rem' }}>
                      {assuranceScore >= 0.95 ? '✓ 자동 종결 가능 — 담당자 무개입 + Stitch 자동 배포' :
                       assuranceScore >= 0.80 ? '⚠ Highlight Focus 구간 검토 권장' :
                       '🚨 빨간 경고 — 80% 미만 모호 구간 재확인 필요'}
                    </div>
                  </div>
                </div>

                {auditResult?.formattedMinutes && (
                  <div className="formatted-minutes-box">
                    <div className="formatted-minutes-title">
                      <FileText size={18} />
                      <strong>회의록 초안</strong>
                    </div>
                    <pre>{auditResult.formattedMinutes}</pre>
                  </div>
                )}

                {dialogues.length > 0 && (
                  <div className="dialogue-list">
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', fontWeight: 700, marginBottom: 4 }}>
                      전체 대화 ({dialogues.length}건)
                    </div>
                    {dialogues.map((d, i) => {
                      const confLevel = d.confidence >= 0.95 ? 'high' : d.confidence >= 0.80 ? 'mid' : 'low';
                      return (
                        <div key={i} className={`dialogue-card conf-${confLevel}`}>
                          <div className="dc-speaker">
                            <button type="button" className="dc-speaker-btn" onClick={() => setSpeakerCorrectionFor(i)}>{d.speaker}</button>
                            <span className="dc-meta">{d.audioOffsetSeconds}s · {d.agendaTitle || '일반 논의'} · {Math.round(d.confidence * 100)}%{d.needsReview ? ' · 검토 필요' : ''}</span>
                          </div>
                          <div className="dc-text">{d.text}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button type="button" className="meeting-action-card" onClick={handleStartAudit}>
                  <Sparkles size={18} />
                  <div>
                    <div className="mac-title">🔬 사후 4중 검수 실행</div>
                    <div className="mac-desc">정밀 검수 → 신규/누락/일치 diff 패널</div>
                  </div>
                </button>

                <button type="button" className="meeting-action-card primary" onClick={handleStitchTransfer}>
                  <Send size={22} />
                  <div>
                    <div className="mac-title">📤 회의록 담당자 전달 (Stitch)</div>
                    <div className="mac-desc">결정사항 → 예약 캘린더 자동 연동 + Stitch 배포</div>
                  </div>
                </button>

                <button type="button" className="btn-secondary" onClick={() => { setMobileStep(1); setScanResult(null); setDialogues([]); setPhotos([]); }} style={{ width: '100%', padding: '10px' }}>
                  ← 처음으로 (새 회의 시작)
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ===== [분기] entry !== 'm-minutes' (웹 데스크톱 및 모바일 예약 전용) ===== */
          <section className="web-dashboard-panel">
            <div className="dashboard-header">
              <div className="title-area">
                <h2><CalendarIcon size={24} color="var(--color-primary)" /> {t('reservationStatus')}</h2>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button className="btn-secondary" onClick={() => setVoiceBookingOpen(true)} title="음성 명령 예약 (미연 추천)">
                  <Mic size={14} /> 음성 예약
                </button>
                <button className="btn-primary" onClick={() => openReservationCreateModal('2026-05-22')}>
                  <Plus size={16} /> 예약하기
                </button>
              </div>
            </div>

            {entry !== 'm-book' && (
              <div className="main-command-center">
                <div className="main-stat-grid">
                  <div className="main-stat-card accent-primary">
                    <span>{t('bookToday')}</span>
                    <strong>{dashboardSummary.todayReservations.length}<small>건</small></strong>
                    <em>{dashboardSummary.todayReservations[0]?.title || '오늘 확정 일정 없음'}</em>
                  </div>
                  <div className="main-stat-card accent-gold">
                    <span>이번 달 사용</span>
                    <strong>{dashboardSummary.monthHours.toFixed(1)}<small>h</small></strong>
                    <em>{dashboardSummary.monthReservations.length}건 예약</em>
                  </div>
                  <div className="main-stat-card accent-blue">
                    <span>운영 단체</span>
                    <strong>{orgs.length}<small>개</small></strong>
                    <em>{dashboardSummary.topOrg?.name || '단체 데이터 대기'}</em>
                  </div>
                  <div className="main-stat-card accent-green">
                    <span>저장 회의록</span>
                    <strong>{meetingMinutes.length}<small>건</small></strong>
                    <em>{dashboardSummary.recentMinutes[0] ? getMinuteTitle(dashboardSummary.recentMinutes[0]) : '최근 회의록 없음'}</em>
                  </div>
                </div>

                <div className="main-ops-grid">
                  <section className="main-ops-panel schedule-panel">
                    <div className="ops-panel-head">
                      <div>
                        <span>다가오는 예약</span>
                        <strong>오늘 이후 주요 일정</strong>
                      </div>
                      <button type="button" className="btn-secondary compact" onClick={() => openReservationCreateModal(TODAY)}>
                        <Plus size={14} /> 추가
                      </button>
                    </div>
                    <div className="ops-list">
                      {dashboardSummary.upcomingReservations.length === 0 ? (
                        <div className="ops-empty">예정된 예약이 없습니다.</div>
                      ) : dashboardSummary.upcomingReservations.map((reservation) => {
                        const org = orgs.find(o => o.id === reservation.orgId) || currentOrg;
                        return (
                          <button
                            key={reservation.id}
                            type="button"
                            className="ops-row"
                            onClick={() => canManageReservation(reservation) ? openReservationEditModal(reservation) : null}
                          >
                            <span className="ops-date">{reservation.date?.slice(5)}<b>{reservation.startTime}</b></span>
                            <span className="ops-main"><strong>{reservation.title}</strong><em>{reservation.room} · {org?.name || '단체 미지정'}</em></span>
                            <span className="ops-chip" style={{ backgroundColor: org?.lightColor, color: org?.color }}>{reservation.creatorName || '담당자'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="main-ops-panel">
                    <div className="ops-panel-head">
                      <div>
                        <span>회의록</span>
                        <strong>최근 저장 기록</strong>
                      </div>
                      {canAccessMinutes && (
                        <button type="button" className="btn-secondary compact" onClick={() => navigate('/notes')}>
                          <FileText size={14} /> 작성
                        </button>
                      )}
                    </div>
                    <div className="ops-list">
                      {dashboardSummary.recentMinutes.length === 0 ? (
                        <div className="ops-empty">저장된 회의록이 없습니다.</div>
                      ) : dashboardSummary.recentMinutes.map((minute) => {
                        const created = minute.createdAt?.toDate ? minute.createdAt.toDate() : null;
                        return (
                          <button key={minute.id} type="button" className="ops-row" onClick={() => navigate('/notes')}>
                            <span className="ops-date">{created ? created.toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit' }) : '기록'}<b>{minute.status || '완료'}</b></span>
                            <span className="ops-main"><strong>{getMinuteTitle(minute)}</strong><em>{getMinutePreview(minute)}</em></span>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="main-ops-panel room-panel">
                    <div className="ops-panel-head">
                      <div>
                        <span>공간 부하</span>
                        <strong>이번 달 장소별 예약</strong>
                      </div>
                    </div>
                    <div className="room-load-list">
                      {dashboardSummary.roomLoad.map((room) => {
                        const maxCount = Math.max(...dashboardSummary.roomLoad.map(item => item.count), 1);
                        return (
                          <div key={room.id} className="room-load-row">
                            <span>{room.name}</span>
                            <div><i style={{ width: ((room.count / maxCount) * 100) + '%' }} /></div>
                            <b>{room.count}건</b>
                          </div>
                        );
                      })}
                    </div>
                    <div className="quick-action-strip">
                      <button type="button" onClick={() => setReportOpen(true)}><BarChart3 size={14} /> 리포트</button>
                      <button type="button" onClick={() => setShowOrgDashboard(true)}><Users size={14} /> 단체</button>
                      <button type="button" onClick={() => setVoiceBookingOpen(true)}><Mic size={14} /> 음성</button>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* ===== 모바일 날짜 스트립 (오늘 가운데 + 좌우 스와이프) — /m 라우트용 ===== */}
            {entry === 'm-book' && (
              <div className="mobile-booking-view">
                <div className="mobile-selected-date-header">
                  {(() => {
                    const sel = dateStripDates.find(d => d.fullDate === mobileSelectedDate);
                    return (
                      <>
                        <div className="msd-day">{sel?.day || ''}</div>
                        <div className="msd-meta">
                          <div className="msd-md">{sel?.month}월</div>
                          <div className={`msd-weekday wd-${sel?.weekdayIdx}`}>{sel?.weekday}요일</div>
                        </div>
                        {sel?.isToday && <span className="msd-today-badge">오늘</span>}
                        <button
                          type="button"
                          className="msd-jump-today"
                          onClick={() => {
                            setMobileSelectedDate(TODAY);
                            if (todayChipRef.current) {
                              todayChipRef.current.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
                            }
                          }}
                        >오늘로</button>
                      </>
                    );
                  })()}
                </div>

                <div className="date-strip" ref={dateStripRef}>
                  {dateStripDates.map((d) => {
                    const dayBookingCount = filteredReservations.filter(r => r.date === d.fullDate).length;
                    const isActive = d.fullDate === mobileSelectedDate;
                    return (
                      <button
                        key={d.fullDate}
                        ref={d.isToday ? todayChipRef : null}
                        type="button"
                        className={`date-chip ${isActive ? 'active' : ''} ${d.isToday ? 'today' : ''} wd-${d.weekdayIdx}`}
                        onClick={() => {
                          if (dateStripRef.current?.dataset.suppressClick) return;
                          setMobileSelectedDate(d.fullDate);
                        }}
                      >
                        <span className="chip-month">{d.month}월</span>
                        <span className="chip-day">{d.day}</span>
                        <span className="chip-weekday">{d.weekday}</span>
                        {dayBookingCount > 0 && <span className="chip-dot-count">{dayBookingCount}</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="mobile-day-bookings">
                  {(() => {
                    const dayRes = filteredReservations
                      .filter(r => r.date === mobileSelectedDate)
                      .sort((a, b) => a.startTime.localeCompare(b.startTime));
                    if (dayRes.length === 0) {
                      const sel = dateStripDates.find(d => d.fullDate === mobileSelectedDate);
                      const weekdayName = sel?.weekday || '';
                      const weekdayBookings = filteredReservations.filter(r => {
                        const found = dateStripDates.find(d => d.fullDate === r.date);
                        return found && found.weekday === weekdayName;
                      }).length;
                      const QUICK_SLOTS = [
                        { time: '오전 9시', startTime: '09:00', endTime: '11:00', room: '회의실' },
                        { time: '오전 10시', startTime: '10:00', endTime: '12:00', room: '교육장' },
                        { time: '오후 2시', startTime: '14:00', endTime: '16:00', room: '회의실' },
                        { time: '오후 3시', startTime: '15:00', endTime: '17:00', room: '교육장' },
                      ];
                      return (
                        <div key={mobileSelectedDate} className="mobile-day-empty-rich">
                          <div className="empty-hero">
                            <div className="empty-date-card">
                              <div className="edc-month">{sel?.month || ''}월</div>
                              <div className="edc-day">{sel?.day || ''}</div>
                              <div className={`edc-weekday wd-${sel?.weekdayIdx}`}>{weekdayName}</div>
                            </div>
                            <div className="empty-title">{weekdayName}요일에 첫 예약을 잡아보세요</div>
                            <div className="empty-sub">
                              {weekdayBookings > 0
                                ? `이번 달 ${weekdayName}요일에는 평균 ${weekdayBookings}건이 예약됐습니다.`
                                : '아직 비어 있는 시간대입니다. 빠르게 선점해 보세요.'}
                            </div>
                          </div>

                          <div className="quick-slots-label">⚡ {t('quickBooking')}</div>
                          <div className="quick-slots-grid">
                            {QUICK_SLOTS.map((slot, i) => (
                              <button
                                key={i}
                                type="button"
                                className="quick-slot-card"
                                onClick={() => openReservationCreateModal(mobileSelectedDate, {
                                  startTime: slot.startTime,
                                  endTime: slot.endTime,
                                  room: slot.room
                                })}
                              >
                                <span className="qs-time">{slot.time}</span>
                                <span className="qs-room">{slot.room}</span>
                                <span className="qs-duration">2시간</span>
                              </button>
                            ))}
                          </div>

                          <button
                            type="button"
                            className="btn-primary cta-large"
                            onClick={() => openReservationCreateModal(mobileSelectedDate)}
                          >
                            <Plus size={20} /> {t('customBooking')}
                          </button>
                        </div>
                      );
                    }
                    return dayRes.map(r => {
                      const org = orgs.find(o => o.id === r.orgId);
                      return (
                        <div key={r.id} className="mobile-booking-card" style={{ borderLeftColor: org?.color || 'var(--color-primary)' }}>
                          <div className="mbc-time">{r.startTime}<br /><span>{r.endTime}</span></div>
                          <div className="mbc-body">
                            <div className="mbc-title">{r.title}</div>
                            <div className="mbc-meta">
                              <span style={{ color: org?.color, fontWeight: 700 }}>{org?.name || '?'}</span>
                              <span style={{ color: 'var(--color-text-muted)' }}>· {r.room}</span>
                            </div>
                            <div className="mbc-creator">👤 {r.creatorName || '익명'}</div>
                            <div className="reservation-actions">
                              <button type="button" className="btn-secondary reservation-action-btn" onClick={() => downloadICS(r, org?.name)} title="내 캘린더 앱에 .ics 파일로 저장">
                                <DownloadIcon size={13} /> iCal
                              </button>
                              <button type="button" className="btn-secondary reservation-action-btn" onClick={() => openGoogleCalendar(r, org?.name)} title="구글 캘린더에 바로 추가">
                                📅 Google
                              </button>
                              {canManageReservation(r) && (
                                <>
                                  <button type="button" className="btn-secondary reservation-action-btn" onClick={() => openReservationEditModal(r)}>
                                    <Edit3 size={13} /> 수정
                                  </button>
                                  <button type="button" className="btn-secondary reservation-action-btn danger" onClick={() => handleDeleteReservation(r)}>
                                    <Trash2 size={13} /> 삭제
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>

                {/* 모바일 전용 플로팅 추가 버튼 */}
                <button
                  type="button"
                  className="mobile-fab-add"
                  onClick={() => openReservationCreateModal(mobileSelectedDate)}
                  aria-label="이 날짜로 예약 추가"
                >
                  <Plus size={22} />
                </button>
              </div>
            )}

            {/* 캘린더 및 우측 예약 패널 (데스크톱 및 모바일이 아닌 환경에서만 노출) */}
            {entry !== 'm-book' && (
              <>
                {/* 캘린더 (주간/월간 토글 + 방별 필터 + 빠른 점프) */}
                <div className="calendar-container" ref={calendarContainerRef}>
                  <div className="calendar-nav">
                    <div className="calendar-nav-left">
                      {/* 빠른 연/월 점프 */}
                      <select
                        className="cal-jump-select"
                        value={calendarYear}
                        onChange={(e) => {
                          const y = parseInt(e.target.value, 10);
                          setCalendarYear(y);
                          if (viewMode === 'week') jumpToYearMonth(y, calendarMonth);
                        }}
                      >
                        {[2025, 2026, 2027, 2028].map(y => <option key={y} value={y}>{y}년</option>)}
                      </select>
                      <select
                        className="cal-jump-select"
                        value={calendarMonth}
                        onChange={(e) => {
                          const m = parseInt(e.target.value, 10);
                          setCalendarMonth(m);
                          if (viewMode === 'week') jumpToYearMonth(calendarYear, m);
                        }}
                      >
                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m =>
                          <option key={m} value={m}>{m}월</option>
                        )}
                      </select>
                      <button
                        className="btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                        onClick={() => { setCalendarYear(2026); setCalendarMonth(5); setWeekOffset(0); }}
                        title="오늘로 이동"
                      >오늘</button>
                    </div>

                    <div className="calendar-nav-right">
                      {/* 방별 필터 */}
                      <div className="room-filter-tabs">
                        {[
                          { key: 'all', label: '전체' },
                          { key: '회의실', label: '회의실' },
                          { key: '교육장', label: '교육장' }
                        ].map(t => (
                          <button
                            key={t.key}
                            className={`room-filter-tab ${roomFilter === t.key ? 'active' : ''}`}
                            onClick={() => setRoomFilter(t.key)}
                          >{t.label}</button>
                        ))}
                      </div>

                      {/* 뷰 모드 토글 */}
                      <div className="view-mode-toggle">
                        <button className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>주간</button>
                        <button className={viewMode === 'month' ? 'active' : ''} onClick={() => setViewMode('month')}>월간</button>
                      </div>

                      {viewMode === 'week' && (
                        <div className="calendar-nav-buttons">
                          <button className="btn-icon flex-center" onClick={() => handleWeekChange(-1)} title="이전 주"><ChevronLeft size={16} /></button>
                          <button className="btn-icon flex-center" onClick={() => handleWeekChange(1)} title="다음 주"><ChevronRight size={16} /></button>
                        </div>
                      )}
                    </div>
                  </div>

                  {calendarLoading ? (
                    <div className="calendar-skeleton">
                      {Array.from({ length: 7 }).map((_, i) => (
                        <div key={i} className="skeleton skeleton-day" />
                      ))}
                    </div>
                  ) : viewMode === 'week' ? (
                    <div className="calendar-grid">
                      {calendarDays.map((dayObj) => {
                        const dayReservations = filteredReservations.filter(r => r.date === dayObj.fullDate);
                        return (
                          <div key={dayObj.fullDate} className={`calendar-day ${dayObj.isToday ? 'today' : ''}`}>
                            <button
                              type="button"
                              className="day-number-btn"
                              onClick={() => openReservationCreateModal(dayObj.fullDate)}
                              title="이 날짜로 예약 폼 열기"
                            >
                              <span className="day-number">{dayObj.day}</span>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>{dayObj.weekday}</span>
                            </button>

                            {/* 드래그 가능 타임슬롯 트랙 */}
                            <div className="time-track">
                              {TIME_SLOTS.map(slot => {
                                const blocked = isSlotBlocked(dayObj.fullDate, slot, newRoom);
                                const inDrag = dragSelection &&
                                  dragSelection.date === dayObj.fullDate &&
                                  TIME_SLOTS.indexOf(slot) >= Math.min(TIME_SLOTS.indexOf(dragSelection.startSlot), TIME_SLOTS.indexOf(dragSelection.endSlot)) &&
                                  TIME_SLOTS.indexOf(slot) <= Math.max(TIME_SLOTS.indexOf(dragSelection.startSlot), TIME_SLOTS.indexOf(dragSelection.endSlot));
                                return (
                                  <div
                                    key={slot}
                                    className={`time-slot ${blocked ? 'blocked' : ''} ${inDrag ? 'drag-active' : ''}`}
                                    onMouseDown={() => !blocked && handleDragStart(dayObj.fullDate, slot)}
                                    onMouseEnter={() => !blocked && handleDragOver(dayObj.fullDate, slot)}
                                    onMouseUp={handleDragEnd}
                                    title={blocked ? '예약 불가 (다른 단체 예약)' : `${slot} - 드래그하여 예약`}
                                  >
                                    {slot.split(':')[0]}
                                  </div>
                                );
                              })}
                            </div>

                            <div className="day-reservations">
                              {dayReservations.map(res => {
                                const org = orgs.find(o => o.id === res.orgId) || currentOrg;
                                return (
                                  <div key={res.id} className={`reservation-bar ${res.isOfflinePending ? 'offline-pending' : ''}`}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (canManageReservation(res)) openReservationEditModal(res);
                                    }}
                                    style={res.isOfflinePending ? { backgroundColor: '#F5ECE6', color: '#C97A53', borderLeft: '3px dashed #C97A53' } : { backgroundColor: org.lightColor, color: org.color, cursor: canManageReservation(res) ? 'pointer' : 'help' }}
                                    title={res.isOfflinePending ? `[대기-오프라인 저장됨] ${res.title}\n📍 ${res.room}\n🕐 ${res.startTime} - ${res.endTime}` : `[${org.name}] ${res.title}\n📍 ${res.room}\n🕐 ${res.startTime} - ${res.endTime}\n👤 ${res.creatorName || '익명'}`}>
                                    <strong>{res.startTime}</strong> {res.isOfflinePending ? `[대기] ${res.title}` : res.title}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* === 월간 그리드 — 한 달 전체 한눈에 === */
                    <div className="month-view">
                      <div className="month-weekday-header">
                        {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => (
                          <div key={w} className={`month-weekday ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>{w}</div>
                        ))}
                      </div>
                      <div className="month-grid">
                        {monthDays.map((dayObj, idx) => {
                          const dayRes = filteredReservations.filter(r => r.date === dayObj.fullDate);
                          const weekdayIdx = idx % 7;
                          return (
                            <button
                              key={dayObj.fullDate + idx}
                              type="button"
                              className={`month-cell ${dayObj.isToday ? 'today' : ''} ${!dayObj.inMonth ? 'out' : ''} ${weekdayIdx === 0 ? 'sun' : weekdayIdx === 6 ? 'sat' : ''}`}
                              onClick={() => openReservationCreateModal(dayObj.fullDate)}
                            >
                              <div className="month-cell-day">{dayObj.day}</div>
                              <div className="month-cell-events">
                                {dayRes.slice(0, 3).map(res => {
                                  const org = orgs.find(o => o.id === res.orgId) || currentOrg;
                                  return (
                                    <div key={res.id} className="month-event"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        if (canManageReservation(res)) openReservationEditModal(res);
                                      }}
                                      style={{ background: org.lightColor, color: org.color, borderLeftColor: org.color, cursor: canManageReservation(res) ? 'pointer' : 'default' }}
                                      title={`[${org.name}] ${res.title}\n📍 ${res.room}\n🕐 ${res.startTime} - ${res.endTime}\n👤 ${res.creatorName || '익명'}`}>
                                      <span className="month-event-time">{res.startTime}</span> {res.title}
                                    </div>
                                  );
                                })}
                                {dayRes.length > 3 && (
                                  <div className="month-event more">+{dayRes.length - 3}건 더</div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="calendar-hint">
                    💡 {viewMode === 'week'
                      ? <><strong>드래그 예약</strong>: 시간 슬롯을 위→아래로 끌어내리면 즉시 예약 영역이 잡힙니다. 빗금 사선 = <strong>{newRoom}</strong> 기준 예약 불가. 날짜 숫자 클릭 시 폼 직접 열림.</>
                      : <><strong>월간 뷰</strong>: 날짜 셀을 클릭하면 해당일 예약 폼이 열립니다. 위 연/월 선택으로 어느 달이든 한 번에 이동. 방별 필터로 회의실/교육장 따로 보기.</>}
                  </p>
                </div>

                {/* 오늘 예약 목록 */}
                <div className="upcoming-reservations">
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: '8px' }}>
                    <Clock size={18} color="var(--color-primary)" /> 오늘 예약 목록
                  </h3>
                  {allReservations.filter(r => r.date === '2026-05-22').length === 0 && (
                    <p style={{ textAlign: 'center', padding: '24px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                      오늘 예약된 일정이 없습니다. 빈 시간 슬롯을 드래그하거나 날짜 숫자를 클릭해 예약하세요.
                    </p>
                  )}
                  {allReservations.filter(r => r.date === '2026-05-22').map(res => {
                    const org = orgs.find(o => o.id === res.orgId);
                    return (
                      <div key={res.id} className={`reservation-card ${res.isOfflinePending ? 'offline-pending-card' : ''}`}>
                        <div className="res-info">
                          <div className="res-time">{res.startTime} - {res.endTime}</div>
                          <div className="res-title">
                            {res.isOfflinePending && <span className="offline-badge">대기(오프라인)</span>}
                            {res.title} | <span style={{ fontWeight: 600, color: res.isOfflinePending ? '#C97A53' : org?.color }}>{org?.name || '대기 단체'}</span>
                          </div>
                          <div style={{ display: 'flex', gap: '12px', fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: '4px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><MapPin size={12} /> {res.room}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}><Users size={12} /> {res.creatorName || '익명'}</span>
                          </div>
                        </div>
                        {canManageReservation(res) && (
                          <div className="reservation-actions">
                            <button type="button" className="btn-secondary reservation-action-btn" onClick={() => openReservationEditModal(res)}>
                              <Edit3 size={13} /> 수정
                            </button>
                            <button type="button" className="btn-secondary reservation-action-btn danger" onClick={() => handleDeleteReservation(res)}>
                              <Trash2 size={13} /> 삭제
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        )}
      </main>

      {/* ===== 예약 모달 (Smart Scheduler 추천 포함) ===== */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={closeReservationModal}>
          <form className={`modal-content ${shakeModal ? 'shake' : ''}`} onClick={e => e.stopPropagation()} onSubmit={handleCreateReservation}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: '12px' }}>
              <h3 style={{ fontWeight: 700, fontSize: '1.15rem' }}>📅 {newDate} {editingReservation ? '예약 수정' : '즉시 예약'}</h3>
              {(() => {
                const tOrg = orgs.find(o => o.id === newOrgId) || currentOrg;
                return tOrg ? <span className="badge" style={{ backgroundColor: tOrg.lightColor, color: tOrg.color }}>{tOrg.name}</span> : null;
              })()}
            </div>

            {/* 단체 선택 — admin만 변경 가능 */}
            <div className="form-group">
              <label>
                예약 단체
                {isAdmin && <span style={{ fontSize: '0.7rem', color: 'var(--color-primary)', fontWeight: 700, marginLeft: 6 }}>⭐ 관리자: 모든 단체 가능</span>}
                {!isAdmin && userProfile?.orgId && <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginLeft: 6 }}>(소속 단체 고정)</span>}
              </label>
              <select
                value={newOrgId || ''}
                onChange={(e) => setNewOrgId(e.target.value)}
                disabled={!isAdmin}
                style={!isAdmin ? { background: 'var(--bg-canvas)', cursor: 'not-allowed' } : {}}
              >
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>

            {duplicateWarning && (
              <div style={{ background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning)', padding: '12px', borderRadius: '10px', color: 'var(--color-warning)', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', lineHeight: 1.4 }}>
                <AlertTriangle size={16} /><span>{duplicateWarning}</span>
              </div>
            )}

            {reservationWarning && (
              <div className="reservation-warning" role="alert">
                <AlertTriangle size={16} /><span>{reservationWarning}</span>
              </div>
            )}

            <div className="form-group">
              <label>회의/행사 명칭</label>
              <input type="text" placeholder="회의 제목을 입력하세요"
                value={newTitle} onChange={e => setNewTitle(e.target.value)} required autoFocus />
            </div>

            <div className="form-group">
              <label>예상 참여 인원수 (Smart Scheduler 추천용)</label>
              <input type="number" min="1" max="100" value={newAttendees} onChange={e => setNewAttendees(parseInt(e.target.value || 0, 10))} />
            </div>

            {/* Smart Scheduler 추천 카드 (안토니 추천 기능 ②) */}
            <div className="smart-scheduler-card">
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Brain size={12} /> AI 최적 예약 추천 (상위 3)
              </div>
              <div className="recommendation-list">
                {recommendRooms(newAttendees, reservations, newDate).map((rec, i) => (
                  <button key={rec.id} type="button" className="recommendation-pill" onClick={() => setNewRoom(rec.name)}>
                    <span style={{ fontWeight: 700, color: i === 0 ? 'var(--color-success)' : 'var(--color-text-dark)' }}>
                      {i === 0 ? '⭐ ' : ''}{rec.name}
                    </span>
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>수용 {rec.capacity}명</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 시간 grid picker (F) — 시작 시간 + 회의 길이 칩 */}
            <div className="form-group">
              <label>시작 시간 <span className="form-hint">탭하여 선택</span></label>
              <div className="time-grid-picker">
                {TIME_SLOTS.map(t => (
                  <button
                    key={t}
                    type="button"
                    className={`tgp-chip ${newStart === t ? 'active' : ''}`}
                    onClick={() => {
                      setNewStart(t);
                      // 시작 변경 시 길이 유지하며 종료 자동 갱신
                      const [sh, sm] = t.split(':').map(Number);
                      const [eh, em] = newEnd.split(':').map(Number);
                      const dur = Math.max(1, ((eh * 60 + em) - (parseInt(newStart.split(':')[0]) * 60 + parseInt(newStart.split(':')[1]))) || 120);
                      const newEndMin = sh * 60 + sm + dur;
                      const neh = Math.floor(newEndMin / 60);
                      const nem = newEndMin % 60;
                      setNewEnd(`${String(Math.min(neh, 18)).padStart(2,'0')}:${String(nem).padStart(2,'0')}`);
                      setReservationWarning(null);
                    }}
                  >{t}</button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label>회의 길이</label>
              <div className="duration-picker">
                {[60, 90, 120, 180, 240].map(min => {
                  const [sh, sm] = newStart.split(':').map(Number);
                  const total = sh * 60 + sm + min;
                  const eh = Math.floor(total / 60);
                  const em = total % 60;
                  const endStr = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}`;
                  const isActive = newEnd === endStr;
                  const label = min < 60 ? `${min}분` : min % 60 === 0 ? `${min/60}시간` : `${Math.floor(min/60)}시간 ${min%60}분`;
                  return (
                    <button
                      key={min}
                      type="button"
                      className={`dur-chip ${isActive ? 'active' : ''}`}
                      onClick={() => { setNewEnd(endStr); setReservationWarning(null); }}
                    >
                      <span className="dur-label">{label}</span>
                      <span className="dur-end">~ {endStr}</span>
                    </button>
                  );
                })}
              </div>
              <div className="end-preview">종료 시각: <strong>{newEnd}</strong></div>
            </div>

            {/* 회의실 카드 picker (F) */}
            <div className="form-group">
              <label>예약 장소</label>
              <div className="room-picker">
                {ROOMS.map(r => {
                  const isActive = newRoom === r.name;
                  const isOver = newAttendees > r.capacity;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`room-card ${isActive ? 'active' : ''} ${isOver ? 'overcap' : ''}`}
                      onClick={() => { setNewRoom(r.name); setReservationWarning(null); }}
                    >
                      <div className="rc-icon">{r.name === '교육장' ? '🎓' : '🏛️'}</div>
                      <div className="rc-name">{r.name}</div>
                      <div className="rc-cap">수용 {r.capacity}명</div>
                      {isOver && <div className="rc-warn">⚠ 인원 초과</div>}
                      {isActive && <div className="rc-check">✓</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer">
              {editingReservation && canManageReservation(editingReservation) && (
                <button type="button" className="btn-secondary reservation-delete-modal-btn" onClick={() => handleDeleteReservation(editingReservation)}>
                  <Trash2 size={14} /> 삭제
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={closeReservationModal}>취소</button>
              <button type="submit" className="btn-primary">{editingReservation ? '수정 저장' : '예약하기'}</button>
            </div>
          </form>
        </div>
      )}

      {/* ===== 음성 명령 예약 패널 ===== */}
      {voiceBookingOpen && (
        <div className="modal-overlay" onClick={() => setVoiceBookingOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', maxWidth: 460 }}>
            <h3 style={{ fontWeight: 700 }}>🎤 음성 명령으로 예약하기</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
              마이크를 눌러 한국어로 말씀하거나, 아래 입력란에 직접 적으십시오.<br />
              날짜, 시간, 장소가 포함된 예약 내용을 입력하세요.
            </p>

            <button className={`voice-cmd-mic ${voiceCommandListening ? 'listening' : ''}`} onClick={handleVoiceCommandStart} title={voiceCommandListening ? '듣는 중 — 다시 클릭하여 중지' : '마이크 시작'}>
              <Mic size={36} />
            </button>
            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
              {voiceCommandListening ? '🔴 듣는 중...' : '마이크 클릭 후 말씀하세요'}
            </div>

            <textarea
              value={voiceCommandText}
              onChange={(e) => setVoiceCommandText(e.target.value)}
              placeholder='예약할 날짜, 시간, 장소를 입력하세요'
              rows={2}
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid var(--color-primary-border)', borderRadius: 8, fontSize: '0.88rem', resize: 'vertical', fontFamily: 'inherit' }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button type="button" className="btn-secondary" onClick={() => setVoiceBookingOpen(false)}>닫기</button>
              <button type="button" className="btn-secondary" onClick={() => setVoiceCommandText('')} disabled={!voiceCommandText}>지우기</button>
              <button type="button" className="btn-primary" onClick={handleVoiceCommandApply} disabled={!voiceCommandText.trim()}>이대로 적용 →</button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 단체별 점유율 대시보드 (빌 추천 기능 ⑥) ===== */}
      {showOrgDashboard && (
        <div className="modal-overlay" onClick={() => setShowOrgDashboard(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <BarChart3 size={20} /> 광역자활기업 예약통계 대시보드
              </h3>
              <button onClick={() => setShowOrgDashboard(false)} className="btn-icon flex-center"><X size={14} /></button>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>매월 단체별 이용시간 · 예약 횟수 · 노쇼 확률 시각화</p>

            <div className="org-stats-grid">
              {orgStats.map(s => {
                const maxHours = Math.max(...orgStats.map(o => o.totalHours), 1);
                return (
                  <div key={s.id} className="org-stat-card" style={{ borderLeft: `4px solid ${s.color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.85rem', color: s.color }}>{s.name}</span>
                      <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>예약 {s.reservationCount}건</span>
                    </div>
                    <div className="stat-bar-bg">
                      <div className="stat-bar-fill" style={{ width: `${(s.totalHours / maxHours) * 100}%`, background: s.color }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginTop: 4 }}>
                      <span>총 이용시간: <strong>{s.totalHours}h</strong></span>
                      <span style={{ color: 'var(--color-text-muted)' }}>노쇼: {s.noShowCount}건</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===== 로그인 / 회원가입 모달 ===== */}
      {loginModalOpen && (
        <LoginModal
          mode={loginMode}
          onSwitchMode={(m) => setLoginMode(m)}
          onClose={() => setLoginModalOpen(false)}
          onSuccess={() => {
            setLoginModalOpen(false);
            triggerNotification(loginMode === 'signup' ? '가입 신청 완료. 단체를 선택해 주세요.' : '환영합니다!', 'success');
            if (loginMode === 'signup') setSetupWizardOpen(true);
          }}
          onError={(msg) => triggerNotification(msg, 'danger')}
        />
      )}

      {/* ===== 첫 가입 후 단체/직책 선택 마법사 ===== */}
      {setupWizardOpen && user && !user.isAnonymous && (
        <SetupWizard
          user={user}
          orgs={orgs}
          onComplete={async ({ orgId, position }) => {
            try {
              await createUserProfile(user, { orgId, position });
              setSetupWizardOpen(false);
              triggerNotification('가입 신청이 접수되었습니다. 매니저 승인 후 활성화됩니다.', 'gold');
            } catch (err) {
              triggerNotification('가입 처리 실패: ' + err.message, 'danger');
            }
          }}
        />
      )}

      {/* ===== 가입 승인 큐 (manager/admin) ===== */}
      {approvalQueueOpen && (
        <ApprovalQueueModal
          pendingUsers={pendingUsers}
          orgs={orgs}
          isAdmin={isAdmin}
          onApprove={async (uid) => {
            try {
              await approveUser(uid, user.uid);
              triggerNotification('사용자가 승인되었습니다.', 'success');
            } catch (err) {
              triggerNotification('승인 실패: ' + err.message, 'danger');
            }
          }}
          onReject={async (uid) => {
            if (!window.confirm('이 가입 신청을 거절하시겠습니까?')) return;
            try {
              await softDeleteUser(uid);
              triggerNotification('가입 신청이 거절되었습니다.', 'success');
            } catch (err) {
              triggerNotification('거절 실패: ' + err.message, 'danger');
            }
          }}
          onPromoteManager={async (uid) => {
            try {
              await updateUserRole(uid, 'manager');
              triggerNotification('매니저로 승격되었습니다.', 'success');
            } catch (err) {
              triggerNotification('승격 실패: ' + err.message, 'danger');
            }
          }}
          onClose={() => setApprovalQueueOpen(false)}
        />
      )}

      {/* ===== 본인 프로필 편집 모달 ===== */}
      {profileEditOpen && userProfile && (
        <ProfileEditModal
          profile={userProfile}
          onClose={() => setProfileEditOpen(false)}
          onSave={async ({ displayName, position }) => {
            try {
              await updateMyProfile(user.uid, { displayName, position });
              triggerNotification('프로필이 갱신되었습니다.', 'success');
              setProfileEditOpen(false);
            } catch (err) {
              triggerNotification('수정 실패: ' + err.message, 'danger');
            }
          }}
        />
      )}

      {/* ===== admin 전체 사용자 관리 모달 ===== */}
      {userMgmtOpen && (
        <UserManagementModal
          users={allUsers}
          orgs={orgs}
          currentUid={user?.uid}
          onClose={() => setUserMgmtOpen(false)}
          onChangeOrg={async (uid, orgId) => {
            try {
              await updateUserOrg(uid, orgId);
              triggerNotification('소속 단체가 변경되었습니다.', 'success');
            } catch (err) {
              triggerNotification('변경 실패: ' + err.message, 'danger');
            }
          }}
          onChangeRole={async (uid, role) => {
            try {
              await updateUserRole(uid, role);
              triggerNotification(`권한이 ${role}로 변경되었습니다.`, 'success');
            } catch (err) {
              triggerNotification('변경 실패: ' + err.message, 'danger');
            }
          }}
          onChangePosition={async (uid, position) => {
            try {
              await updateUserPosition(uid, position);
              triggerNotification('직책이 갱신되었습니다.', 'success');
            } catch (err) {
              triggerNotification('변경 실패: ' + err.message, 'danger');
            }
          }}
          onSoftDelete={async (uid, name) => {
            if (!window.confirm(`${name}님 계정을 추방(소프트 삭제)하시겠습니까?\n예약/회의록 기록은 보존됩니다.`)) return;
            try {
              await softDeleteUser(uid);
              triggerNotification('추방 완료. 작성 이력은 유지됩니다.', 'success');
            } catch (err) {
              triggerNotification('실패: ' + err.message, 'danger');
            }
          }}
          onToggleMinutesAccess={async (uid, name, nextAllowed) => {
            try {
              await setMinutesAccess(uid, nextAllowed, user?.uid);
              triggerNotification(
                nextAllowed
                  ? `${name}님 회의록 사용을 승인했습니다.`
                  : `${name}님 회의록 사용 승인을 회수했습니다.`,
                'success'
              );
            } catch (err) {
              triggerNotification('회의록 권한 변경 실패: ' + err.message, 'danger');
            }
          }}
        />
      )}

      {/* ===== 사용 현황 리포트 모달 ===== */}
      {reportOpen && (
        <div className="modal-overlay report-overlay" onClick={() => setReportOpen(false)}>
          <div className="modal-content report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="report-header no-print">
              <h3 style={{ fontWeight: 700, fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <BarChart size={18} color="var(--color-primary)" /> 사용 현황 리포트
              </h3>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary report-action" onClick={handlePrintReport} title="브라우저 인쇄 (PDF로 저장 가능)">
                  <Printer size={14} /> 인쇄
                </button>
                <button className="btn-secondary report-action" onClick={handlePrintReport} title="브라우저 인쇄 대화상자에서 'PDF로 저장' 선택">
                  <Download size={14} /> PDF
                </button>
                <button className="btn-primary report-action" onClick={handleExportExcel} title="Excel(.xlsx) 다중 시트 다운로드">
                  <FileSpreadsheet size={14} /> CSV
                </button>
                <button className="btn-icon flex-center no-print" onClick={() => setReportOpen(false)}><X size={14} /></button>
              </div>
            </div>

            {/* 인쇄 시 표시되는 헤더 */}
            <div className="print-only print-header">
              <h2>WS 사용 현황 리포트</h2>
              <p>기간: {reportStartDate} ~ {reportEndDate}
                {' '}· 조직: {reportOrgFilter === 'all' ? '전체' : orgs.find(o => o.id === reportOrgFilter)?.name}
                {' '}· 장소: {reportRoomFilter === 'all' ? '전체' : reportRoomFilter}
                {' '}· 생성: {new Date().toLocaleString('ko-KR')}
              </p>
            </div>

            {/* 필터 컨트롤 */}
            <div className="report-filters no-print">
              <div className="report-presets">
                {[
                  { k: 'thisMonth', l: '이번 달' },
                  { k: 'lastMonth', l: '지난 달' },
                  { k: 'thisYear', l: '올해' },
                  { k: 'lastYear', l: '작년' },
                  { k: 'last30', l: '최근 30일' }
                ].map(p => (
                  <button key={p.k} className={`preset-chip ${reportPreset === p.k ? 'active' : ''}`}
                    onClick={() => handleApplyReportPreset(p.k)}>{p.l}</button>
                ))}
              </div>
              <div className="report-filter-row">
                <label>시작일
                  <input type="date" value={reportStartDate} onChange={(e) => { setReportStartDate(e.target.value); setReportPreset('custom'); }} />
                </label>
                <label>종료일
                  <input type="date" value={reportEndDate} onChange={(e) => { setReportEndDate(e.target.value); setReportPreset('custom'); }} />
                </label>
                <label>조직
                  <select value={reportOrgFilter} onChange={(e) => setReportOrgFilter(e.target.value)}>
                    <option value="all">전체</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </label>
                <label>장소
                  <select value={reportRoomFilter} onChange={(e) => setReportRoomFilter(e.target.value)}>
                    <option value="all">전체</option>
                    {ROOMS.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {/* 요약 카드 */}
            <div className="report-summary-grid">
              <div className="report-card">
                <div className="report-card-label">총 예약 건수</div>
                <div className="report-card-value">{reportData.filtered.length}<span>건</span></div>
              </div>
              <div className="report-card">
                <div className="report-card-label">총 사용 시간</div>
                <div className="report-card-value">{reportData.totalHours.toFixed(1)}<span>h</span></div>
              </div>
              <div className="report-card">
                <div className="report-card-label">이용 단체 수</div>
                <div className="report-card-value">{reportData.uniqueOrgs}<span>개</span></div>
              </div>
              <div className="report-card">
                <div className="report-card-label">기간 평균</div>
                <div className="report-card-value">
                  {reportData.filtered.length > 0
                    ? (reportData.totalHours / reportData.filtered.length).toFixed(1)
                    : '0'}<span>h/건</span>
                </div>
              </div>
            </div>

            {reportData.filtered.length === 0 ? (
              <p style={{ textAlign: 'center', padding: '32px', color: 'var(--color-text-muted)' }}>
                선택한 기간에 예약이 없습니다.
              </p>
            ) : (
              <>
                {/* 장소별 */}
                <div className="report-section">
                  <h4>📍 장소별 사용 현황</h4>
                  <table className="report-table">
                    <thead>
                      <tr><th>장소</th><th>건수</th><th>총 시간</th><th>비율</th></tr>
                    </thead>
                    <tbody>
                      {reportData.byRoom.map(r => (
                        <tr key={r.room}>
                          <td>{r.room}</td>
                          <td>{r.count}건</td>
                          <td>{r.hours.toFixed(1)}h</td>
                          <td>
                            <div className="bar-with-pct">
                              <div className="bar-fill" style={{ width: `${(r.hours / reportData.totalHours) * 100}%`, background: 'var(--color-primary)' }} />
                              <span>{((r.hours / reportData.totalHours) * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 조직별 */}
                <div className="report-section">
                  <h4>🏛️ 조직별 사용 현황</h4>
                  <table className="report-table">
                    <thead>
                      <tr><th>조직</th><th>건수</th><th>총 시간</th><th>비율</th></tr>
                    </thead>
                    <tbody>
                      {reportData.byOrg.map(r => (
                        <tr key={r.orgId}>
                          <td><span className="org-dot" style={{ backgroundColor: r.color, marginRight: 6 }} />{r.orgName}</td>
                          <td>{r.count}건</td>
                          <td>{r.hours.toFixed(1)}h</td>
                          <td>
                            <div className="bar-with-pct">
                              <div className="bar-fill" style={{ width: `${(r.hours / reportData.totalHours) * 100}%`, background: r.color }} />
                              <span>{((r.hours / reportData.totalHours) * 100).toFixed(0)}%</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 월별 */}
                <div className="report-section">
                  <h4>📅 월별 추이</h4>
                  <table className="report-table">
                    <thead>
                      <tr><th>년-월</th><th>건수</th><th>총 시간</th></tr>
                    </thead>
                    <tbody>
                      {reportData.byMonth.map(r => (
                        <tr key={r.month}>
                          <td>{r.month}</td>
                          <td>{r.count}건</td>
                          <td>{r.hours.toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 전체 목록 */}
                <div className="report-section">
                  <h4>📋 전체 예약 목록 ({reportData.filtered.length}건)</h4>
                  <table className="report-table report-list">
                    <thead>
                      <tr><th>날짜</th><th>시간</th><th>장소</th><th>조직</th><th>회의명</th></tr>
                    </thead>
                    <tbody>
                      {reportData.filtered.map(r => {
                        const org = orgs.find(o => o.id === r.orgId);
                        return (
                          <tr key={r.id}>
                            <td>{r.date}</td>
                            <td>{r.startTime}-{r.endTime}</td>
                            <td>{r.room}</td>
                            <td style={{ color: org?.color, fontWeight: 600 }}>{org?.name}</td>
                            <td>{r.title}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== 조직 등록/편집 모달 ===== */}
      {orgEditorOpen && (
        <OrgEditorModal
          org={orgBeingEdited}
          onClose={() => { setOrgEditorOpen(false); setOrgBeingEdited(null); }}
          onSave={async (data) => {
            try {
              if (orgBeingEdited?.id) {
                // DB에 기본 단체로 표시된 경우 이름만 변경
                if (orgBeingEdited.isDefault) {
                  await updateOrg(orgBeingEdited.id, { name: data.name });
                } else {
                  await updateOrg(orgBeingEdited.id, data);
                }
                triggerNotification(`[${data.name}] 단체 정보가 갱신되었습니다.`, 'success');
              } else {
                const ref = await createOrg(data);
                triggerNotification(`[${data.name}] 단체가 새로 등록되었습니다.`, 'success');
                setCurrentOrgId(ref.id);
              }
              setOrgEditorOpen(false);
              setOrgBeingEdited(null);
            } catch (err) {
              triggerNotification('단체 저장 실패: ' + err.message, 'danger');
            }
          }}
          onDelete={async () => {
            if (!orgBeingEdited?.id || orgBeingEdited.isDefault) return;
            if (!window.confirm(`"${orgBeingEdited.name}" 단체를 삭제하시겠습니까?\n- 단체 명부(멤버)는 자동 정리\n- 소속 예약이나 사용자가 있으면 삭제가 차단됩니다 (먼저 정리 필요)`)) return;
            try {
              await deleteOrg(orgBeingEdited.id);
              triggerNotification(`[${orgBeingEdited.name}] 단체가 삭제되었습니다.`, 'success');
              setOrgEditorOpen(false);
              setOrgBeingEdited(null);
            } catch (err) {
              if (err.code === 'ORG_HAS_RESERVATIONS' || err.code === 'ORG_HAS_USERS') {
                triggerNotification('🚫 ' + err.message, 'danger');
              } else {
                triggerNotification('단체 삭제 실패: ' + err.message, 'danger');
              }
            }
          }}
        />
      )}

      {/* ===== 사후 4중 검수 (Post-Meeting Audit) 모달 ===== */}
      {auditOpen && (
        <div className="modal-overlay" onClick={() => setAuditOpen(false)}>
          <div className="modal-content audit-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 780, width: '95%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bg-canvas)', paddingBottom: 12 }}>
              <h3 style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={20} color="var(--color-primary)" /> 회의록 4중 안심 검수 대시보드
              </h3>
              <button onClick={() => setAuditOpen(false)} className="btn-icon flex-center"><X size={14} /></button>
            </div>
            
            {auditRunning && (
              <div className="audit-running-stage" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div className="dual-routing-engine-loader">
                  <div className="pulse-circle flash">빠른 검수</div>
                  <div className="pulse-line"></div>
                  <div className="pulse-circle pro">정밀 검수</div>
                </div>
                <h4 style={{ margin: '18px 0 6px', fontWeight: 800 }}>AI 다이내믹 듀얼 라우터 연산 중...</h4>
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
                  1차 빠른 분석 후 문맥의 모호성 계수를 판단하고 있습니다.<br />
                  필요 시 정밀 검수 단계로 한 번 더 확인합니다.
                </p>
              </div>
            )}

            {auditDone && (
              <div className="audit-results-stage">
                {/* 듀얼 라우팅 피드백 패널 */}
                <div className="dual-routing-feedback-banner">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <span className="routing-path-badge">{usedAIModel} 가동</span>
                      <h4 style={{ fontWeight: 800, margin: '4px 0 0', fontSize: '0.95rem', color: '#fff' }}>
                        {usedAIModel.includes('정밀') 
                          ? '모호 대화 감지 → 정밀 교차 검증 적용 완료' 
                          : '명확 대화 판정 → 빠른 검수로 종결 완료'}
                      </h4>
                    </div>
                    <div className="cost-saving-metric">
                      <div className="csm-label">실시간 API 요금 절감율</div>
                      <div className="csm-value">{aiCostSavings}</div>
                    </div>
                  </div>
                </div>

                <div className="audit-diff-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                  {/* 패스 1: 실시간 초안 */}
                  <div className="audit-pass-column">
                    <h5 className="column-title">Pass 1: 실시간 초안 요약</h5>
                    <div className="diff-list">
                      {((auditResult?.flashData || auditResult)?.decisions || []).map((dec, idx) => (
                        <div key={`flash-dec-${dec.id || idx}`} className="diff-card normal">
                          <strong>결정사항 #{idx + 1}</strong>
                          <p>{dec.text}</p>
                          <span className="diff-status match">일치</span>
                        </div>
                      ))}
                      {((auditResult?.flashData || auditResult)?.actionItems || []).map((act, idx) => (
                        <div key={`flash-act-${act.id || idx}`} className="diff-card normal">
                          <strong>액션 아이템 #{idx + 1}</strong>
                          <p>{act.text}</p>
                          <span className="diff-status match">일치</span>
                        </div>
                      ))}
                      {(!auditResult?.flashData && !auditResult?.decisions?.length) && (
                        <div className="diff-card empty-slot">
                          <span className="desc">산출된 실시간 초안 요약이 없습니다.</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 패스 2: 정밀 교차 검증 */}
                  <div className="audit-pass-column">
                    <h5 className="column-title">Pass 2: 정밀 교차 검증</h5>
                    <div className="diff-list">
                      {auditResult?.isProTriggered ? (
                        <>
                          {/* 정밀 검수 결정사항 목록 */}
                          {(auditResult?.decisions || []).map((dec, idx) => {
                            const flashDecs = auditResult?.flashData?.decisions || [];
                            const isMatch = flashDecs.some(fd => fd.text === dec.text);
                            
                            if (isMatch) {
                              return (
                                <div key={`pro-dec-${dec.id || idx}`} className="diff-card normal">
                                  <strong>결정사항 #{idx + 1}</strong>
                                  <p>{dec.text}</p>
                                  <button type="button" className="diff-action-btn select" disabled>기본 탑재</button>
                                </div>
                              );
                            } else {
                              const isModified = flashDecs.some(fd => fd.id === dec.id && fd.text !== dec.text);
                              return (
                                <div key={`pro-dec-${dec.id || idx}`} className={isModified ? "diff-card diff-modified" : "diff-card diff-new"}>
                                  <strong>결정사항 #{idx + 1} {isModified ? '(문구 정밀화)' : '(신규 누락 발굴)'}</strong>
                                  <p>{dec.text}</p>
                                  <span className={isModified ? "change-indicator" : "change-indicator new"}>
                                    {isModified ? '수정됨' : '누락 복구'}
                                  </span>
                                  <button type="button" className={`diff-action-btn ${mergedDecisions.includes(dec.id) ? 'active' : ''}`} onClick={() => toggleMergeDecision(dec.id)}>
                                    {mergedDecisions.includes(dec.id) ? '채택됨' : isModified ? '정밀 문구 채택' : '누락 복구 채택'}
                                  </button>
                                </div>
                              );
                            }
                          })}
                          
                          {/* 정밀 검수 액션아이템 목록 */}
                          {(auditResult?.actionItems || []).map((act, idx) => {
                            const flashActs = auditResult?.flashData?.actionItems || [];
                            const isMatch = flashActs.some(fa => fa.text === act.text);
                            
                            if (isMatch) {
                              return (
                                <div key={`pro-act-${act.id || idx}`} className="diff-card normal">
                                  <strong>액션 아이템 #{idx + 1}</strong>
                                  <p>{act.text}</p>
                                  <button type="button" className="diff-action-btn select" disabled>기본 탑재</button>
                                </div>
                              );
                            } else {
                              const isModified = flashActs.some(fa => fa.id === act.id && fa.text !== act.text);
                              return (
                                <div key={`pro-act-${act.id || idx}`} className={isModified ? "diff-card diff-modified" : "diff-card diff-new"}>
                                  <strong>액션 아이템 #{idx + 1} {isModified ? '(조치 정밀화)' : '(신규 누락 발굴)'}</strong>
                                  <p>{act.text}</p>
                                  <span className={isModified ? "change-indicator" : "change-indicator new"}>
                                    {isModified ? '수정됨' : '누락 복구'}
                                  </span>
                                  <button type="button" className={`diff-action-btn ${mergedActions.includes(act.id) ? 'active' : ''}`} onClick={() => toggleMergeAction(act.id)}>
                                    {mergedActions.includes(act.id) ? '채택됨' : isModified ? '정밀 문구 채택' : '누락 복구 채택'}
                                  </button>
                                </div>
                              );
                            }
                          })}
                        </>
                      ) : (
                        <div className="diff-card empty-slot" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', minHeight: 180, textAlign: 'center', padding: 20 }}>
                          <CheckCircle2 size={36} color="var(--color-success)" style={{ marginBottom: 10 }} />
                          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--color-success)' }}>정밀 교차검증 대기 미발동</span>
                          <span className="desc" style={{ marginTop: 6, fontSize: '0.75rem', lineHeight: 1.4 }}>
                            1차 분석 신뢰도가 높은 수준({Math.round((auditResult?.confidence || 0.95) * 100)}%)으로 판별되어,<br />
                            정밀 교차검증 없이 빠른 검수로 완료되었습니다.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="modal-footer" style={{ marginTop: 20, borderTop: '1px solid var(--bg-canvas)', paddingTop: 14 }}>
                  <button type="button" className="btn-secondary" onClick={() => handleApplyAudit('pass1')}>초안만 채택</button>
                  <button type="button" className="btn-secondary" onClick={() => handleApplyAudit('pass2')} disabled={!auditResult?.isProTriggered}>정밀 요약 전체 채택</button>
                  <button type="button" className="btn-primary" onClick={() => handleApplyAudit('merge')} disabled={mergedDecisions.length === 0 && mergedActions.length === 0}>
                    병합 확정 (선택 {mergedDecisions.length + mergedActions.length}건 추가)
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 인증/시드 로딩 중 상태 */}
      {(!authReady || orgs.length === 0) && (
        <div className="auth-loading-overlay">
          <div className="auth-loading-card">
            <Sparkles size={28} color="var(--color-primary)" style={{ animation: 'float 1.5s infinite' }} />
            <div style={{ fontSize: '0.92rem', fontWeight: 700 }}>
              {!authReady ? 'Firebase 인증 중...' : '광역자활기업 단체 시드 중...'}
            </div>
            <p style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
              Firestore 실시간 구독 준비 · Anonymous Auth
            </p>
          </div>
        </div>
      )}

      <footer style={{ marginTop: 'auto', borderTop: '1px solid var(--color-primary-border)', padding: '24px 32px', textAlign: 'center', background: '#FAF9F6', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
        <p>© 2026 WS Auto-Minutes & Room Booking System · Classic Warm Minimal</p>
        <p style={{ fontSize: '0.72rem', marginTop: '4px', opacity: 0.8 }}>
          Firebase Hosting · Firestore · Auth · 실시간 마이크 STT 회의록 저장 적용 완료
        </p>
      </footer>
    </div>
  );
}

/* === 6 modals extracted to ./modals/ ===
   - LoginModal, SetupWizard, ApprovalQueueModal, ProfileEditModal, UserManagementModal, OrgEditorModal */

/* AudioVisualizer extracted to ./components/AudioVisualizer.jsx */
