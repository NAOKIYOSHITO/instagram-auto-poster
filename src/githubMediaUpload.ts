import axios from "axios";
import { config } from "./config";

function extractGitHubError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message;
    if (message) return message;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** 生成した画像をGitHubリポジトリのmedia/フォルダへコミットし、公開URLを返す */
export async function uploadGeneratedImage(image: Buffer, rowNumber: number): Promise<string> {
  if (!config.github.token || !config.github.repo) {
    throw new Error(
      "GITHUB_TOKEN または GITHUB_REPO が設定されていません。README の「画像を自動生成したい場合」の手順を確認してください。"
    );
  }

  const [owner, repo] = config.github.repo.split("/");
  if (!owner || !repo) {
    throw new Error(`GITHUB_REPO の形式が不正です（"owner/repo" の形式で指定してください）: ${config.github.repo}`);
  }

  const path = `media/generated-${Date.now()}-row${rowNumber}.png`;

  try {
    await axios.put(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      {
        message: `画像を自動生成（行${rowNumber}）`,
        content: image.toString("base64"),
        branch: config.github.branch,
      },
      {
        headers: {
          Authorization: `token ${config.github.token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
  } catch (error) {
    throw new Error(`生成した画像のアップロードに失敗しました: ${extractGitHubError(error)}`);
  }

  return `https://raw.githubusercontent.com/${owner}/${repo}/${config.github.branch}/${path}`;
}
