export type PostType = "image" | "carousel" | "reel";

export const POST_STATUS = {
  UNPOSTED: "未投稿",
  PROCESSING: "処理中",
  POSTED: "投稿済み",
  ERROR: "エラー",
} as const;

export type PostStatus = (typeof POST_STATUS)[keyof typeof POST_STATUS];

/** 「投稿予定」シートの1行分のデータ。rowNumber はシート上の実際の行番号（1始まり）。 */
export interface PostRow {
  rowNumber: number;
  no: string;
  postType: PostType;
  mediaUrlRaw: string;
  caption: string;
  scheduledAtRaw: string;
  status: string;
  mediaId: string;
  postedAt: string;
  errorMessage: string;
}

/** 「設定」シートに保存する可変設定。 */
export interface Settings {
  igUserId: string;
  accessToken: string;
  tokenUpdatedAt: string;
  tokenExpiresAt: string;
}

export interface CarouselItem {
  url: string;
  isVideo: boolean;
}
