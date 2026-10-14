import {checkAbort} from './backup-hash.js';
export const DRIVE_BASE='https://www.googleapis.com';
export const DRIVE_FILE_FIELDS='id,name,mimeType,size,sha256Checksum,md5Checksum,appProperties,parents,trashed,ownedByMe,shared';
export class DriveError extends Error{constructor(code,message,status=0){super(message);this.code=code;this.status=status;}}
export async function responseError(response){
 let reason;try{const body=await response.json();reason=body.error?.errors?.[0]?.reason;}catch{/* Never surface raw server bodies or headers. */}
 if(response.status===401)return new DriveError('auth','Googleの認証期限が切れました。再連携して再試行してください。',401);
 if(reason==='storageQuotaExceeded')return new DriveError('quota','Google Driveの空き容量が不足しています。Driveの容量を確認してください。端末の練習データは残っています。',response.status);
 if(response.status===429||['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded'].includes(reason))return new DriveError('rate','Google Driveの利用制限に達しました。時間をおいて再試行してください。',response.status);
 if(reason==='accessNotConfigured')return new DriveError('config','Google CloudでGoogle Drive APIを有効にしてください。',response.status);
 if(response.status===403)return new DriveError('permission','Driveへの保存が許可されていません。連携の許可・Google Cloudの設定を確認してください。',403);
 return new DriveError(response.status>=500?'network':'api',response.status>=500?'Google Driveで一時的な通信エラーが起きました。再試行してください。':`Google Driveへの保存を確認できません（HTTP ${response.status}）。再試行してください。`,response.status);
}
const wait=(ms,signal)=>new Promise((resolve,reject)=>{checkAbort(signal);const abort=()=>{clearTimeout(timer);reject(new DOMException('中断','AbortError'));},timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});
export class DriveAPI{
 constructor({token,fetcher=globalThis.fetch?.bind(globalThis),timeout=30000,sleep=wait}={}){this.token=token;this.fetcher=fetcher;this.timeout=timeout;this.sleep=sleep;this.uploads=new Map();}
 async request(path,{signal,allow=[],...options}={}){
  checkAbort(signal);const url=path.startsWith('https:')?new URL(path):new URL(path,DRIVE_BASE);
  if(url.origin!==DRIVE_BASE||!/^\/(?:upload\/)?drive\/v3\//.test(url.pathname))throw new DriveError('endpoint','Google Driveの送信先を確認できません。');
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,this.timeout);
  try{const response=await this.fetcher(url.href,{...options,signal:controller.signal,headers:{...options.headers,Authorization:`Bearer ${this.token()}`},redirect:'error',cache:'no-store',credentials:'omit'});if(!response.ok&&!allow.includes(response.status))throw await responseError(response);return response;}
  catch(error){if(signal?.aborted)throw new DOMException('中断','AbortError');if(error instanceof DriveError||error.code==='auth')throw error;throw new DriveError('network','通信が途切れたか時間がかかっています。送信済みのデータは保持し、再試行できます。');}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 }
 async account(signal){return (await (await this.request('/drive/v3/about?fields=user(permissionId,displayName,emailAddress)',{signal})).json()).user;}
 async getFile(id,signal){const r=await this.request(`/drive/v3/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,{signal,allow:[404]});return r.status===404?null:r.json();}
 async generateId(signal){const r=await this.request('/drive/v3/files/generateIds?count=1&space=drive&type=files',{signal});const id=(await r.json()).ids?.[0];if(!/^[a-zA-Z0-9_-]+$/.test(id??''))throw new DriveError('protocol','Googleから保存先IDを取得できませんでした。');return id;}
 async findKey(key,parent,signal){
  if(!/^[a-f0-9]{64}$/.test(key))throw new DriveError('key','保存先の識別子が不正です。');
  if(parent&&!/^[a-zA-Z0-9_-]+$/.test(parent))throw new DriveError('key','保存先のフォルダIDが不正です。');
  const q=`trashed = false and 'me' in owners and appProperties has { key='psflKey' and value='${key}' }${parent?` and '${parent}' in parents`:''}`;
  const params=new URLSearchParams({q,spaces:'drive',fields:`files(${DRIVE_FILE_FIELDS}),nextPageToken`,pageSize:'100'});const r=await this.request('/drive/v3/files?'+params,{signal});const data=await r.json();if(data.nextPageToken)throw new DriveError('duplicates','保存先の候補が多すぎます。Driveの専用フォルダを確認してください。');return data.files?.[0]??null;
 }
 async ensureMetadata({id,key,name,parent,mimeType},signal){
  if(!/^[a-zA-Z0-9_-]+$/.test(id??''))throw new DriveError('key','保存先IDが不正です。');let file=await this.getFile(id,signal);
  if(!file){const r=await this.request('/drive/v3/files?fields='+encodeURIComponent(DRIVE_FILE_FIELDS),{signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,mimeType,...(parent?{parents:[parent]}:{}),appProperties:{psflKey:key,psflSchema:'1'}}),allow:[409]});file=r.status===409?await this.getFile(id,signal):await r.json();}
  if(!file||file.trashed||file.ownedByMe===false||file.shared===true||file.appProperties?.psflKey!==key||file.mimeType!==mimeType||file.name!==name||(parent&&!file.parents?.includes(parent)))throw new DriveError('conflict','Driveの保存先が削除・移動・共有・変更されているか、本人所有ではありません。既存ファイルは上書きしません。Driveで確認してください。');return file;
 }
 verified(remote,file){return !!remote&&!remote.trashed&&Number(remote.size)===file.bytes&&(remote.sha256Checksum?remote.sha256Checksum===file.sha256:!!remote.md5Checksum&&remote.md5Checksum===file.md5);}
 async verify(id,file,signal){
  for(let n=0;n<3;n++){const remote=await this.getFile(id,signal);if(this.verified(remote,file))return remote;if(n<2)await this.sleep(400*(n+1),signal);}throw new DriveError('verification','Drive上のサイズ・チェックサムを確認できません。完了扱いにせず、再試行してください。');
 }
 async upload(id,file,{signal,onProgress=()=>{}}={}){
  const blob=await file.makeBlob();if(blob.size!==file.bytes)throw new DriveError('changed','端末の保存対象が変更されました。選び直してください。');
  const existing=await this.getFile(id,signal);if(this.verified(existing,file)){onProgress(file.bytes,file.bytes);return existing;}
  // Do not replace a non-empty file altered by the user or another application.
  if(Number(existing?.size)>0)throw new DriveError('conflict','Drive上の保存内容が変更されています。既存データを上書きせず停止しました。');
  let uri=this.uploads.get(id),offset=0,restarts=0,retries=0;
  const query=async()=>{
   const r=await this.request(uri,{signal,method:'PUT',headers:{'Content-Range':`bytes */${blob.size}`},allow:[308,404]});
   if(r.status===404)return {expired:true};if(r.ok)return {complete:true};return {offset:this.received(r,blob.size)};
  };
  while(true){checkAbort(signal);
   if(!uri){const latest=await this.getFile(id,signal);if(this.verified(latest,file)){onProgress(file.bytes,file.bytes);return latest;}if(Number(latest?.size)>0||latest?.shared===true||latest?.ownedByMe===false)throw new DriveError('conflict','Drive上の保存内容・共有状態が変更されています。上書きせず停止しました。');const r=await this.request(`/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=resumable&fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`,{signal,method:'PATCH',headers:{'Content-Type':'application/json','X-Upload-Content-Type':file.mimeType,'X-Upload-Content-Length':String(blob.size)},body:'{}'});uri=r.headers.get('Location');if(!uri)throw new DriveError('protocol','Googleから分割送信の開始先が返りませんでした。ブラウザの通信設定を確認してください。');this.uploads.set(id,uri);offset=0;}
   try{
    const status=await query();if(status.complete){this.uploads.delete(id);return this.verify(id,file,signal);}if(status.expired){this.uploads.delete(id);uri=null;if(++restarts>2)throw new DriveError('network','分割送信の期限が切れました。再試行してください。');continue;}offset=status.offset;onProgress(offset,blob.size);
    while(offset<blob.size){checkAbort(signal);const end=Math.min(offset+1024*1024,blob.size),r=await this.request(uri,{signal,method:'PUT',headers:{'Content-Type':file.mimeType,'Content-Range':`bytes ${offset}-${end-1}/${blob.size}`},body:blob.slice(offset,end),allow:[308,404]});
     if(r.status===404){this.uploads.delete(id);uri=null;if(++restarts>2)throw new DriveError('network','分割送信が期限切れです。再試行してください。');break;}
     if(r.ok){this.uploads.delete(id);const remote=await this.verify(id,file,signal);onProgress(file.bytes,file.bytes);return remote;}
     const next=this.received(r,blob.size);if(next<=offset||next>end)throw new DriveError('protocol','Googleから受信済みの範囲を確認できませんでした。再試行してください。');offset=next;onProgress(offset,blob.size);
    }
    if(uri&&offset===blob.size){const remote=await this.verify(id,file,signal);this.uploads.delete(id);return remote;}
   }catch(error){if(signal?.aborted)throw error;if(['network','rate'].includes(error.code)&&retries++<2){await this.sleep(500*2**retries,signal);continue;}throw error;}
  }
 }
 received(response,size){const range=response.headers.get('Range');if(!range)return 0;const match=/^bytes=0-(\d+)$/.exec(range);if(!match||Number(match[1])+1>size)throw new DriveError('protocol','Googleの受信範囲が不正です。');return Number(match[1])+1;}
}
