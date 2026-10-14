# v0.22.0：Google Driveに練習を保存する

これは自動同期ではなく、練習終了後に本人が選んだデータを保存するMVPです。現在のIndexedDB v4とv0.21.6の練習フローは維持します。Google Cloudの設定と実アカウント・iPhone Safariでの確認は利用者側の作業として残っています。ダミーのClient IDやClient Secretで連携できる扱いにはしていません。

## Google Cloudで行う設定（最初の1回）

1. [Google Cloud Console](https://console.cloud.google.com/)で、このアプリ専用のプロジェクトを作るか選びます。他のアプリのOAuth Client IDを流用しないでください。連携解除は同じアプリに許可したスコープの解除に関係するためです。
2. 「APIとサービス」→「ライブラリ」で **Google Drive API** を検索して有効にします。Picker API・Sheets API・Gmail API・サービスアカウントは不要です。
3. 「Google Auth Platform」で同意画面を設定します。
   - Branding：アプリ名 `Personal Sports Form Lab`、ご自身のユーザーサポートメール・開発者連絡先。
   - Audience：個人のGoogleアカウントでは **External**。まず **Testing** にし、ご自身のGoogleメールアドレスをテストユーザーに追加します。
   - Data Access：スコープは **`https://www.googleapis.com/auth/drive.file` だけ**。Drive全体を操作する `drive` や `drive.readonly`、`drive.metadata` は追加しません。
4. 「Clients」→「Create client」→アプリケーションの種類 **Web application** を選びます。
   - 承認済みJavaScriptオリジンに **`https://fumitaka73.github.io`** を登録します。
   - `/personal-sports-form-lab/` はオリジンに含めません。オリジンはプロトコル＋ホスト（＋必要ならポート）です。
   - 開発環境で実OAuthを試す場合にだけ `http://localhost`、`http://localhost:5173` を追加します。`127.0.0.1:5173` を使うならそのオリジンも別途登録してください。iPhoneのLAN内HTTPアドレスを本番代わりに使わず、承認したHTTPSの検証先を使います。
   - 今回のGIS token modelはポップアップ型で、アプリ独自のリダイレクトURIやコールバックサーバーは使いません。
5. 作成された **Client ID**（末尾 `.apps.googleusercontent.com`）だけをコピーします。ダウンロードできる認証情報JSONにはClient Secretが含まれる場合があるため、アプリ・GitHub・Issueへ貼り付けないでください。
6. PR版のアプリで、終了後のレポート→「Google Driveに保存」→「Google連携の初期設定」にClient IDを貼り、「Client IDを保存」を押します。読み込み後、別のタップで「Googleアカウントと連携」を押します。初期設定はこのブラウザに保存されます。

Client IDは公開識別子で、秘密鍵ではありません。通常は画面の入力だけで利用でき、GitHub Actionsや再ビルドに秘密情報を渡す必要はありません。管理者があらかじめ公開IDをビルドに設定する場合に限り、`VITE_GOOGLE_OAUTH_CLIENT_ID` を使用できます。現在その値は設定していません。

設定の根拠：[Web用Client IDとオリジン](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)、[Driveのスコープ](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)。

## 認証方式とGitHub Pagesの制約

Google公式の **Google Identity Services（GIS）token model** を使用します。読み込み済みのライブラリに、ユーザーのタップから直接 `requestAccessToken()` を呼びます。短期間のアクセストークンを使うブラウザ方式で、Client Secretとリフレッシュトークンは不要です。トークンはタブのメモリだけに保持し、URL・IndexedDB・localStorage・Git・アプリのログには残しません。期限切れ時は再び本人のタップで接続します。[Googleのtoken model仕様](https://developers.google.com/identity/oauth2/web/guides/use-token-model)

GitHub Pagesには安全なコード交換・秘密鍵管理サーバーがありません。今回は独自のauthorization code交換や、フロントエンドにWeb用Client Secretを置く実装をしません。将来のSwift版はネイティブ用OAuth ClientとPKCEなどを別途設計する必要があります。

今回の方式はOne Tap／Sign in with Googleのログインボタンとは別の、Drive権限を取得するOAuth token modelです。iPhoneではシステムのSafariから操作してください。アプリ内WebViewの動作は保証しません。Safariのポップアップ制限、ITP、コンテンツブロッカーを含め、実機OAuthは未確認です。

オリジンの許可はプロジェクトのパス単位ではありません。同じ `fumitaka73.github.io` に置いた他のページも同一オリジンになります。ドメインを分離する場合は専用HTTPSドメインを追加登録してください。

## 同意画面を公開する場合

- Testingは登録したテストユーザーのみ（最大100人）です。Driveスコープを含むテスト許可は7日で期限が切れます。短期アクセストークンの寿命とは別です。再読み込み後もアプリのメモリ内トークンは失われるため、再接続が必要です。[Audienceの公式制約](https://support.google.com/cloud/answer/15549945)
- `drive.file` は非機密スコープですが、一般公開時のブランド確認、同意画面の表示、ドメイン確認などはGoogle Cloudの実際の審査状態に従ってください。スコープ審査が絶対不要／審査済みとは扱いません。
- アプリホームページは `https://fumitaka73.github.io/personal-sports-form-lab/`、本PRで追加したデータ方針は将来の公開後に `https://fumitaka73.github.io/personal-sports-form-lab/privacy.html` で確認できます。**PR未マージ・未公開の間は後者のURLが利用可能とは扱いません。** 本番検証には実在する公開ページが必要です。
- Brandingの承認済みドメインには実際に使うホスト側のドメインを設定します。所有確認を要求されたらGoogle Search Console等の指示に従ってください。GitHub Pagesのドメインで確認できない場合は、ご自身が所有確認できる独自ドメインで設定してください。
- 今回はGoogle Cloudの「Publish app」、mainへのマージ、GitHub Pagesのデプロイを実行していません。[ブランド確認の公式説明](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)

## 保存先と権限

マイドライブに見える通常の **Personal Sports Form Lab** フォルダを、アプリが自動で作成します。手作業で同名フォルダを作る必要はありません。`drive.file` の範囲内で、このアプリが作成したフォルダ・ファイルだけを探し、本人所有を確認します。他のDriveファイルを一覧・変更するための広い権限は求めません。共有済み・本人所有でない保存先は拒否します。アプリは共有許可を追加しません。

非表示の `appDataFolder` は採用しません。Driveの通常画面から取り出せず、他アプリからもアクセスできないため、Macでの取得・将来の移行という目的に合わないためです。[appDataFolderの制約](https://developers.google.com/workspace/drive/api/guides/appdata)

解除してもDriveの保存版・端末の記録は消しません。期限切れ等でアプリから許可を取り消せない場合は、[Googleアカウントの接続設定](https://myaccount.google.com/connections)でも確認・解除できます。

## 普段の保存方法

1. 練習終了後のレポート、または履歴のレポートで「Google Driveに保存」を押します。Googleと連携し、表示されたアカウントを確認します。
2. JSONの項目を選びます。骨格がない場合は選べず、一部しかない場合はその旨と本数を表示します。未保存の評価・メモがある場合は、先にローカルへ保存してください。
3. 「動画を選ぶ」を開き、必要な区間だけ選びます。全体なら「録画区間をまとめて選ぶ」、動画不要なら「JSONだけ保存」を使います。セッションの基本情報は常に含みます。
4. 保存ボタンを押し、Safariを開いたまま待ちます。送信データを準備→送信→サイズ・チェックサム・管理JSONの確認を行い、確認後にだけ完了とDriveリンクを表示します。
5. 修正後も同じレポートから再保存できます。同じ内容・同じ選択では同じ保存版を再利用します。内容や選択が変わると新しい版を作り、以前の成功版を残します。JSONだけの保存版には動画は含みません。必要に応じてDriveで保存時と同じGoogleアカウントを選んでください。

## 中断・失敗と再試行

動画は1MiBずつの **resumable upload** で送ります。サーバーの `Range` を確認し、受信済みのバイトを推測で飛ばしません。Google上のサイズとSHA256（またはMD5）を確認します。トークンと再開用URLは保存せず、DriveファイルIDだけを新しい設定レコードへ原子的に記録します。[分割送信の仕様](https://developers.google.com/workspace/drive/api/guides/manage-uploads)、[事前発行ID](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/generateIds)、[Driveのチェックサム](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)

- 中断／Safariを離れる：保存を止めます。画面が残っていれば受信位置を問い合わせて再開します。同じアカウントでの認証更新でも、ページ内の再開情報を維持します。
- 再読み込み／Safariによるタブ破棄：再連携し、同じ対象を選んで再試行してください。完了確認できたファイルは再送せず、未完了のファイルだけ先頭から再送します。ファイルIDが同じため、それだけで新しいコピーを増やしません。
- Driveの容量不足・API利用制限：原因を表示し、容量確認や時間を置いてから再試行します。端末のデータを消す対処は行いません。
- Driveで保存先を削除・移動・共有・変更した場合：勝手に作り直したり上書きしたりせず停止します。Drive側で保存先を確認してください。
- 同時に別端末から保存する操作はMVPの保証対象外です。この端末のタブ間ではファイルIDを共通化しますが、クラウド全体の排他的同期基盤は導入していません。

## iPhone Safari実機の確認（設定後）

1. 承認済みHTTPSのPR版で短い練習を録画し、終了後に動画・Pose・結果がローカルにあることを確認。
2. Driveと連携して、動画を1区間とJSONを選び保存。Driveで管理JSONと独立した動画を開き、再生できるか確認。
3. 同じ選択をもう一度保存し、同じ保存版のファイル数が増えないか確認。レビューを修正後に保存し、元の成功版と別の版が残るか確認。
4. 保存中に「中断」、通信を切る、Safariを離れる操作を試し、戻って再試行。認証期限切れ時は同じアカウントに再接続し、保存できるか確認。
5. JSONのみ保存・骨格がない記録・連携解除を試す。再読み込み後もローカルの動画、Pose、Good Form、レビュー・検出修正、Calibrationと履歴が残るか確認。

実アカウントのOAuth、実際のGoogle Drive APIとiPhone Safariの録画形式・アップロードは未検証です。テストは人工のOAuth／Drive APIと独立したブラウザデータで行っています。自動学習、Driveからの復元、バックグラウンド送信、Good Form動画の自動バックアップはこのMVPには含みません。

形式の詳細は [セッション保存形式](issue-37-data-format.md) を参照してください。

## 実行した検証

- `npm test`：214テスト成功（Drive関連の追加17テストを含む）。認証・JSONの元データ保持・動画の分割ハッシュ・送信成功／失敗／中断／再試行・重複防止・認証切れ・容量／利用制限・別アカウント・共有保存先拒否を人工データで確認。
- `npm run build`：成功。
- ブラウザ：`scripts/check-issue-37.mjs` の新規確認に加え、既存の `check-live-coach.cjs`、`check-issue-30.cjs`、`check-issue-28.cjs`、`check-shot-review.cjs`、`check-personal-calibration.mjs`、`check-issue-33.mjs` が成功。縦横画面、練習開始→終了→保存→履歴、音声、検出修正、Calibration承認・復元、旧データ保持をChromiumで確認しました。
- ブラウザ確認は別途PlaywrightとChromiumを用意し、`npm run dev` 起動後に実行します。Google関連は実アカウントを使わないモックで、既存の個人データをテストに使っていません。
