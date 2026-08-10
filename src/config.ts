import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env または GitHub Secrets を確認してください。`
    );
  }
  return value;
}

/** 未設定でも起動時エラーにしない任意の環境変数を読み込む */
function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const config = {
  google: {
    serviceAccountEmail: requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    // GitHub Secrets / .env では改行が \n というリテラル文字列として保存されるため復元する
    privateKey: requireEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    sheetId: requireEnv("GOOGLE_SHEET_ID"),
  },
  instagram: {
    appId: requireEnv("IG_APP_ID"),
    appSecret: requireEnv("IG_APP_SECRET"),
    graphApiVersion: "v21.0",
  },
  // 画像自動生成機能（任意）。未設定でも他の機能には影響しない。
  openai: {
    apiKey: optionalEnv("OPENAI_API_KEY"),
  },
  github: {
    token: optionalEnv("GITHUB_TOKEN"),
    repo: optionalEnv("GITHUB_REPO"),
    branch: optionalEnv("GITHUB_BRANCH") ?? "main",
  },
} as const;

/** シートのタブ名・レンジ定義 */
export const SHEET = {
  POSTS_TAB: "投稿予定",
  // A:No B:投稿タイプ C:メディアURL D:キャプション E:投稿予定日時
  // F:ステータス G:InstagramメディアID H:実投稿日時 I:エラー内容
  POSTS_RANGE: "投稿予定!A2:I",
  POSTS_HEADER_ROW: 1,
  SETTINGS_TAB: "設定",
  // 「設定」タブは見出し行なしのkey-value形式（A1から開始）
  SETTINGS_RANGE: "設定!A1:B",
} as const;

/** トークンの残り有効日数がこれ以下になったら自動更新する */
export const TOKEN_REFRESH_THRESHOLD_DAYS = 5;

/** リール動画のエンコード完了待ちの上限（ミリ秒）とポーリング間隔 */
export const REEL_PROCESSING_TIMEOUT_MS = 4 * 60 * 1000;
export const REEL_POLL_INTERVAL_MS = 8 * 1000;
