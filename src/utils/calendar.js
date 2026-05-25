/* iCal / Google Calendar 내보내기 + 음성 자연어 파서 + 회의실 추천 (순수 함수) */

function pad2(n) { return String(n).padStart(2, '0'); }

export function toICSDate(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return `${y}${pad2(m)}${pad2(d)}T${pad2(h)}${pad2(mi)}00`;
}

export function generateICS(reservation, orgName, opts = {}) {
  const uid = `${reservation.id || Date.now()}@wellshare-erp.web.app`;
  const dtStamp = opts.dtStamp || new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dtStart = toICSDate(reservation.date, reservation.startTime);
  const dtEnd = toICSDate(reservation.date, reservation.endTime);
  const summary = (reservation.title || '예약').replace(/[\r\n,;]/g, ' ');
  const description = `${orgName || ''} · 작성자 ${reservation.creatorName || '익명'}`.replace(/[\r\n,;]/g, ' ');
  const location = (reservation.room || '').replace(/[\r\n,;]/g, ' ');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WellShare ERP//Reservation//KO',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${uid}`, `DTSTAMP:${dtStamp}`,
    `DTSTART;TZID=Asia/Seoul:${dtStart}`, `DTEND;TZID=Asia/Seoul:${dtEnd}`,
    `SUMMARY:${summary}`, `DESCRIPTION:${description}`, `LOCATION:${location}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

export function buildGoogleCalendarUrl(reservation, orgName) {
  const dtStart = toICSDate(reservation.date, reservation.startTime);
  const dtEnd = toICSDate(reservation.date, reservation.endTime);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', reservation.title || '예약');
  url.searchParams.set('dates', `${dtStart}/${dtEnd}`);
  url.searchParams.set('details', `${orgName || ''} · 작성자 ${reservation.creatorName || '익명'}`);
  url.searchParams.set('location', reservation.room || '');
  url.searchParams.set('ctz', 'Asia/Seoul');
  return url.toString();
}

/* 음성 자연어 파서 — "6월 13일 토요일 오후 2시부터 4시간 교육장" 분해 */
export function parseVoiceCommand(text) {
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
    const dur = durMatch ? parseInt(durMatch[1], 10) : 2;
    result.endTime = `${String(startHour + dur).padStart(2, '0')}:00`;
  }
  if (text.includes('교육장')) result.room = '교육장 (B1)';
  else if (text.includes('대회의실')) result.room = '대회의실 (3F)';
  else if (text.includes('세미나')) result.room = '세미나실 A (2F)';
  else if (text.includes('소회의실')) result.room = '소회의실 B (1F)';
  if (text.includes('체육대회')) result.title = '체육대회 회의';
  else if (text.includes('총회')) result.title = '정기 총회';
  else result.title = text.replace(/(\d+월\s*\d+일|\d+시|\d+시간|오전|오후|교육장|대회의실|세미나실|소회의실|예약|해\s*줘)/g, '').trim() || '음성 예약';
  return result;
}

/* Smart Scheduler — 회의실 추천 (수용 인원 + 혼잡도) */
export function recommendRoomsCore(rooms, attendeeCount, reservations, date) {
  return rooms
    .filter(r => r.capacity >= attendeeCount)
    .map(r => {
      const busyHours = reservations.filter(res => res.room === r.name && res.date === date).length;
      return { ...r, score: r.capacity * 10 - busyHours * 30 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/* i18n t() 팩토리 — 사전 + 로케일 분리로 테스트 가능 */
export function makeT(dict, locale, fallbackLocale = 'ko') {
  return (key) => dict[locale]?.[key] ?? dict[fallbackLocale]?.[key] ?? key;
}
