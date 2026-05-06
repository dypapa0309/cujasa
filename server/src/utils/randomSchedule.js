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

export function createDailySchedule(account, date = new Date()) {
  const rawMin = Number(account.daily_post_min ?? 1);
  const min = Math.min(5, Math.max(0, Number.isFinite(rawMin) ? rawMin : 1));
  const rawMax = Number(account.daily_post_max ?? min);
  const max = Math.min(5, Math.max(min, Number.isFinite(rawMax) ? rawMax : min));
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const windows = account.active_time_windows?.length ? account.active_time_windows : [{ start: '09:00', end: '22:00' }];
  const minGap = account.min_interval_minutes || 45;
  const result = [];
  let attempts = 0;
  const now = new Date();
  const baseKstDate = getKstDateParts(date);
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
