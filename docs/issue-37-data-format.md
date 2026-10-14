# Google Driveセッション保存形式 v1

標準JSON（UTF-8）と、MediaRecorderから得た元の動画ファイルを保存します。IndexedDBやJavaScriptのTypedArray、独自バイナリヘッダを解釈する必要はありません。Swift／PythonからJSONと動画を直接読めます。受け側は `schemaVersion` を確認し、未対応版を黙って変換しないでください。

## フォルダ構成

```text
Personal Sports Form Lab/
  sessions/
    <session-id>/
      snapshot-<content-hash-prefix>/
        metadata.json
        shots.json                       # 認識結果／フォームを選択した場合
        reviews.json                     # レビューを選択した場合
        diagnostics.json                 # 診断情報を選択した場合
        pose/
          landmarks-0000.json            # 骨格を選択した場合、最大約1000フレーム/ファイル
          landmarks-0001.json
        videos/
          <stable-source-id-hash>.mp4     # 選んだ動画だけ。WebMの場合は.webm
```

内容や選択が変わった版は新しい保存版にします。同一内容の再試行では再利用します。以前の成功版は上書き・削除しません。変更した版を保存するとDrive使用量は増えますが、同じ版の再送で増やし続ける方式ではありません。自動的に古い版を削除しません。

`metadata.json` は最後に送信・確認する完了マーカーです。中断されたフォルダには空のファイルや一部のファイルだけが存在する場合があります。ファイルがあるだけで完了とは判断せず、有効な管理JSONの `uploadState: "complete"` と一覧のサイズ・チェックサムを確認してください。このcompleteは **選んだデータのアップロード完了** であり、練習の全フレームが取得されたことや動画の全区間が録画されたことを意味しません。

## 共通項目・識別子

| 項目 | 意味 |
|---|---|
| `schema` | `personal-sports-form-lab-session` |
| `schemaVersion` | `1` |
| `kind` | metadata / shots / reviews / diagnostics / pose-landmarks |
| `sessionId` | 元の練習ID。そのまま維持する |
| `appVersion` | 撮影時のアプリ版。旧記録で未保存ならnull |
| `exporter.appVersion` | 管理JSON内の書き出しアプリ版 |
| `snapshotId` | 選択内容とファイルのチェックサム等から生成する内容識別子 |
| `createdAtUtc` / `endedAtUtc` | 保存された練習開始／終了の日付をISO 8601 UTC文字列にしたもの |

日時が分からない場合はnullです。元の履歴の日時（`at`、`createdAt`、`updatedAt`など）は、元のJSONと同じUnix epochミリ秒を保持する場合があります。取得していない日時・座標を補いません。

IDは分解せず文字列として扱います。自動検出の `shotId` は `live:<session-id>:<number>` です。検出チェックの手動追加は `check:<session-id>:<item-id>`、既存レビューで手動追加したものは元のレビューIDです。既存レビューと検出チェックが `externalReviewId` で同じショットを示す場合は、そのレビューIDを使います。異なるIDを「近い位置だから」と自動で同一にまとめません。

`snapshotId` はアプリ内の決定的なJSON整列から作るSHA256で、受け側では不透明な識別子として扱えます。SwiftのJSONEncoderなどの文字列化が完全に同じとは限らないため、受け側で再生成する必要はありません。ファイルごとの `sha256` は標準のSHA256で、一般的なツール・CryptoKitから検証できます。

## 時間と動画の対応

管理JSONの `timeline` は次の情報を持ちます。

- `unit: "seconds"`
- `basis: "offset-from-session-monotonic-origin"`
- `sourceOriginSeconds`：元の保存データで使われた単調増加時計の基準値。Poseのoriginを優先し、なければセッション・録画の保存値を使用する。

`releaseSeconds`、`phasesSeconds`、骨格の `timeSeconds`、動画の `startSeconds` / `endSeconds` は、この基準からの秒です。元データの時点が不明ならnullです。フレームごとの正確なUTC日時は保証しません。古い生データの `detectorEvent`、`analysis`、検出チェックの元の `time` と履歴の変更前後は、そのまま保持し、`originalSourceTimeBasis: "monotonic-seconds"` 等で区別します。

動画内の推定位置は `セッション内の秒 - 動画.startSeconds` です。各ショット・手動位置の `videoReferences` に、対応する選択動画のpathと `releaseInVideoSeconds` 等を入れます。MediaRecorderの境界時点と実際の符号化動画長が完全に一致する保証はないため、`timeMapping: "estimated-from-recording-boundaries"` と明記します。境界の空白・重なりはそのまま残し、時間を詰めません。

動画は各分割を独立したMP4／WebMとして保存します。ファイル同士のバイナリ連結はしません。DriveのプレビューやSwiftが録画コーデックを扱えるかは別問題であり、対応しない場合でも元のバイト列を保存します。JSONのみの保存版には動画はありません。別の保存版の動画と合わせる場合は、sessionId・sourceVideoId・保存時の情報を確認してください。未選択の動画がその保存版に含まれると推測しないでください。

## shots.json：元の自動判定

選んだ項目に応じて、安定したshotId、推定リリース位置、各動作フェーズ、元の検出イベント、フォーム評価、分析指標、腰反りの代理推定、音声助言を保持します。`provenance: "automatic"` とします。フォーム一致度は、元の保存スコアです。AI正答率として扱わず、書き出し時に再採点しません。Good Formの比較用JSON・適用したCalibrationの設定もフォーム選択時の文脈として残しますが、Good Formの動画を自動で送ることはありません。

認識結果／診断選択時の `metadata.recognition` に、保存されているモデル・検出ルール・ガード版・検出パラメータを入れます。保存がなければnullで、現在の既定値を旧記録の実値として代入しません。

## reviews.json：人が確認したこと

`cases` には、本人による検出／フォーム／音声／成否などのラベル、修正履歴、コーチ原文、動画範囲の修正を保持します。`human-review` と `manual-added` を区別します。`detectionCheck` にはクイック／全編チェックの追加・誤検出・位置修正・確認状態と履歴を保持し、元の判定から区別します。セッション全体の評価・コメントも保存されていれば含めます。

手動追加の位置は `timeBasis` に従って解釈します。`release-estimate` と、古い記録の `unspecified` は同じ根拠ではありません。未確認、後で確認する候補、全区間の確認が済んでいないラベルから、練習全体の見逃し率や正解率を計算しないでください。Cloud保存は学習・Calibration承認ではありません。

## 骨格JSON

`pose/landmarks-*.json` の `frames` は次の形式です（説明用の人工例）。

```json
{
  "schema": "personal-sports-form-lab-session",
  "schemaVersion": 1,
  "kind": "pose-landmarks",
  "sessionId": "example-session",
  "coordinateSystem": "normalized-image-unmirrored-2d",
  "landmarkColumns": ["id", "x", "y", "visibility"],
  "landmarkIds": [11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28],
  "zAvailable": false,
  "partIndex": 0,
  "frames": [
    {"timeSeconds": 0.05, "aspect": 0.5625, "landmarks": null}
  ]
}
```

landmarksがあるフレームでは、`[id, x, y, visibility]` の配列が14点分入ります。画像の左上を基準にした正規化2D座標で、プレビューの鏡像表示とは別です。フレームごとの `aspect` は元の画像の幅／高さです。33点すべて、z座標、worldLandmarks、腰椎の実測角度は保存されていないため作りません。visibilityはMediaPipeの関節可視性で、シュートである確率ではありません。

元の最大記録速度は20fpsで、実際の間隔・欠落は保存された値です。nullフレームや長い間隔を消したり補間したりしません。管理JSONの `localAvailability.pose` に、利用可否、保存フレーム数、元のcount、完全性、回転の記録、partsを入れます。骨格が未選択・取得不能ならファイルを作らず、その状態を残します。1ファイル約1000フレームに分け、iPhone上で全セッションを一度に展開しません。

## Swift／Macでの読取り

1. Driveから保存版フォルダをダウンロード。まずmetadata.jsonをJSONDecoder／Pythonのjsonモジュールで読む。
2. schemaVersionとuploadStateを確認。`files` のpath、サイズ、SHA256を確認する。`driveFileId` はクラウド参照用で、ローカルの読取りには不要。
3. 動画は1本ずつ開き、明示したstart/endとvideoReferencesを使う。映像の欠落を連結で隠さない。
4. 骨格partsを順に読む。SwiftではtimeSeconds・aspectをDouble、landmarksをoptionalな二重の数値配列として扱えます。日時をDateにする場合はミリ秒付きISO 8601に対応させます。
5. shotsの自動判定とreviewsの人のラベルを、sessionId／shotIdで合わせる。元のスコアやイベントを手動ラベルで上書きせず、比較用に両方持つ。

サーバーの送信完了はファイルサイズとSHA256（未提供ならMD5）で確認します。JSONの `files[].verified` はこの確認の結果です。OS／Google側の障害による後日の消失や、所有者がDriveで編集した場合の内容まで保証するものではありません。
