function toMMDDYYYY(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const MMDDYYYY_RE = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/\d{4}$/;

function getMonday(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

// Returns the Mon–Fri dates of the week containing `date` as MM/DD/YYYY strings
export function getWeekdays(date: Date = new Date()): string[] {
  const monday = getMonday(date);
  return Array.from({ length: 5 }, (_, i) => {
    const dd = new Date(monday);
    dd.setDate(monday.getDate() + i);
    return toMMDDYYYY(dd);
  });
}

// Returns the Monday of the current week as MM/DD/YYYY
export function getWeekMonday(date: Date = new Date()): string {
  return toMMDDYYYY(getMonday(date));
}

export function isValidMMDDYYYY(value: string): boolean {
  if (!MMDDYYYY_RE.test(value)) return false;

  const [month, day, year] = value.split('/').map(Number);
  const parsed = new Date(year, month - 1, day);

  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

// Parse MM/DD/YYYY → comparable date string YYYY-MM-DD
export function toISO(mmddyyyy: string): string {
  const [m, d, y] = mmddyyyy.split('/');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Normalize an ISO date from the API (e.g. "2026-05-04T00:00:00") to YYYY-MM-DD
export function normalizeApiDate(apiDate: string): string {
  return apiDate.split('T')[0];
}
