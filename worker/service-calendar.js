// Verified against Kyoto Bus's published 2026 autumn university service calendar.
export const CALENDAR_SOURCE='https://www.kyotobus.jp/rosen/sandai_schedule_40_sandai.pdf';
const holidays=new Set(['2026-09-21','2026-09-22','2026-09-23','2026-10-12','2026-11-03','2026-11-23','2027-01-01','2027-01-11','2027-02-11','2027-02-23','2027-03-22']);
export function calendarDay(date,operator){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('日付を確認してください。');
  const d=new Date(`${date}T00:00:00Z`),weekday=d.getUTCDay();
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==date)throw Error('日付を確認してください。');
  // Avoid assuming a Japanese holiday is a weekday beyond the verified interval.
  if(date<'2026-09-20'||date>'2027-03-31')return null;
  if(operator==='kyotobus'){
    if(date==='2027-01-04')return 'weekday_b';
    if(date>='2026-12-28'&&date<='2027-01-03')return 'holiday';
    if(holidays.has(date)||weekday===0)return 'holiday';
    if(weekday===6)return 'saturday';
    if(date<'2026-09-28'||['2026-10-29','2026-11-02','2027-01-05'].includes(date)||date>='2027-01-19')return 'weekday_b';
    return weekday===3?'wednesday_a':'weekday_a';
  }
  return holidays.has(date)||weekday===0?'holiday':weekday===6?'saturday':'weekday';
}
