// Prepare an isolated, reproducible static preview from a committed PR snapshot.
// Do not copy the working tree, .env, attachments, private work/ or existing dist/.
import {readFile,writeFile,mkdir,symlink,lstat,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const target=option('--target'),requested=option('--source')??'HEAD';
if(!target||!path.isAbsolute(target)||path.resolve(target)===root)throw new Error('別の絶対パスを --target で指定してください。');
const source=execFileSync('git',['rev-parse','--verify',`${requested}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
const manifest=JSON.parse(await readFile(path.join(target,'.openai/hosting.json'),'utf8'));
if(!manifest.project_id||manifest.static?.directory!=='dist')throw new Error('先に専用Site IDとstatic.directory=distを保存してください。');
const archive=execFileSync('git',['archive','--format=tar',source],{cwd:root,maxBuffer:64*1024*1024});
execFileSync('tar',['-xf','-','-C',target],{input:archive});
const storageFile=path.join(target,'src/storage.js'),storage=await readFile(storageFile,'utf8'),original="indexedDB.open('sports-form-lab', 5)";
if(storage.split(original).length!==2)throw new Error('保存先の置換対象が一致しません。安全のためビルドを停止しました。');
await writeFile(storageFile,storage.replace(original,"indexedDB.open('sports-form-lab-pr41-iphone-test', 5)"));
const driveFile=path.join(target,'src/drive-backup-ui.js'),drive=await readFile(driveFile,'utf8'),mount="export function mountDriveBackup(container,session,{onBusy=()=>{},hasDirty=()=>false,auth=driveAuth}={}){";
if(!drive.includes(mount))throw new Error('Drive送信停止の対象が一致しません。');
await writeFile(driveFile,drive.replace(mount,mount+"\n container.hidden=false;container.innerHTML='<section class=\"panel\"><h3>テスト版の保存</h3><p>このテスト環境ではGoogle Drive連携・送信を無効にしています。動画・骨格・レビューはテスト専用の端末内保存先に残ります。本番のDrive設定には触れません。</p></section>';return ()=>{};\n"));
const indexFile=path.join(target,'index.html');let index=await readFile(indexFile,'utf8');
const csp="default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' blob: data:; media-src 'self' blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";
index=index.replace('</head>',`<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${csp}"><link rel="stylesheet" href="./iphone-preview.css"></head>`).replace('<title>フォームノート | Sports Form Lab</title>','<title>PR41 テスト版 | Sports Form Lab</title>').replace('</body>','<script type="module" src="./iphone-preview.js"></script></body>');
await writeFile(indexFile,index);
const templates=path.join(root,'scripts/iphone-preview');
for(const name of ['iphone-preview.js','iphone-preview.css','iphone-test.html']){const data=await readFile(path.join(templates,name));await writeFile(path.join(target,'public',name),data);if(name!=='iphone-test.html')await writeFile(path.join(target,name),data);}
await writeFile(path.join(target,'public','robots.txt'),'User-agent: *\nDisallow: /\n');
await writeFile(path.join(target,'public','test-build.json'),JSON.stringify({profile:'pr41-iphone-isolated',sourceCommit:source,version:JSON.parse(await readFile(path.join(target,'package.json'),'utf8')).version,storageDatabase:'sports-form-lab-pr41-iphone-test',personalDataIncluded:false,driveUploadEnabled:false},null,2));
try{await lstat(path.join(target,'node_modules'));}catch{await symlink(path.join(root,'node_modules'),path.join(target,'node_modules'),'dir');}
execFileSync('npm',['run','build'],{cwd:target,stdio:'inherit'});
// No uploaded media, source maps, credentials, caches or analysis exports may ship.
async function inventory(dir,prefix=''){const rows=[];for(const f of await readdir(dir,{withFileTypes:true})){const relative=path.join(prefix,f.name);if(f.isDirectory())rows.push(...await inventory(path.join(dir,f.name),relative));else rows.push(relative);}return rows;}
const files=await inventory(path.join(target,'dist'));
const unexpected=files.filter(f=>/\.(?:mp4|mov|webm|m4v|jsonl|map)$/i.test(f)||/(?:shot-offline|shot-training|\.env|credential|token|attachments)/i.test(f));
if(unexpected.length)throw new Error(`公開不可のファイルを検出しました: ${unexpected.join(', ')}`);
const data=JSON.parse(await readFile(path.join(target,'dist/test-build.json'),'utf8'));
if(data.sourceCommit!==source||data.storageDatabase==='sports-form-lab')throw new Error('分離設定の確認に失敗しました。');
console.log(JSON.stringify({sourceCommit:source,projectId:manifest.project_id,target,staticFiles:files.length,privateMediaFiles:0,database:data.storageDatabase}));
