const pages={good:['基準フォーム','◇','基準フォーム'],coach:['練習する','◎','練習する'],review:['シュートの確認','▷','シュートの確認'],calibration:['AIの改善','↗','AIの改善']};
export function appShell(version){
 return `<header class="app-header"><div><span class="app-name">SPORTS FORM LAB</span><h1 id="page-title">基準フォーム</h1></div><span class="app-version" aria-label="アプリのバージョン ${version}">v${version}</span><details class="other-menu"><summary aria-label="その他の機能">•••</summary><div class="more-sheet"><h2>その他の機能</h2><button data-page="progress">成長の記録</button><button data-page="history" aria-label="履歴">練習の履歴・レポート</button><button data-page="analyze">1本の動画を分析</button><button data-page="session">練習動画をまとめて分析</button><button data-page="library">保存済み動画・メモ</button><p>記録はこのブラウザに保存されます。サイトデータを消すと記録も消えます。</p></div></details></header><main class="app-main"><p id="status" role="status" aria-live="polite"></p><section id="screen" aria-labelledby="page-title"></section></main><nav class="tabs app-nav" aria-label="主要画面">${Object.entries(pages).map(([id,[title,icon,label]])=>`<button data-page="${id}" aria-label="${label}"><span aria-hidden="true">${icon}</span><small>${title}</small></button>`).join('')}</nav>`;
}
export function updateShell(page){
 const title=pages[page]?.[0]??({'good-management':'基準フォームの管理',history:'練習の履歴',progress:'成長の記録',session:'動画の一括分析',analyze:'1本の動画を分析',results:'分析結果',library:'保存済み動画・メモ'}[page]??'フォームラボ');
 document.querySelector('#page-title').textContent=title;document.querySelector('#screen').dataset.view=page;
}
export function bindShell(){
 const more=document.querySelector('.other-menu');
 const close=()=>{if(more.open){more.open=false;more.querySelector('summary').focus();}};
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 document.addEventListener('pointerdown',e=>{if(more.open&&!more.contains(e.target))more.open=false;});
 more.addEventListener('toggle',()=>{if(more.open)more.querySelector('button').focus();});
}
