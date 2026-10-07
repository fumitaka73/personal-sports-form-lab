import './style.css';
import { listVideos, saveVideo, deleteVideo } from './storage.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <header><a class="brand" href="./"><span class="brand-mark">↗</span> SPORTS FORM LAB</a><span class="header-label">自分の動きを、少しずつ。</span></header>
  <main>
    <section class="intro"><div><p class="eyebrow">YOUR PERSONAL TRAINING JOURNAL</p><h1>振り返りが、<br>次の一歩になる。</h1><p class="lead">フォームを記録して、気づきを残す。<br>あなただけの練習ノート。</p></div><div class="intro-aside"><span class="circle">↗</span><p>RECORD. REFLECT. IMPROVE.</p></div></section>
    <section class="workspace" aria-label="フォーム動画とメモ">
      <aside class="library"><div class="section-heading"><h2>フォームノート</h2><span id="count">0 本</span></div>
      <label class="upload" id="upload-label" for="upload"><span>＋</span> 動画を追加<input id="upload" type="file" accept="video/*" multiple></label>
      <p class="upload-hint">MP4 / MOV / WebM · 1本あたり200MBまで</p><div id="video-list"></div></aside>
      <section class="detail" id="detail"></section>
    </section>
    <p id="status" role="status" aria-live="polite"></p>
    <footer><span>映像も、気づきも、あなたの手元に。</span><span>動画とメモはこのブラウザに保存されます。外部送信はありません。<br>ブラウザのデータを削除すると、記録も消えます。</span></footer>
  </main>`;
const detail = document.querySelector('#detail');
const list = document.querySelector('#video-list');
const input = document.querySelector('#upload');
const status = document.querySelector('#status');
let videos = [];
let selected = null;
let objectUrl = null;
let dirty = false;
let busy = false;
const date = value => new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
function message(text, error = false) { status.textContent = text; status.classList.toggle('error', error); }
function releaseUrl() { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; }
function allowNavigation() { return !dirty || window.confirm('未保存のメモがあります。変更を破棄しますか？'); }
function renderList() {
  document.querySelector('#count').textContent = `${videos.length} 本`;
  list.replaceChildren();
  for (const video of videos) {
    const button = document.createElement('button');
    button.className = `video-item${video.id === selected ? ' active' : ''}`;
    button.setAttribute('aria-pressed', String(video.id === selected));
    const icon = document.createElement('span'); icon.className = 'video-icon'; icon.textContent = '▷';
    const text = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = video.title;
    const meta = document.createElement('small'); meta.textContent = `${date(video.createdAt)} · ${(video.blob.size / 1024 / 1024).toFixed(1)} MB`;
    text.append(name, meta); button.append(icon, text);
    button.addEventListener('click', () => {
      if (busy || selected === video.id || !allowNavigation()) return;
      selected = video.id; renderList(); renderDetail();
    });
    list.append(button);
  }
}
function renderDetail() {
  releaseUrl(); dirty = false;
  const video = videos.find(item => item.id === selected);
  if (!video) {
    detail.innerHTML = `<div class="empty"><span class="empty-icon">▷</span><p class="eyebrow">START WITH ONE VIDEO</p><h2>今日のフォームを、残そう。</h2><p>練習動画を追加すると、ここで再生して<br>気づいたことをメモできます。</p><button class="primary" id="first-upload">最初の動画を追加 ＋</button></div>`;
    document.querySelector('#first-upload').onclick = () => input.click(); return;
  }
  detail.innerHTML = `<div class="detail-heading"><div><p class="eyebrow">TRAINING RECORD</p><h2 id="video-title"></h2><p id="record-date"></p></div><button class="delete" id="delete">削除</button></div>
    <video id="player" controls playsinline preload="metadata"></video><p class="playback-error" id="playback-error" role="alert" hidden>このブラウザでは動画を再生できません。MP4（H.264）またはWebM形式の動画をお試しください。</p>
    <form id="notes-form"><div class="note-heading"><label for="notes">フォームのメモ</label><span id="save-state">保存済み</span></div><textarea id="notes" rows="6" placeholder="よかった動き、気になるクセ、次の練習で意識すること…"></textarea><div class="note-bottom"><span>小さな気づきを、次の練習へ。</span><button class="primary" id="save" type="submit">メモを保存</button></div></form>`;
  document.querySelector('#video-title').textContent = video.title;
  document.querySelector('#record-date').textContent = `${date(video.createdAt)} に追加`;
  objectUrl = URL.createObjectURL(video.blob);
  const player = document.querySelector('#player'); player.src = objectUrl;
  player.onerror = () => document.querySelector('#playback-error').hidden = false;
  const notes = document.querySelector('#notes'); notes.value = video.notes;
  notes.oninput = () => { dirty = notes.value !== video.notes; document.querySelector('#save-state').textContent = dirty ? '未保存' : '保存済み'; };
  document.querySelector('#notes-form').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; const saveButton = document.querySelector('#save'); saveButton.disabled = true;
    const updated = { ...video, notes: notes.value, updatedAt: Date.now() };
    try {
      await saveVideo(updated); Object.assign(video, updated);
      dirty = notes.value !== video.notes;
      document.querySelector('#save-state').textContent = dirty ? '未保存' : '保存済み'; message('メモを保存しました。');
    } catch { message('メモを保存できませんでした。ブラウザの空き容量や保存設定をご確認ください。', true); }
    finally { busy = false; saveButton.disabled = false; }
  };
  document.querySelector('#delete').onclick = async () => {
    if (busy || !window.confirm('この動画とメモを削除しますか？この操作は取り消せません。')) return;
    busy = true;
    try {
      await deleteVideo(video.id); videos = videos.filter(item => item.id !== video.id);
      selected = videos[0]?.id ?? null; renderList(); renderDetail(); message('動画とメモを削除しました。');
    } catch { message('削除できませんでした。もう一度お試しください。', true); }
    finally { busy = false; }
  };
}
input.onchange = async () => {
  const files = [...input.files]; input.value = '';
  if (!files.length || busy || !allowNavigation()) return;
  busy = true; input.disabled = true;
  let added = 0; let firstAdded; const errors = [];
  try {
    for (const file of files) {
      if (!file.type.startsWith('video/') || file.size === 0) { errors.push(`${file.name}: 有効な動画を選んでください。`); continue; }
      if (file.size > 200 * 1024 * 1024) { errors.push(`${file.name}: 200MB以下の動画を選んでください。`); continue; }
      const video = { id: crypto.randomUUID(), title: file.name, blob: file, notes: '', createdAt: Date.now() };
      try { await saveVideo(video); videos.unshift(video); firstAdded ??= video.id; added++; }
      catch { errors.push(`${file.name}: 保存できませんでした。ブラウザの空き容量や保存設定をご確認ください。`); }
    }
    if (added) { selected = firstAdded; renderList(); renderDetail(); }
    message([added ? `${added}本の動画を追加しました。` : '', ...errors].filter(Boolean).join(' '), errors.length > 0);
  } finally { busy = false; input.disabled = false; }
};
window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', releaseUrl);
try {
  videos = (await listVideos()).sort((a, b) => b.createdAt - a.createdAt);
  selected = videos[0]?.id ?? null; renderList(); renderDetail();
} catch {
  input.disabled = true;
  detail.innerHTML = '<div class="empty"><h2>ブラウザの保存機能を利用できません</h2><p>通常のブラウザウィンドウで開き直すか、<br>サイトのデータ保存設定をご確認ください。</p></div>';
  message('保存機能の初期化に失敗しました。', true);
}
