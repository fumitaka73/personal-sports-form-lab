# personal-sports-form-lab

スポーツのフォーム動画を見返し、気づきを記録する日本語のWebアプリです。

## できること

- 動画の追加・一覧表示・再生（1本200MBまで）
- 動画ごとのフォームメモの保存
- 動画とメモの削除（確認ダイアログ付き）
- スマートフォン幅への対応

動画とメモはIndexedDBを使って、そのブラウザに保存します。動画の外部送信、アカウント、クラウド同期、AI分析はありません。ブラウザのサイトデータを削除すると記録も消えます。大切な動画は元ファイルを保管してください。再生可能な形式はブラウザに依存します。MP4（H.264）またはWebMを推奨します。

## 開発

Node.js 24とnpmを使用します。

```sh
npm ci
npm run dev -- --port 5173 --strictPort
```

開発サーバーの起動後、表示されるアドレスを手元のブラウザで開きます。動画を追加し、メモを保存してからページを再読み込みすると保存結果を確認できます。保存データはブラウザとオリジン（ホスト・ポート）ごとに異なります。

## ビルド

```sh
npm run build
npm run preview -- --port 4173 --strictPort
```

`dist/` に静的サイトを生成します。本番公開には静的ホスティングを使用してください。

## クラウド環境

作業ディレクトリは `/workspace/personal-sports-form-lab`。npmキャッシュに書き込めない環境では、`npm ci --cache /workspace/.npm-cache` を使用してください。新しいタスクでは既存のチェックアウトを使用します。

## GitHub Pagesへの公開

GitHubのリポジトリで **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。
`main` へのpushまたは **Actions → Deploy to GitHub Pages → Run workflow** でビルドと公開が実行されます。
公開先は `https://fumitaka73.github.io/personal-sports-form-lab/` です。初回公開が成功するまではアクセスできません。
Viteのアセットパスは相対パスに設定しているため、リポジトリ名のサブディレクトリから読み込めます。
