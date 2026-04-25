const minutesOfDay = (time) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

export function createDailySchedule(account, date = new Date()) {
  const min = account.daily_post_min || 1;
  const max = account.daily_post_max || min;
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const windows = account.active_time_windows?.length ? account.active_time_windows : [{ start: '09:00', end: '22:00' }];
  const minGap = account.min_interval_minutes || 45;
  const result = [];
  let attempts = 0;
  while (result.length < count && attempts < 200) {
    attempts += 1;
    const w = windows[Math.floor(Math.random() * windows.length)];
    const start = minutesOfDay(w.start);
    const end = minutesOfDay(w.end);
    const minute = start + Math.floor(Math.random() * Math.max(1, end - start));
    const candidate = new Date(date);
    candidate.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
    if (candidate < new Date()) candidate.setDate(candidate.getDate() + 1);
    const ok = result.every((item) => Math.abs(item.getTime() - candidate.getTime()) >= minGap * 60 * 1000);
    if (ok) result.push(candidate);
  }
  return result.sort((a, b) => a - b).map((d) => d.toISOString());
}
