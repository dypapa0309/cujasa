const minutesOfDay = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const KST_OFFSET_MINUTES = 9 * 60;

const getKstDateParts = (date) => {
  const shifted = new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    date: shifted.getUTCDate()
  };
};

const fromKstDateTime = ({ year, month, date }, minute) => {
  const hour = Math.floor(minute / 60);
  const minutes = minute % 60;
  return new Date(Date.UTC(year, month, date, hour, minutes, 0, 0) - KST_OFFSET_MINUTES * 60 * 1000);
};

function createFixedStartSchedule({ count, firstMinute, minGap, baseKstDate, now }) {
  const result = [];
  for (let i = 0; i < count; i += 1) {
    const minute = firstMinute + (i * minGap);
    const dayOffset = Math.floor(minute / (24 * 60));
    const minuteOfDay = minute % (24 * 60);
    let candidate = fromKstDateTime({ ...baseKstDate, date: baseKstDate.date + dayOffset }, minuteOfDay);
    if (candidate < now) {
      candidate = fromKstDateTime({ ...baseKstDate, date: baseKstDate.date + dayOffset + 1 }, minuteOfDay);
    }
    result.push(candidate);
  }
  return result.sort((a, b) => a - b).map((d) => d.toISOString());
}

export function createDailySchedule(account, date = new Date()) {
  const rawMax = Number(account.daily_post_max ?? 5);
  const count = Math.min(5, Math.max(0, Number.isFinite(rawMax) ? rawMax : 5));
  const windows = account.active_time_windows?.length ? account.active_time_windows : [{ start: '09:00', end: '22:00' }];
  const minGap = account.min_interval_minutes || 45;
  const result = [];
  let attempts = 0;
  const now = new Date();
  const baseKstDate = getKstDateParts(date);
  const firstWindow = windows[0];
  if (windows.length === 1 && firstWindow?.start && firstWindow.start === firstWindow.end) {
    return createFixedStartSchedule({
      count,
      firstMinute: minutesOfDay(firstWindow.start),
      minGap,
      baseKstDate,
      now
    });
  }
  while (result.length < count && attempts < 200) {
    attempts += 1;
    const w = windows[Math.floor(Math.random() * windows.length)];
    const start = minutesOfDay(w.start);
    const end = minutesOfDay(w.end);
    const minute = start + Math.floor(Math.random() * Math.max(1, end - start));
    let candidate = fromKstDateTime(baseKstDate, minute);
    if (candidate < now) candidate = fromKstDateTime({ ...baseKstDate, date: baseKstDate.date + 1 }, minute);
    const ok = result.every((item) => Math.abs(item.getTime() - candidate.getTime()) >= minGap * 60 * 1000);
    if (ok) result.push(candidate);
  }
  return result.sort((a, b) => a - b).map((d) => d.toISOString());
}
