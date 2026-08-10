import axios from "axios";
import { config } from "./config";

interface OpenAiImageResponse {
  data: { b64_json?: string }[];
}

function extractOpenAiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.error?.message;
    if (message) return message;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** キャプションの文章をプロンプトとしてOpenAIで画像を生成し、画像データを返す */
export async function generateImageFromCaption(caption: string): Promise<Buffer> {
  if (!config.openai.apiKey) {
    throw new Error(
      "OPENAI_API_KEY が設定されていません。README の「画像を自動生成したい場合」の手順を確認してください。"
    );
  }

  try {
    const res = await axios.post<OpenAiImageResponse>(
      "https://api.openai.com/v1/images/generations",
      {
        model: "gpt-image-1",
        prompt: caption,
        size: "1024x1024",
      },
      {
        headers: {
          Authorization: `Bearer ${config.openai.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const b64 = res.data.data[0]?.b64_json;
    if (!b64) {
      throw new Error("OpenAIから画像データを取得できませんでした。");
    }
    return Buffer.from(b64, "base64");
  } catch (error) {
    throw new Error(`画像生成に失敗しました: ${extractOpenAiError(error)}`);
  }
}
