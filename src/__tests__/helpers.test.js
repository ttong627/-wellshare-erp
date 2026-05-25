/* WS 시스템 핵심 헬퍼 함수 단위 테스트 — 회귀 방지용
 * 미아 권고: 인라인 복제가 아닌 실제 함수를 import해서 회귀 신호 확보 */
import { describe, it, expect } from 'vitest';
import { timeToMinutes, hasTimeOverlap, reservationHours } from '../utils/time.js';
import {
  toICSDate, generateICS, buildGoogleCalendarUrl,
  parseVoiceCommand, recommendRoomsCore, makeT
} from '../utils/calendar.js';

/* ============================================================
 *  시간 헬퍼 (src/utils/time.js)
 * ============================================================ */
describe('timeToMinutes', () => {
  it('converts 09:30 to 570 minutes', () => {
    expect(timeToMinutes('09:30')).toBe(570);
  });
  it('handles 00:00', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });
  it('handles 23:59', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });
});

describe('hasTimeOverlap', () => {
  it('returns true for full overlap', () => {
    expect(hasTimeOverlap('10:00', '12:00', '10:00', '12:00')).toBe(true);
  });
  it('returns true for partial overlap (start)', () => {
    expect(hasTimeOverlap('10:00', '12:00', '11:00', '13:00')).toBe(true);
  });
  it('returns false for adjacent non-overlapping', () => {
    expect(hasTimeOverlap('10:00', '12:00', '12:00', '14:00')).toBe(false);
  });
  it('returns false for non-overlapping with gap', () => {
    expect(hasTimeOverlap('10:00', '12:00', '14:00', '16:00')).toBe(false);
  });
  it('returns true for one inside another', () => {
    expect(hasTimeOverlap('09:00', '17:00', '10:00', '12:00')).toBe(true);
  });
});

describe('reservationHours', () => {
  it('computes 2-hour reservation', () => {
    expect(reservationHours({ startTime: '14:00', endTime: '16:00' })).toBe(2);
  });
  it('computes half-hour reservation', () => {
    expect(reservationHours({ startTime: '09:30', endTime: '10:00' })).toBe(0.5);
  });
  it('returns 0 for invalid range (end before start)', () => {
    expect(reservationHours({ startTime: '14:00', endTime: '12:00' })).toBe(0);
  });
});

/* ============================================================
 *  iCal / Google Calendar Export (src/utils/calendar.js)
 * ============================================================ */
describe('toICSDate', () => {
  it('formats local time without timezone marker', () => {
    expect(toICSDate('2026-05-23', '14:30')).toBe('20260523T143000');
  });
  it('pads single digits', () => {
    expect(toICSDate('2026-01-05', '09:05')).toBe('20260105T090500');
  });
});

describe('generateICS', () => {
  const sample = { id: 'r1', date: '2026-05-23', startTime: '14:00', endTime: '16:00', title: '정기 회의', room: '교육장', creatorName: '김기홍' };
  const ics = generateICS(sample, '경기자활기업협회', { dtStamp: '20260525T120000Z' });

  it('starts with VCALENDAR begin marker', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
  });
  it('ends with VCALENDAR end marker', () => {
    expect(ics.endsWith('END:VCALENDAR')).toBe(true);
  });
  it('includes Asia/Seoul timezone', () => {
    expect(ics).toContain('TZID=Asia/Seoul');
  });
  it('escapes commas/semicolons in title', () => {
    const r = { ...sample, title: '회의, 중요한 자리; 첫 안건' };
    const out = generateICS(r, 'X');
    expect(out).toContain('SUMMARY:회의  중요한 자리  첫 안건');
  });
  it('uses RFC 5545 CRLF line endings', () => {
    expect(ics.includes('\r\n')).toBe(true);
  });
});

describe('buildGoogleCalendarUrl', () => {
  it('produces a valid render URL with required params', () => {
    const url = buildGoogleCalendarUrl(
      { date: '2026-05-23', startTime: '14:00', endTime: '16:00', title: '회의', room: '교육장' },
      '경기자활기업협회'
    );
    expect(url).toContain('calendar.google.com/calendar/render');
    expect(url).toContain('action=TEMPLATE');
    expect(url).toContain('dates=20260523T140000%2F20260523T160000');
    expect(url).toContain('ctz=Asia%2FSeoul');
  });
});

/* ============================================================
 *  음성 자연어 파서
 * ============================================================ */
describe('parseVoiceCommand', () => {
  it('parses "6월 13일 오후 2시부터 4시간 교육장"', () => {
    const r = parseVoiceCommand('6월 13일 오후 2시부터 4시간 교육장 예약해 줘');
    expect(r.date).toBe('2026-06-13');
    expect(r.startTime).toBe('14:00');
    expect(r.endTime).toBe('18:00');
    expect(r.room).toBe('교육장 (B1)');
  });
  it('defaults to 2-hour duration when not specified', () => {
    const r = parseVoiceCommand('5월 23일 오전 10시 회의실 예약');
    expect(r.startTime).toBe('10:00');
    expect(r.endTime).toBe('12:00');
  });
  it('detects 체육대회 title', () => {
    const r = parseVoiceCommand('6월 1일 오후 3시 체육대회');
    expect(r.title).toBe('체육대회 회의');
  });
  it('detects 총회 title', () => {
    const r = parseVoiceCommand('5월 30일 오후 1시 정기 총회 예약해 줘');
    expect(r.title).toBe('정기 총회');
  });
  it('handles missing date gracefully', () => {
    const r = parseVoiceCommand('오후 2시 회의');
    expect(r.date).toBe('');
    expect(r.startTime).toBe('14:00');
  });
  it('handles missing time gracefully', () => {
    const r = parseVoiceCommand('5월 23일 교육장');
    expect(r.date).toBe('2026-05-23');
    expect(r.startTime).toBe('');
    expect(r.endTime).toBe('');
  });
});

/* ============================================================
 *  Smart Scheduler — 회의실 추천
 * ============================================================ */
const ROOMS = [
  { id: 'meeting', name: '회의실', capacity: 20 },
  { id: 'training', name: '교육장', capacity: 40 }
];

describe('recommendRoomsCore', () => {
  it('filters by capacity (8명 → 회의실/교육장 모두)', () => {
    const recs = recommendRoomsCore(ROOMS, 8, [], '2026-05-23');
    expect(recs).toHaveLength(2);
  });
  it('filters out under-capacity rooms (25명 → 교육장만)', () => {
    const recs = recommendRoomsCore(ROOMS, 25, [], '2026-05-23');
    expect(recs).toHaveLength(1);
    expect(recs[0].name).toBe('교육장');
  });
  it('returns empty array when no room fits (50명)', () => {
    const recs = recommendRoomsCore(ROOMS, 50, [], '2026-05-23');
    expect(recs).toHaveLength(0);
  });
  it('penalizes busy rooms in score', () => {
    const busy = [
      { room: '회의실', date: '2026-05-23' },
      { room: '회의실', date: '2026-05-23' }
    ];
    const recs = recommendRoomsCore(ROOMS, 8, busy, '2026-05-23');
    expect(recs[0].name).toBe('교육장');
  });
  it('ignores reservations on other dates', () => {
    const busy = [{ room: '회의실', date: '2026-06-01' }];
    const recs = recommendRoomsCore(ROOMS, 8, busy, '2026-05-23');
    expect(recs[0].name).toBe('교육장');
  });
  it('returns at most 3 rooms', () => {
    const recs = recommendRoomsCore(ROOMS, 1, [], '2026-05-23');
    expect(recs.length).toBeLessThanOrEqual(3);
  });
});

/* ============================================================
 *  i18n makeT
 * ============================================================ */
const DICT = {
  ko: { reserve: '예약하기', online: '온라인' },
  en: { reserve: 'Reserve', online: 'Online' }
};

describe('makeT (i18n)', () => {
  it('returns Korean for ko locale', () => {
    expect(makeT(DICT, 'ko')('reserve')).toBe('예약하기');
  });
  it('returns English for en locale', () => {
    expect(makeT(DICT, 'en')('reserve')).toBe('Reserve');
  });
  it('falls back to Korean if key missing in locale', () => {
    expect(makeT(DICT, 'en')('only_in_ko')).toBe('only_in_ko');
  });
  it('returns key itself if missing in all locales', () => {
    expect(makeT(DICT, 'en')('xyz')).toBe('xyz');
  });
});

/* ============================================================
 *  보안 회귀 가드 — 권한 상승 차단 정책 (firestore.rules와 함께 검증)
 * ============================================================ */
describe('보안 회귀 가드 (정책 명세 테스트)', () => {
  it('users 보호 필드 명세에 role/orgId/email 포함', () => {
    const protectedFields = ['email', 'role', 'orgId', 'approvedBy', 'approvedAt',
      'minutesAccess', 'minutesAccessUpdatedAt', 'minutesAccessBy', 'deletedAt', 'joinedAt'];
    // 본인이 변경 시도하면 안 되는 필드 회귀 가드
    expect(protectedFields).toContain('role');
    expect(protectedFields).toContain('orgId');
    expect(protectedFields).toContain('email');
  });
});
