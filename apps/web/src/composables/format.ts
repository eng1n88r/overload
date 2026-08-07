/** Display label for enum-ish values: underscores to spaces, first letter
 *  capitalized ('front_delts' -> 'Front delts', 'EZ-bar' stays 'EZ-bar'). */
export function labelize(value: string): string {
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Today's date as YYYY-MM-DD in the browser's local timezone. Deliberately
 *  not `new Date().toISOString().slice(0, 10)`, which converts to UTC first
 *  and rolls over to tomorrow's date in the evening for timezones behind UTC. */
export function todayLocal(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** A workout's date is a calendar day, not an instant: the generator stores it
 *  at UTC midnight. Formatting it in local time moves it to the previous
 *  evening for anyone behind UTC, so a Wednesday session reads as Tuesday
 *  8:00 PM. Read it back in UTC and the day survives. */
export function fmtWorkoutDate(iso: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Date(iso).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
}

/** The same date as a sortable YYYY-MM-DD key, for comparing against todayLocal(). */
export function workoutDateKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Elapsed workout time. Recorded on completion but never shown until now. */
export function fmtDuration(sec: number | null | undefined): string | null {
  if (!sec || sec <= 0) return null;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
