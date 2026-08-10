import axios from "axios";
import { config, TOKEN_REFRESH_THRESHOLD_DAYS } from "./config";
import { nowJst } from "./dateUtils";
import { readSettings, writeSettings } from "./sheets";
import { Settings } from "./types";

const GRAPH_BASE_URL = `https://graph.facebook.com/${config.instagram.graphApiVersion}`;

interface DebugTokenResponse {
  data: { expires_at: number };
}

interface ExchangeTokenResponse {
  access_token: string;
  expires_in: number; // 秒
}

/** /debug_token でトークンの実際の失効日時を取得する */
async function fetchTokenExpiry(accessToken: string): Promise<Date> {
  const appAccessToken = `${config.instagram.appId}|${config.instagram.appSecret}`;
  const res = await axios.get<DebugTokenResponse>(`${GRAPH_BASE_URL}/debug_token`, {
    params: { input_token: accessToken, access_token: appAccessToken },
  });
  return new Date(res.data.data.expires_at * 1000);
}

/** fb_exchange_token で長期トークンを延長する */
async function exchangeForNewLongLivedToken(currentToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const res = await axios.get<ExchangeTokenResponse>(`${GRAPH_BASE_URL}/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: config.instagram.appId,
      client_secret: config.instagram.appSecret,
      fb_exchange_token: currentToken,
    },
  });
  const expiresAt = new Date(Date.now() + res.data.expires_in * 1000);
  return { accessToken: res.data.access_token, expiresAt };
}

/**
 * スプレッドシート「設定」タブのアクセストークンをチェックし、必要なら自動更新する。
 * 更新後の最新設定（有効なアクセストークンを含む）を返す。
 */
export async function ensureFreshToken(): Promise<Settings> {
  const settings = await readSettings();

  // 初回など、有効期限が未記録の場合はまず実際の失効日時を問い合わせて記録するだけに留める
  if (!settings.tokenExpiresAt) {
    try {
      const expiresAt = await fetchTokenExpiry(settings.accessToken);
      await writeSettings({
        tokenExpiresAt: expiresAt.toISOString(),
        tokenUpdatedAt: nowJst().toISOString(),
      });
      return { ...settings, tokenExpiresAt: expiresAt.toISOString() };
    } catch {
      // 失効日時の問い合わせに失敗しても投稿処理自体は継続する
      return settings;
    }
  }

  const expiresAt = new Date(settings.tokenExpiresAt);
  const daysRemaining = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  if (daysRemaining > TOKEN_REFRESH_THRESHOLD_DAYS) {
    return settings;
  }

  const { accessToken, expiresAt: newExpiresAt } = await exchangeForNewLongLivedToken(
    settings.accessToken
  );
  const updatedAtIso = nowJst().toISOString();

  await writeSettings({
    accessToken,
    tokenUpdatedAt: updatedAtIso,
    tokenExpiresAt: newExpiresAt.toISOString(),
  });

  return {
    ...settings,
    accessToken,
    tokenUpdatedAt: updatedAtIso,
    tokenExpiresAt: newExpiresAt.toISOString(),
  };
}
