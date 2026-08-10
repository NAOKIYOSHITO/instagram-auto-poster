import { google, sheets_v4 } from "googleapis";
import { config, SHEET } from "./config";
import { isDueJst } from "./dateUtils";
import { POST_STATUS, PostRow, PostType, Settings } from "./types";

const VALID_POST_TYPES: readonly PostType[] = ["image", "carousel", "reel"];

let sheetsClient: sheets_v4.Sheets | null = null;

function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  const auth = new google.auth.JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

function rowToPostRow(row: string[], rangeStartRow: number, index: number): PostRow {
  const rowNumber = rangeStartRow + index;
  return {
    rowNumber,
    no: row[0] ?? "",
    postType: (row[1] ?? "").trim() as PostType,
    mediaUrlRaw: row[2] ?? "",
    caption: row[3] ?? "",
    scheduledAtRaw: row[4] ?? "",
    status: (row[5] ?? "").trim(),
    mediaId: row[6] ?? "",
    postedAt: row[7] ?? "",
    errorMessage: row[8] ?? "",
  };
}

/** 「投稿予定」タブの全行を読み込む（見出し行を除く） */
export async function getAllPosts(): Promise<PostRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: SHEET.POSTS_RANGE,
  });
  const rows = res.data.values ?? [];
  const rangeStartRow = SHEET.POSTS_HEADER_ROW + 1;
  return rows.map((row, i) => rowToPostRow(row as string[], rangeStartRow, i));
}

/** ステータスが「未投稿」かつ投稿予定日時（JST）を過ぎている行を抽出する */
export async function getDuePosts(): Promise<PostRow[]> {
  const posts = await getAllPosts();
  return posts.filter(
    (p) =>
      p.status === POST_STATUS.UNPOSTED &&
      VALID_POST_TYPES.includes(p.postType) &&
      isDueJst(p.scheduledAtRaw)
  );
}

/** 処理直前に単一行のステータスだけを再取得する（二重処理防止のガード） */
export async function getRowStatus(rowNumber: number): Promise<string> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: `${SHEET.POSTS_TAB}!F${rowNumber}`,
  });
  return (res.data.values?.[0]?.[0] ?? "").trim();
}

async function updateStatusColumns(
  rowNumber: number,
  values: [string, string, string, string]
): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range: `${SHEET.POSTS_TAB}!F${rowNumber}:I${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] },
  });
}

/** メディアURL列（C列）だけを更新する（画像自動生成後にURLを記録するため） */
export async function updateMediaUrl(rowNumber: number, url: string): Promise<void> {
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.google.sheetId,
    range: `${SHEET.POSTS_TAB}!C${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[url]] },
  });
}

export async function markProcessing(rowNumber: number): Promise<void> {
  await updateStatusColumns(rowNumber, [POST_STATUS.PROCESSING, "", "", ""]);
}

export async function markPosted(
  rowNumber: number,
  mediaId: string,
  postedAt: string
): Promise<void> {
  await updateStatusColumns(rowNumber, [POST_STATUS.POSTED, mediaId, postedAt, ""]);
}

export async function markError(rowNumber: number, message: string): Promise<void> {
  await updateStatusColumns(rowNumber, [POST_STATUS.ERROR, "", "", message]);
}

const SETTINGS_KEYS = {
  IG_USER_ID: "IG_USER_ID",
  ACCESS_TOKEN: "ACCESS_TOKEN",
  TOKEN_UPDATED_AT: "TOKEN_UPDATED_AT",
  TOKEN_EXPIRES_AT: "TOKEN_EXPIRES_AT",
} as const;

const SETTINGS_KEY_TO_FIELD: Record<string, keyof Settings> = {
  [SETTINGS_KEYS.IG_USER_ID]: "igUserId",
  [SETTINGS_KEYS.ACCESS_TOKEN]: "accessToken",
  [SETTINGS_KEYS.TOKEN_UPDATED_AT]: "tokenUpdatedAt",
  [SETTINGS_KEYS.TOKEN_EXPIRES_AT]: "tokenExpiresAt",
};

/** 「設定」タブ（key-value形式）を読み込む */
export async function readSettings(): Promise<Settings> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: SHEET.SETTINGS_RANGE,
  });
  const rows = res.data.values ?? [];
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = (row?.[0] ?? "").trim();
    const value = (row?.[1] ?? "").trim();
    if (key) map.set(key, value);
  }

  const igUserId = map.get(SETTINGS_KEYS.IG_USER_ID);
  const accessToken = map.get(SETTINGS_KEYS.ACCESS_TOKEN);
  if (!igUserId || !accessToken) {
    throw new Error(
      `スプレッドシートの「${SHEET.SETTINGS_TAB}」タブに IG_USER_ID / ACCESS_TOKEN が設定されていません。README の手順に従って設定してください。`
    );
  }

  return {
    igUserId,
    accessToken,
    tokenUpdatedAt: map.get(SETTINGS_KEYS.TOKEN_UPDATED_AT) ?? "",
    tokenExpiresAt: map.get(SETTINGS_KEYS.TOKEN_EXPIRES_AT) ?? "",
  };
}

/** 「設定」タブの指定したキーの値だけを更新する（存在しないキーは無視） */
export async function writeSettings(partial: Partial<Settings>): Promise<void> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.google.sheetId,
    range: SHEET.SETTINGS_RANGE,
  });
  const rows = res.data.values ?? [];

  const data: sheets_v4.Schema$ValueRange[] = [];
  rows.forEach((row, i) => {
    const key = (row?.[0] ?? "").trim();
    const field = SETTINGS_KEY_TO_FIELD[key];
    if (field && partial[field] !== undefined) {
      const rowNumber = i + 1;
      data.push({
        range: `${SHEET.SETTINGS_TAB}!B${rowNumber}`,
        values: [[partial[field] as string]],
      });
    }
  });

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.google.sheetId,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}
