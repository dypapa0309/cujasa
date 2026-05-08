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

const DEFAULT_WINDOWS = [{ start: '09:00', end: '23:00' }];

function normalizeWindow(window = {}) {
  const start = minutesOfDay(window.start || '09:00');
  let end = minutesOfDay(window.end || '22:00');
  if (end < start) end += 24 * 60;
  if (end === start) return null;
  return {
    start,
    end,
    duration: Math.max(0, end - start),
    label: `${window.start || '09:00'}-${window.end || '22:00'}`
  };
}

function normalizeWindows(windows = []) {
  const normalized = (Array.isArray(windows) && windows.length ? windows : DEFAULT_WINDOWS)
    .map(normalizeWindow)
    .filter(Boolean)
    .filter((window) => window.duration > 0);
  return normalized.length ? normalized : DEFAULT_WINDOWS.map(normalizeWindow).filter(Boolean);
}

function minuteAtOffset(windows, offset) {
  let remaining = offset;
  for (const window of windows) {
    if (remaining < window.duration) return window.start + remaining;
    remaining -= window.duration;
  }
  const last = windows[windows.length - 1];
  return Math.max(last.start, last.end - 1);
}

function randomInt(min, max, randomFn) {
  if (max <= min) return min;
  return min + Math.floor(randomFn() * (max - min + 1));
}

function isFarEnough(candidate, dates, minGapMs) {
  return dates.every((date) => Math.abs(candidate.getTime() - date.getTime()) >= minGapMs);
}

function findFallbackCandidate({ windows, baseKstDate, now, selected, blocked, minGapMs, randomFn, rollPastToNextDay }) {
  const all = [...selected, ...blocked];
  const offsets = [];
  const totalDuration = windows.reduce((sum, window) => sum + window.duration, 0);
  const startOffset = randomInt(0, Math.max(0, totalDuration - 1), randomFn);
  for (let i = 0; i < totalDuration; i += 1) offsets.push((startOffset + i) % totalDuration);
  for (const offset of offsets) {
    const minute = minuteAtOffset(windows, offset);
    const dayOffset = Math.floor(minute / (24 * 60));
    const minuteOfDay = minute % (24 * 60);
    let candidate = fromKstDateTime({ ...baseKstDate, date: baseKstDate.date + dayOffset }, minuteOfDay);
    if (candidate < now) {
      if (!rollPastToNextDay) continue;
      candidate = fromKstDateTime({ ...baseKstDate, date: baseKstDate.date + dayOffset + 1 }, minuteOfDay);
    }
    if (isFarEnough(candidate, all, minGapMs)) return candidate;
  }
  return null;
}

function minGapMinutes(dates = []) {
  const sorted = dates.slice().sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  let min = Infinity;
  for (let i = 1; i < sorted.length; i += 1) {
    min = Math.min(min, Math.round((sorted[i].getTime() - sorted[i - 1].getTime()) / 60000));
  }
  return Number.isFinite(min) ? min : null;
}

function tooCloseSlots(dates = [], minGap) {
  const sorted = dates.slice().sort((a, b) => a - b);
  const result = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = Math.round((sorted[i].getTime() - sorted[i - 1].getTime()) / 60000);
    if (gap < minGap) {
      result.push({
        previous: sorted[i - 1].toISOString(),
        current: sorted[i].toISOString(),
        gapMinutes: gap
      });
    }
  }
  return result;
}

export function createDailySchedulePlan(account, date = new Date(), options = {}) {
  const rawMax = Number(account.daily_post_max ?? 5);
  const count = Math.min(5, Math.max(0, Number.isFinite(rawMax) ? rawMax : 5));
  const requestedWindows = account.active_time_windows?.length ? account.active_time_windows : DEFAULT_WINDOWS;
  const minGap = account.min_interval_minutes || 45;
  const now = options.now || new Date();
  const baseKstDate = getKstDateParts(date);
  const windows = normalizeWindows(requestedWindows);
  const totalDuration = windows.reduce((sum, window) => sum + window.duration, 0);
  const minGapMs = minGap * 60 * 1000;
  const randomFn = typeof options.random === 'function' ? options.random : Math.random;
  const blockedDates = (options.blockedTimes || [])
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()));
  const rollPastToNextDay = options.rollPastToNextDay !== false;
  const diagnostics = {
    requestedCount: count,
    minGapMinutes: minGap,
    windows: windows.map((window) => ({ start: window.label.split('-')[0], end: window.label.split('-')[1] })),
    strategy: 'random_day_spread',
    blockedCount: blockedDates.length,
    generatedCount: 0,
    shortage: 0,
    reasonCode: null,
    minObservedGapMinutes: null,
    tooCloseSlots: []
  };

  const selected = [];
  for (let i = 0; i < count; i += 1) {
    const segmentStart = Math.floor((totalDuration * i) / Math.max(1, count));
    const segmentEnd = Math.max(segmentStart, Math.floor((totalDuration * (i + 1)) / Math.max(1, count)) - 1);
    let candidate = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const offset = randomInt(segmentStart, segmentEnd, randomFn);
      const minute = minuteAtOffset(windows, offset);
      const dayOffset = Math.floor(minute / (24 * 60));
      const minuteOfDay = minute % (24 * 60);
      candidate = fromKstDateTime({ ...baseKstDate, date: baseKstDate.date + dayOffset }, minuteOfDay);
      if (candidate < now) {
        if (!rollPastToNextDay) {
          candidate = null;
          continue;
        }
        candidate = fromKstDateTime({ ...baseKstDate, date: baseKstDate.date + dayOffset + 1 }, minuteOfDay);
      }
      if (isFarEnough(candidate, [...selected, ...blockedDates], minGapMs)) break;
      candidate = null;
    }
    if (!candidate) {
      candidate = findFallbackCandidate({ windows, baseKstDate, now, selected, blocked: blockedDates, minGapMs, randomFn, rollPastToNextDay });
    }
    if (candidate) selected.push(candidate);
  }

  const result = selected.sort((a, b) => a - b);
  const times = result.map((d) => d.toISOString());
  const observedDates = result.concat(blockedDates).sort((a, b) => a - b);
  const tooClose = tooCloseSlots(observedDates, minGap);
  return {
    times,
    diagnostics: {
      ...diagnostics,
      availableMinutes: totalDuration,
      generatedCount: times.length,
      shortage: Math.max(0, count - times.length),
      reasonCode: times.length < count ? 'SCHEDULE_CAPACITY_SHORTAGE' : null,
      minObservedGapMinutes: minGapMinutes(observedDates),
      tooCloseSlots: tooClose,
      actualTimes: times
    }
  };
}

export function createDailySchedule(account, date = new Date(), options = {}) {
  return createDailySchedulePlan(account, date, options).times;
}
