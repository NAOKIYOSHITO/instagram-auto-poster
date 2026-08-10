import { run } from "./scheduler";

run()
  .then(() => {
    console.log("処理が完了しました。");
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("致命的なエラーが発生したため処理を中断しました:", message);
    process.exitCode = 1;
  });
