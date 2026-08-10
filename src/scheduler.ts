import { formatNowJst } from "./dateUtils";
import { uploadGeneratedImage } from "./githubMediaUpload";
import { generateImageFromCaption } from "./imageGenerator";
import { publishPost } from "./instagram";
import {
  getDuePosts,
  getRowStatus,
  markError,
  markPosted,
  markProcessing,
  updateMediaUrl,
} from "./sheets";
import { ensureFreshToken } from "./tokenManager";
import { POST_STATUS } from "./types";

/**
 * 投稿予定を確認し、期限が来た未投稿の行をInstagramへ投稿する。
 * 行単位のエラーは握りつぶしてシートに記録し、他の行の処理を継続する。
 */
export async function run(): Promise<void> {
  const settings = await ensureFreshToken();
  const duePosts = await getDuePosts();

  if (duePosts.length === 0) {
    console.log("投稿予定の対象はありません。");
    return;
  }

  console.log(`${duePosts.length}件の投稿対象を検出しました。`);

  for (const post of duePosts) {
    try {
      // 前回実行からの状態変化を考慮し、処理直前に再度ステータスを確認する（二重投稿防止）
      const currentStatus = await getRowStatus(post.rowNumber);
      if (currentStatus !== POST_STATUS.UNPOSTED) {
        console.log(
          `行${post.rowNumber}: ステータスが「未投稿」ではないためスキップします（現在: ${currentStatus}）`
        );
        continue;
      }

      await markProcessing(post.rowNumber);

      let mediaUrl = post.mediaUrlRaw;
      if (post.postType === "image" && mediaUrl.trim() === "") {
        console.log(`行${post.rowNumber}: メディアURLが未入力のため画像を自動生成します`);
        const imageBuffer = await generateImageFromCaption(post.caption);
        mediaUrl = await uploadGeneratedImage(imageBuffer, post.rowNumber);
        await updateMediaUrl(post.rowNumber, mediaUrl);
      }

      const mediaId = await publishPost(
        settings.igUserId,
        settings.accessToken,
        post.postType,
        mediaUrl,
        post.caption
      );

      await markPosted(post.rowNumber, mediaId, formatNowJst());
      console.log(`行${post.rowNumber}: 投稿に成功しました（メディアID: ${mediaId}）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`行${post.rowNumber}: 投稿に失敗しました - ${message}`);
      try {
        await markError(post.rowNumber, message);
      } catch (writeError) {
        console.error(`行${post.rowNumber}: エラー内容のシート書き込みにも失敗しました`, writeError);
      }
    }
  }
}
