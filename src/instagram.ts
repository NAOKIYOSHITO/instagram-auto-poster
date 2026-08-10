import axios, { AxiosError } from "axios";
import { config, REEL_POLL_INTERVAL_MS, REEL_PROCESSING_TIMEOUT_MS } from "./config";
import { CarouselItem, PostType } from "./types";

const GRAPH_BASE_URL = `https://graph.facebook.com/${config.instagram.graphApiVersion}`;

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v"];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Graph APIのエラーレスポンスから人が読めるメッセージを取り出す */
function extractApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ error?: { message?: string; code?: number } }>;
    const apiMessage = axiosError.response?.data?.error?.message;
    if (apiMessage) return apiMessage;
    return axiosError.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** "url1, url2" 形式のカルーセル用メディアURLを解析し、拡張子から画像/動画を判定する */
export function parseCarouselUrls(mediaUrlRaw: string): CarouselItem[] {
  return mediaUrlRaw
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .map((url) => {
      const lower = url.toLowerCase();
      const isVideo = VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext));
      return { url, isVideo };
    });
}

async function createContainer(
  igUserId: string,
  accessToken: string,
  params: Record<string, string>
): Promise<string> {
  try {
    const res = await axios.post<{ id: string }>(`${GRAPH_BASE_URL}/${igUserId}/media`, null, {
      params: { ...params, access_token: accessToken },
    });
    return res.data.id;
  } catch (error) {
    throw new Error(`メディアコンテナの作成に失敗しました: ${extractApiError(error)}`);
  }
}

async function getContainerStatus(containerId: string, accessToken: string): Promise<string> {
  const res = await axios.get<{ status_code: string }>(`${GRAPH_BASE_URL}/${containerId}`, {
    params: { fields: "status_code", access_token: accessToken },
  });
  return res.data.status_code;
}

/** 動画コンテナのエンコードが完了する(FINISHED)までポーリングする */
async function waitUntilFinished(containerId: string, accessToken: string): Promise<void> {
  const deadline = Date.now() + REEL_PROCESSING_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const status = await getContainerStatus(containerId, accessToken);
    if (status === "FINISHED") return;
    if (status === "ERROR") {
      throw new Error("動画の処理中にInstagram側でエラーが発生しました（status_code=ERROR）");
    }
    await sleep(REEL_POLL_INTERVAL_MS);
  }
  throw new Error("動画の処理がタイムアウトしました。ファイルサイズ・形式を確認し、時間をおいて再試行してください。");
}

async function publishContainer(
  igUserId: string,
  accessToken: string,
  creationId: string
): Promise<string> {
  try {
    const res = await axios.post<{ id: string }>(
      `${GRAPH_BASE_URL}/${igUserId}/media_publish`,
      null,
      { params: { creation_id: creationId, access_token: accessToken } }
    );
    return res.data.id;
  } catch (error) {
    throw new Error(`投稿の公開に失敗しました: ${extractApiError(error)}`);
  }
}

async function publishImage(
  igUserId: string,
  accessToken: string,
  imageUrl: string,
  caption: string
): Promise<string> {
  const containerId = await createContainer(igUserId, accessToken, {
    image_url: imageUrl,
    caption,
  });
  return publishContainer(igUserId, accessToken, containerId);
}

async function publishReel(
  igUserId: string,
  accessToken: string,
  videoUrl: string,
  caption: string
): Promise<string> {
  const containerId = await createContainer(igUserId, accessToken, {
    media_type: "REELS",
    video_url: videoUrl,
    caption,
  });
  await waitUntilFinished(containerId, accessToken);
  return publishContainer(igUserId, accessToken, containerId);
}

async function publishCarousel(
  igUserId: string,
  accessToken: string,
  mediaUrlRaw: string,
  caption: string
): Promise<string> {
  const items = parseCarouselUrls(mediaUrlRaw);
  if (items.length < 2 || items.length > 10) {
    throw new Error(
      `カルーセル投稿にはメディアURLが2〜10件必要です（現在${items.length}件）。カンマ区切りで指定してください。`
    );
  }

  const childrenIds: string[] = [];
  for (const item of items) {
    const params: Record<string, string> = { is_carousel_item: "true" };
    if (item.isVideo) {
      params.video_url = item.url;
    } else {
      params.image_url = item.url;
    }
    const containerId = await createContainer(igUserId, accessToken, params);
    if (item.isVideo) {
      await waitUntilFinished(containerId, accessToken);
    }
    childrenIds.push(containerId);
  }

  const carouselContainerId = await createContainer(igUserId, accessToken, {
    media_type: "CAROUSEL",
    children: childrenIds.join(","),
    caption,
  });
  return publishContainer(igUserId, accessToken, carouselContainerId);
}

/** 投稿タイプに応じてInstagramへ投稿し、公開されたメディアIDを返す */
export async function publishPost(
  igUserId: string,
  accessToken: string,
  postType: PostType,
  mediaUrlRaw: string,
  caption: string
): Promise<string> {
  switch (postType) {
    case "image":
      return publishImage(igUserId, accessToken, mediaUrlRaw.trim(), caption);
    case "carousel":
      return publishCarousel(igUserId, accessToken, mediaUrlRaw, caption);
    case "reel":
      return publishReel(igUserId, accessToken, mediaUrlRaw.trim(), caption);
  }
}
