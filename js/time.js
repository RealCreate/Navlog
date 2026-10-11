// Times are UTC (as on every aviation document) with Spanish local time in brackets,
// e.g. "0930Z (11:30)". Local time is Europe/Madrid, so summer/winter time is automatic.

const pad = (n) => String(n).padStart(2, '0');
const LOCAL = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export const utc = (d) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}Z`;
export const local = (d) => LOCAL.format(d);
/** "0930Z (11:30)" */
export const zl = (d) => (d ? `${utc(d)} (${local(d)})` : '');

/** A UTC "HH:MM" from a table, on the day of `day`, shown as "08:00Z (10:00)". */
export function hhmmZl(hhmm, day = new Date()) {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return hhmm;
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m));
  return `${pad(h)}:${pad(m)}Z (${local(d)})`;
}
