// scripts/archive.mjs
// MixAll +（二世代）のデータを Supabase から GitHub（このリポジトリの data/）へ移す。GitHub Actions が毎日動かす。
//   node scripts/archive.mjs export  … Supabase のしばらく更新されていない行を暗号化して data/ に書く（削除済みのキーは消す）
//   node scripts/archive.mjs purge   … GitHub Pages に公開された内容と同じことを確かめた行だけ Supabase から消す
// 中身はサーバー（mixall-api の archive-job）が暗号化するので、ここには鍵は無い。
// 環境変数: MIXALL_API（mixall-api のURL）, MIXALL_ARCHIVE_JOB_SECRET, MIXALL_DATA_URL（このリポジトリの Pages のURL）
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const API = String(process.env.MIXALL_API || '').replace(/\/+$/, '');
const SECRET = process.env.MIXALL_ARCHIVE_JOB_SECRET || '';
const DATA_URL = String(process.env.MIXALL_DATA_URL || '').replace(/\/+$/, '');
if (!API || !SECRET || !DATA_URL) {
  console.error('MIXALL_API / MIXALL_ARCHIVE_JOB_SECRET / MIXALL_DATA_URL が未設定です');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(action, body = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const res = await fetch(`${API}/archive-job`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-archive-secret': SECRET },
        body: JSON.stringify({ action, ...body }),
        signal: AbortSignal.timeout(140_000)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${data.error || ''}`);
      return data;
    } catch (e) {
      if (attempt >= 4) throw new Error(`${action} ${body.store || ''}: ${e.message}`);
      await sleep(attempt * 5000);
    }
  }
}

const dirOf = (store) => join('data', store);
const indexPath = (store) => join(dirOf(store), '_index.json');

async function exportAll() {
  const { stores } = await call('stores');
  let changed = 0, errors = 0;
  for (const store of stores) {
    const added = [], removed = [];
    // 途中で失敗しても、そこまでに書けた分は索引に載せて残す（続きは次の日）
    try {
      let after = '';
      for (;;) {
        const page = await call('export', { store, after });
        for (const f of page.files) {
          mkdirSync(dirOf(store), { recursive: true });
          writeFileSync(join(dirOf(store), `${f.name}.json`), JSON.stringify(f.box));
          added.push(f.key);
        }
        if (page.done || !page.next) break;
        after = page.next;
      }
      const { tombs } = await call('tombs', { store });
      for (const t of tombs) {
        const file = join(dirOf(store), `${t.name}.json`);
        if (existsSync(file)) { rmSync(file); removed.push(t.key); }
      }
    } catch (e) {
      console.error(`${store}: ${e.message}`);
      errors += 1;
    }
    if (!added.length && !removed.length) continue;
    const existing = existsSync(indexPath(store)) ? JSON.parse(readFileSync(indexPath(store), 'utf8')) : null;
    const idx = await call('index', { store, existing, add: added, remove: removed });
    mkdirSync(dirOf(store), { recursive: true });
    writeFileSync(indexPath(store), JSON.stringify(idx.box));
    console.log(`${store}: +${added.length} -${removed.length} (計 ${idx.count})`);
    changed += 1;
  }
  console.log(changed ? `${changed} ストアを更新` : '書き出すものはありません');
  if (errors) console.log(`::warning::${errors} ストアで書き出しが途中で止まりました（次の日に続きから）`);
}

// 公開された索引が手元と同じになるまで待つ（GitHub Pages の CDN は最大10分キャッシュする。
// サイトの読み取りはキャッシュ越しなので、古い索引のまま Supabase から消すと一時的に読めなくなる）
async function waitLive(store, deadline) {
  const want = readFileSync(indexPath(store), 'utf8').trim();
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${DATA_URL}/data/${encodeURIComponent(store)}/_index.json`, { cache: 'no-store' });
      if (res.ok && (await res.text()).trim() === want) return true;
    } catch (_) {}
    await sleep(30_000);
  }
  return false;
}

async function purgeAll() {
  const { stores } = await call('stores');
  const deadline = Date.now() + 25 * 60_000;
  let total = 0;
  for (const store of stores) {
    if (!existsSync(indexPath(store))) continue;
    if (!(await waitLive(store, deadline))) { console.log(`${store}: 公開がまだなので今回は消さない`); continue; }
    let after = '', deleted = 0, failed = 0;
    for (;;) {
      const r = await call('purge', { store, after });
      deleted += r.deleted || 0; failed += r.failed || 0;
      if (r.done || !r.next) break;
      after = r.next;
    }
    const { removed } = await call('purgeTombs', { store });
    if (deleted || failed || removed) console.log(`${store}: Supabaseから削除 ${deleted} / そのまま ${failed} / 削除記録の片付け ${removed}`);
    total += deleted;
  }
  console.log(`合計 ${total} 件を Supabase から削除`);
}

const mode = process.argv[2];
if (mode === 'export') await exportAll();
else if (mode === 'purge') await purgeAll();
else { console.error('usage: node scripts/archive.mjs export|purge'); process.exit(1); }
