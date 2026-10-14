import {hashText,hashBlob,jsonBlob,checkAbort} from './backup-hash.js';
import {DriveError} from './drive-api.js';
const FOLDER='application/vnd.google-apps.folder';
export const driveFolderURL=id=>`https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;
// Only IDs and confirmed receipts are stored. Resumable URLs and tokens stay in memory.
export class DriveBackup{
 constructor({api,scope,readId,reserveId,saveReceipt}){Object.assign(this,{api,scope,readId,reserveId,saveReceipt});}
 async ensure(keyParts,name,parent,mimeType,signal){
  checkAbort(signal);const key=hashText(JSON.stringify(['psfl-drive-1',...keyParts])),storageKey=`drive-file-id-1:${this.scope}:${key}`;
  const found=await this.api.findKey(key,parent,signal),cached=await this.readId(storageKey),proposed=found?.id??cached??await this.api.generateId(signal);
  let id;try{id=await this.reserveId(storageKey,proposed);}catch{throw new DriveError('local-state','再試行用のファイルIDを端末に保存できません。アップロードを止めました。端末の空き容量を確認してください。');}
  return this.api.ensureMetadata({id,key,name,parent,mimeType},signal);
 }
 async save(plan,{signal,onProgress=()=>{}}={}){
  const {sessionId,snapshotId,files}=plan,receiptKey=`drive-backup-receipt-1:${this.scope}:${sessionId}:${snapshotId}`;
  const root=await this.ensure(['root'],'Personal Sports Form Lab',null,FOLDER,signal);
  const sessions=await this.ensure(['sessions'],'sessions',root.id,FOLDER,signal);
  const session=await this.ensure(['session',sessionId],sessionId,sessions.id,FOLDER,signal);
  const snapshot=await this.ensure(['snapshot',sessionId,snapshotId],`snapshot-${snapshotId.slice(0,16)}`,session.id,FOLDER,signal);
  const subfolders=new Map(),confirmed=[];let done=0,total=files.reduce((n,f)=>n+f.bytes,0);
  for(const [index,file]of files.entries()){
   checkAbort(signal);const [dir,name]=file.path.includes('/')?file.path.split('/'):[null,file.path];let parent=snapshot.id;
   if(dir){if(!subfolders.has(dir)){const folder=await this.ensure(['directory',sessionId,snapshotId,dir],dir,snapshot.id,FOLDER,signal);subfolders.set(dir,folder.id);}parent=subfolders.get(dir);}
   const row=await this.ensure(['artifact',sessionId,snapshotId,file.path],name,parent,file.mimeType,signal);
   const remote=await this.api.upload(row.id,file,{signal,onProgress:bytes=>onProgress({phase:'upload',file:file.path,index,totalFiles:files.length+1,done:done+bytes,total})});
   confirmed.push({path:file.path,mimeType:file.mimeType,driveFileId:remote.id,bytes:file.bytes,sha256:file.sha256,md5:file.md5,verified:true});done+=file.bytes;
  }
  // Commit marker last. Prior immutable snapshots are never replaced or deleted.
  const manifest={...plan.base,snapshotId,uploadState:'complete',files:confirmed},blob=jsonBlob(manifest),manifestFile={path:'metadata.json',mimeType:'application/json',makeBlob:async()=>blob,...await hashBlob(blob,{signal})};total+=manifestFile.bytes;
  const row=await this.ensure(['artifact',sessionId,snapshotId,'metadata.json'],'metadata.json',snapshot.id,manifestFile.mimeType,signal);
  await this.api.upload(row.id,manifestFile,{signal,onProgress:bytes=>onProgress({phase:'confirm',file:'metadata.json',index:files.length,totalFiles:files.length+1,done:done+bytes,total})});checkAbort(signal);
  const receipt={schema:'drive-backup-receipt-1',sessionId,snapshotId,folderId:snapshot.id,manifestId:row.id,files:confirmed,verifiedAt:Date.now(),complete:true};
  let localReceiptSaved=true;try{await this.saveReceipt(receiptKey,receipt);}catch{localReceiptSaved=false;}
  onProgress({phase:'complete',done:total,total});return {...receipt,localReceiptSaved,url:driveFolderURL(snapshot.id)};
 }
}
