# Instagram 予約投稿システム

Googleスプレッドシートに投稿予定を登録しておくだけで、指定した日時にInstagramへ自動投稿してくれる仕組みです。GitHub Actionsが10分おきにスプレッドシートをチェックし、時間が来た投稿をInstagram Graph API経由で公開します。

- 画像投稿・カルーセル投稿（複数枚）・リール投稿に対応
- 投稿管理は使い慣れたGoogleスプレッドシートで完結
- 投稿が成功したら自動で「投稿済み」に更新、投稿IDと投稿日時も記録
- 失敗したらエラー内容をシートに記録（同じ投稿を二重に投稿しない仕組み付き）
- アクセストークンの期限切れも自動で更新

**対象読者**: プログラミング経験が少なくても、この手順を上から順に実行すれば動かせるように書いています。少し長いですが、一つずつ進めてください。

---

## 全体の流れ（できあがるとこうなる）

```
Googleスプレッドシート（投稿予定を書く場所）
        ↓ 10分ごとに自動チェック
GitHub Actions（無料の自動実行の仕組み）
        ↓ 時間が来た投稿を送信
Instagram（投稿される）
        ↓ 結果を書き戻す
Googleスプレッドシート（ステータス・投稿ID・エラーが記録される）
```

セットアップは大きく分けて次の6ステップです。

1. Instagram側の準備（ビジネスアカウント連携・アクセストークン取得）
2. Google側の準備（サービスアカウント作成・スプレッドシート共有）
3. スプレッドシートのテンプレート作成
4. 投稿する画像・動画の公開URLを用意する
5. リポジトリのセットアップとローカルでの動作確認
6. GitHubへのアップロードとGitHub Actionsの設定

---

## ステップ1: Instagram側の準備

前提条件として、Instagramアカウントが「プロアカウント（ビジネスまたはクリエイター）」になっていて、かつFacebookページと連携されている必要があります。

### 1-1. InstagramをプロアカウントにしてFacebookページと連携する

1. Instagramアプリで「設定」→「アカウントの種類とツール」からプロアカウント（ビジネス）に切り替える
2. 案内に従ってFacebookページと連携する（Facebookページを持っていなければ新規作成する）

### 1-2. Meta for Developersでアプリを作成する

1. [Meta for Developers](https://developers.facebook.com/) にFacebookアカウントでログイン
2. 「マイアプリ」→「アプリを作成」
3. アプリタイプは「ビジネス」を選択して作成
4. 作成したアプリのダッシュボードで「製品を追加」から **Instagram Graph API** を追加
5. アプリの設定画面（「設定」→「ベーシック」）に表示される **アプリID** と **app secret（アプリシークレット）** を控えておく（あとで`.env`と GitHub Secretsに使います）

### 1-3. Instagramビジネスアカウント（ユーザー）IDを調べる

Graph API Explorerを使うと簡単です。

1. [Graph API Explorer](https://developers.facebook.com/tools/explorer/) を開く
2. 右上でアプリを自分の作成したアプリに切り替える
3. 「User or Page」を「User Token」にし、権限（Permissions）に以下を追加してトークンを生成する
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_show_list`
   - `pages_read_engagement`
4. クエリ欄に `me/accounts` と入力して実行し、連携したFacebookページの `id` を確認する
5. 続けて `{ページID}?fields=instagram_business_account` と入力して実行し、返ってきた `instagram_business_account.id` が **InstagramビジネスアカウントID（IG_USER_ID）** です。控えておく

### 1-4. 長期アクセストークンを取得する

Graph API Explorerで発行されるトークンは有効期限が短い（1〜2時間）ため、長期トークン（60日間有効）に交換します。

1. Graph API Explorerで発行した短期トークンをコピーする
2. ブラウザまたはコマンドで以下のURLにアクセスする（`{...}` の部分を自分の値に置き換える）

   ```
   https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id={アプリID}&client_secret={app secret}&fb_exchange_token={短期トークン}
   ```

3. レスポンスの `access_token` が長期アクセストークンです。これを控えておく（スプレッドシートの「設定」タブに入力します）

> **自動更新について**: この長期トークンは60日で失効しますが、本システムは実行のたびに残り日数をチェックし、5日を切ると自動的に新しいトークンへ更新してスプレッドシートに書き戻します。一度セットアップすれば、基本的に手動更新は不要です。

---

## ステップ2: Google側の準備

### 2-1. Google Cloudでサービスアカウントを作成する

1. [Google Cloud Console](https://console.cloud.google.com/) にアクセスし、新規プロジェクトを作成（または既存のものを使用）
2. 「APIとサービス」→「ライブラリ」から **Google Sheets API** を検索して有効化する
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「サービスアカウント」を選択
4. 名前を適当に入力して作成（ロールの設定はスキップしてOK）
5. 作成したサービスアカウントの詳細画面 →「キー」タブ →「鍵を追加」→「新しい鍵を作成」→ **JSON** を選択してダウンロード
6. ダウンロードしたJSONファイルを開き、以下の2つの値を控える
   - `client_email`（例: `xxxx@xxxx.iam.gserviceaccount.com`）→ これが `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key`（`-----BEGIN PRIVATE KEY-----` から始まる長い文字列）→ これが `GOOGLE_PRIVATE_KEY`

### 2-2. スプレッドシートを作成してサービスアカウントに共有する

1. Googleスプレッドシートで新しいシートを作成する
2. 右上の「共有」から、先ほど控えた `client_email`（サービスアカウントのメールアドレス）を**編集者**として追加する
3. スプレッドシートのURL `https://docs.google.com/spreadsheets/d/【この部分】/edit` の「この部分」が **GOOGLE_SHEET_ID** です。控えておく

---

## ステップ3: スプレッドシートのテンプレート作成

作成したスプレッドシートに、以下の2つのタブ（シート）を作ります。**タブ名・見出しは指定どおりに入力してください。**

### タブ「投稿予定」

1行目に見出しを入力し、2行目以降に投稿データを入力します。

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| No | 投稿タイプ | メディアURL | キャプション | 投稿予定日時 | ステータス | InstagramメディアID | 実投稿日時 | エラー内容 |
| 1 | image | https://.../a.jpg | こんにちは | 2026-08-10 09:00 | 未投稿 | | | |

- **投稿タイプ**: `image`（画像1枚）/ `carousel`（複数枚まとめて投稿）/ `reel`（リール動画）のいずれか
- **メディアURL**: 誰でもアクセスできる公開URL。`carousel`の場合はカンマ区切りで2〜10件（画像・動画の混在も可、`.mp4`/`.mov`拡張子は自動的に動画として扱われます）。`image`タイプでこの欄を空欄にすると、キャプションの文章からAIが画像を自動生成します（ステップ4参照）
- **投稿予定日時**: `YYYY-MM-DD HH:mm` 形式、日本時間（JST）で入力
- **ステータス**: 最初は必ず「未投稿」と入力する。あとはシステムが自動で更新する（`未投稿`→`処理中`→`投稿済み`または`エラー`）
- **InstagramメディアID・実投稿日時・エラー内容**: 空欄のままでOK。システムが自動で書き込む

### タブ「設定」

A列にキー、B列に値を入力します（この4行をあらかじめ作っておいてください）。

| A | B |
|---|---|
| IG_USER_ID | （ステップ1-3で控えたInstagramビジネスアカウントID） |
| ACCESS_TOKEN | （ステップ1-4で取得した長期アクセストークン） |
| TOKEN_UPDATED_AT | （空欄のままでOK） |
| TOKEN_EXPIRES_AT | （空欄のままでOK） |

---

## ステップ4: 投稿する画像・動画の公開URLを用意する

Instagram Graph APIは「誰でもアクセスできる公開URL」からしかメディアを取得できません。お手持ちのファイルをアップロードして公開URLを発行する方法として、**このリポジトリの`media`フォルダを使う方法**をおすすめします。

### おすすめの方法: リポジトリの`media`フォルダを使う

1. このリポジトリ（後述のステップ6でGitHubにアップロードしたもの）の `media` フォルダに、GitHubのWeb画面から画像・動画をアップロードする（ドラッグ&ドロップでOK）
2. アップロードしたファイルの公開URLは次の形式になります。

   ```
   https://raw.githubusercontent.com/【あなたのGitHubユーザー名】/【リポジトリ名】/main/media/【ファイル名】
   ```

3. このURLをスプレッドシートの「メディアURL」列に貼り付ける

> **注意点**
> - この方法を使うには、リポジトリを **Public（公開）** にする必要があります（`raw.githubusercontent.com`は公開リポジトリのファイルしか配信できません）。投稿する画像・動画自体を人に見られても問題ない場合に使ってください。
> - GitHubは1ファイル100MBまでという制限があります（推奨は50MB以下）。リール動画が大きすぎる場合は下記の代替案を検討してください。
> - リポジトリを非公開にしたい場合や動画が大きい場合は、代わりに [Cloudinary](https://cloudinary.com/)（無料枠あり、画像・動画アップロード後に直接公開URLが発行される）などの外部ストレージサービスを使うこともできます。使い方はサービスごとの手順に従ってください。

### 画像を自動生成したい場合（任意）

画像を用意するのが面倒な場合、**投稿タイプが`image`の行に限り**、「メディアURL」列を空欄のまま登録すると、OpenAIが「キャプション」列の文章をもとに画像を自動生成し、このリポジトリの`media`フォルダへ自動的にコミットして使用します（生成されたURLは実行後に「メディアURL」列にも自動記録されます）。

- **対象は`image`タイプのみ**です。`carousel`・`reel`は従来通りメディアURLを手動で用意してください。
- キャプションの文章がそのまま画像生成の指示（プロンプト）になります。生成してほしい画像のイメージも含めてキャプションを書くと、より意図に近い画像になります。
- OpenAIの画像生成APIは**利用のたびに料金が発生**します。事前に[OpenAIの料金ページ](https://openai.com/api/pricing/)をご確認ください。

**設定手順**

1. [platform.openai.com](https://platform.openai.com/) でAPIキーを発行する
2. GitHub Secretsに `OPENAI_API_KEY` を追加する（ステップ6-2参照）。**GitHub Actionsでの自動実行にはこれだけで十分**で、GitHubへのコミット権限はActionsが自動的に提供するトークンを使うため、別途トークンを作る必要はありません
3. ローカル（`npm start`）でこの機能も試したい場合のみ、`.env`に以下も設定してください
   - `GITHUB_TOKEN`: このリポジトリへの「Contents: Read and write」権限を持つ [Personal Access Token](https://github.com/settings/personal-access-tokens/new)（Fine-grained推奨）
   - `GITHUB_REPO`: `あなたのユーザー名/リポジトリ名` の形式

未設定のままでも、メディアURLを手動で入力する従来通りの使い方は問題なく動作します。

---

## ステップ5: リポジトリのセットアップとローカルでの動作確認

### 5-1. 必要なソフトウェア

- [Node.js](https://nodejs.org/) 20以上
- Git

### 5-2. セットアップ

```bash
# 依存パッケージをインストール
npm install

# .envファイルを作成
cp .env.example .env
```

`.env` をテキストエディタで開き、ステップ1・2で控えた値を入力してください。

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=xxxx@xxxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=あなたのスプレッドシートID
IG_APP_ID=あなたのFacebookアプリID
IG_APP_SECRET=あなたのapp secret
```

> `GOOGLE_PRIVATE_KEY` はJSONファイル内の値をそのままダブルクォートで囲んで貼り付ければOKです（`\n` はそのままで大丈夫です）。

### 5-3. 試しに実行してみる

スプレッドシートの「投稿予定」タブに、**投稿予定日時を現在時刻より前**にしたテスト用の行を1つ作ってから、以下を実行します。

```bash
npm start
```

- コンソールに投稿処理のログが表示されます
- 成功すると、その行のステータスが「投稿済み」になり、InstagramメディアIDと実投稿日時が記録されます
- 失敗した場合は「エラー」になり、エラー内容が記録されます。エラーメッセージを読んで原因を直し、ステータスを手動で「未投稿」に戻せば次回また処理対象になります

---

## ステップ6: GitHubへのアップロードとGitHub Actionsの設定

### 6-1. GitHubリポジトリを作成してアップロードする

1. GitHubで新しいリポジトリを作成する（ステップ4で`media`フォルダを公開URLとして使う場合はPublicにする）
2. このプロジェクトのファイルをそのリポジトリにpushする

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/【あなたのユーザー名】/【リポジトリ名】.git
git push -u origin main
```

> `.env` は `.gitignore` に含まれているため、誤ってアップロードされることはありません。

### 6-2. GitHub Secretsを設定する

リポジトリの `Settings` → `Secrets and variables` → `Actions` → `New repository secret` から、以下を1つずつ登録します（値は`.env`と同じもの）。

| Secret名 | 値 |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | サービスアカウントのメールアドレス |
| `GOOGLE_PRIVATE_KEY` | サービスアカウントの秘密鍵 |
| `GOOGLE_SHEET_ID` | スプレッドシートID |
| `IG_APP_ID` | FacebookアプリID |
| `IG_APP_SECRET` | app secret |
| `OPENAI_API_KEY`（任意） | 画像自動生成を使う場合のみ。OpenAIのAPIキー |

### 6-3. 動作確認

1. リポジトリの `Actions` タブを開く
2. 「Instagram予約投稿」ワークフローを選択し、「Run workflow」から手動実行してみる
3. 実行ログを開き、エラーなく完了することを確認する

設定後は `.github/workflows/post-scheduler.yml` の設定により、**10分おきに自動実行**されます。スプレッドシートに投稿予定を追加しておけば、時間が来たときに自動で投稿されます。

---

## 運用ルール

### ステータスの意味

| ステータス | 意味 |
|---|---|
| 未投稿 | まだ投稿されていない（処理対象） |
| 処理中 | 現在投稿処理を実行中（正常に完了すれば投稿済みかエラーに変わる） |
| 投稿済み | 投稿が成功した（処理対象から外れる） |
| エラー | 投稿に失敗した（自動では再試行しない） |

### エラーになったときの対処

「エラー内容」列に表示されたメッセージを確認し、原因（URLが正しいか、キャプションが長すぎないか、動画の形式など）を直したら、ステータス列を手動で「未投稿」に書き換えてください。次回の実行時に再度処理対象になります。

### 二重投稿を防ぐ仕組み

- GitHub Actionsは前回の実行が終わるまで次の実行を待つように設定されているため、処理に時間がかかるリール投稿中に次のcronジョブが重複して走ることはありません
- 投稿処理の直前にもう一度シートのステータスを確認し、「未投稿」でなくなっていたらスキップします
- これらにより、同じ行が2回投稿されることはありません

---

## トラブルシューティング

**Q. 「環境変数 XXX が設定されていません」というエラーが出る**
`.env`（ローカル実行時）またはGitHub Secrets（Actions実行時）に必要な値が設定されているか確認してください。

**Q. 「スプレッドシートの『設定』タブに IG_USER_ID / ACCESS_TOKEN が設定されていません」と出る**
「設定」タブのA列に `IG_USER_ID` と `ACCESS_TOKEN` という文字列が正確に入力されているか、B列に値が入っているか確認してください。

**Q. Google Sheets APIでアクセス権限エラーになる**
スプレッドシートの共有設定で、サービスアカウントのメールアドレスが「編集者」として追加されているか確認してください。

**Q. Instagramへの投稿でエラーになる（トークン関連）**
アクセストークンが失効している可能性があります。ステップ1-4の手順で新しい長期トークンを取得し、「設定」タブの`ACCESS_TOKEN`を更新してください（本システムは通常自動更新しますが、長期間実行が止まっていた場合などは失効することがあります）。

**Q. リール投稿で「動画の処理がタイムアウトしました」と出る**
動画ファイルが大きすぎるか、Instagram側の処理が混雑している可能性があります。ファイルサイズを小さくするか、時間をおいてステータスを「未投稿」に戻して再試行してください。

**Q. レート制限（Rate limit）のエラーが出る**
短時間に大量の投稿を予約すると発生することがあります。投稿予定日時を分散させてください。

---

## プロジェクト構成

```
instagram-auto-poster/
├── src/
│   ├── config.ts        # 環境変数の読み込み・バリデーション
│   ├── types.ts          # 型定義
│   ├── dateUtils.ts       # 日時（JST）まわりのユーティリティ
│   ├── sheets.ts          # Googleスプレッドシートの読み書き
│   ├── instagram.ts       # Instagram Graph APIへの投稿処理
│   ├── imageGenerator.ts  # OpenAIによる画像自動生成（任意）
│   ├── githubMediaUpload.ts # 生成した画像のGitHubへのアップロード（任意）
│   ├── tokenManager.ts    # 長期アクセストークンの自動更新
│   ├── scheduler.ts       # 全体のオーケストレーション
│   └── index.ts           # エントリポイント
├── media/                  # 投稿用の画像・動画を置く場所（任意）
├── .github/workflows/post-scheduler.yml  # GitHub Actionsの定義（10分ごとに実行）
├── .env.example
└── README.md
```
