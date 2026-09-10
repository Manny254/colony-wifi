/**
 * Daraja requires timestamps in Africa/Nairobi local time (EAT, UTC+3,
 * no daylight saving) in the format YYYYMMDDHHmmss. Server runtimes
 * (e.g. Vercel) run on UTC, so naive Date formatting would be 3 hours
 * off and every STK push password would be rejected as invalid.
 */
export function darajaTimestamp(date: Date = new Date()): string {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const yyyy = eat.getUTCFullYear();
  const mm = String(eat.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(eat.getUTCDate()).padStart(2, "0");
  const hh = String(eat.getUTCHours()).padStart(2, "0");
  const min = String(eat.getUTCMinutes()).padStart(2, "0");
  const ss = String(eat.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${min}${ss}`;
}
