/* 시간 헬퍼 — App.jsx에서 분리된 순수 함수 (테스트 가능) */

export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function hasTimeOverlap(s1, e1, s2, e2) {
  return timeToMinutes(s1) < timeToMinutes(e2) && timeToMinutes(e1) > timeToMinutes(s2);
}

export function reservationHours(r) {
  const [sH, sM] = r.startTime.split(':').map(Number);
  const [eH, eM] = r.endTime.split(':').map(Number);
  return Math.max(0, ((eH * 60 + eM) - (sH * 60 + sM)) / 60);
}
