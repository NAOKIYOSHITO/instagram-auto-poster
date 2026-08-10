import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export const JST = "Asia/Tokyo";

/** "YYYY-MM-DD HH:mm" 形式（JST想定）の文字列をパースする。不正な形式なら null。 */
export function parseJstDateTime(value: string): dayjs.Dayjs | null {
  const parsed = dayjs.tz(value.trim(), "YYYY-MM-DD HH:mm", JST);
  return parsed.isValid() ? parsed : null;
}

export function nowJst(): dayjs.Dayjs {
  return dayjs().tz(JST);
}

/** シートに記録する用のフォーマット済み現在時刻文字列（JST） */
export function formatNowJst(): string {
  return nowJst().format("YYYY-MM-DD HH:mm:ss");
}

/** 投稿予定日時が現在時刻以前（＝投稿すべきタイミングが来ている）かどうか */
export function isDueJst(scheduledAtRaw: string, now: dayjs.Dayjs = nowJst()): boolean {
  const scheduled = parseJstDateTime(scheduledAtRaw);
  if (!scheduled) return false;
  return !scheduled.isAfter(now);
}
