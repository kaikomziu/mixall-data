# mixall-data
MixAll +（二世代）のデータ置き場（自動で書き込まれます）。

- 毎日 03:30（日本時間）に GitHub Actions（`.github/workflows/archive.yml`）が、Supabase でしばらく更新されていないデータを `data/` に移し、GitHub Pages で公開してから Supabase から消します。
- ファイルはサーバー側で暗号化（AES-GCM）されていて、ファイル名・キー一覧も推測できない形です。鍵（`MIXALL_ARCHIVE_SECRET`）は Supabase 側にだけあり、**変えると読めなくなります**。
- サイトは Supabase に無いデータをここ（`MIXALL_DATA_URL`）から読みます。仕組みは kaikomziu/mixall の `server/archive-job.js` と `cloud/_lib/blobs.js`。
- 設定: Variables `MIXALL_API`, `MIXALL_DATA_URL` / Secret `MIXALL_ARCHIVE_JOB_SECRET`（Supabase の mixall-config/env と同じ値）。
- `data/` は手で消さないでください（Supabase からはもう消えています）。
