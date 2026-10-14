import {hashBlob} from '../src/backup-hash.js';
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
export class FakeDrive{
 constructor(){this.files=new Map();this.uploads=new Map();this.next=0;this.userId='test-user';this.history=[];this.onChunk=null;}
 async fetch(input,options={}){
  const url=new URL(input),method=options.method??'GET',headers=new Headers(options.headers),range=headers.get('Content-Range');
  this.history.push({path:url.pathname,method,range});if(options.signal?.aborted)throw new DOMException('abort','AbortError');
  if(this.authExpired)return json({error:{errors:[{reason:'authError'}]}},401);
  if(this.quota)return json({error:{errors:[{reason:'storageQuotaExceeded'}]}},403);
  if(this.rateOnce){this.rateOnce=false;return json({error:{errors:[{reason:'userRateLimitExceeded'}]}},403);}
  if(url.pathname==='/drive/v3/about')return json({user:{permissionId:this.userId,displayName:'Test User',emailAddress:this.userId+'@example.invalid'}});
  if(url.pathname.endsWith('/generateIds'))return json({ids:['id-'+ ++this.next]});
  if(url.pathname==='/drive/v3/files'&&method==='GET'){
   const q=url.searchParams.get('q'),key=/value='([^']+)'/.exec(q)?.[1],parent=/and '([^']+)' in parents/.exec(q)?.[1];return json({files:[...this.files.values()].filter(f=>f.ownerId===this.userId&&f.appProperties?.psflKey===key&&(!parent||f.parents?.includes(parent))&&!f.trashed).map(f=>this.metadata(f))});
  }
  if(url.pathname==='/drive/v3/files'&&method==='POST'){
   const data=JSON.parse(options.body);if(this.files.has(data.id))return json({},409);const file={...data,ownerId:this.userId,ownedByMe:true,shared:false,parents:data.parents??[],size:'0',blob:new Blob()};this.files.set(data.id,file);return json(this.metadata(file));
  }
  const match=/\/files\/([^/]+)$/.exec(url.pathname),id=match?.[1];
  if(method==='GET'&&id)return this.files.has(id)&&this.files.get(id).ownerId===this.userId?json(this.metadata(this.files.get(id))):json({},404);
  if(method==='PATCH'&&url.pathname.startsWith('/upload/')){
   const uri=`https://www.googleapis.com/upload/drive/v3/files/${id}?upload_id=upload-${this.uploads.size+1}`;this.uploads.set(uri,{id,parts:[],offset:0,size:Number(headers.get('X-Upload-Content-Length')),done:false});return new Response('',{status:200,headers:{Location:uri}});
  }
  if(method==='PUT'){
   const upload=this.uploads.get(url.href);if(!upload)return json({},404);
   if(this.expireOnce){this.expireOnce=false;this.uploads.delete(url.href);return json({},404);}
   if(range.startsWith('bytes */'))return upload.done?json(this.metadata(this.files.get(upload.id))):new Response(null,{status:308,headers:upload.offset?{Range:`bytes=0-${upload.offset-1}`}:{}});
   const parsed=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);if(!parsed||Number(parsed[1])!==upload.offset)return json({},400);
   const data=new Uint8Array(await options.body.arrayBuffer());upload.parts.push(data);upload.offset+=data.length;this.onChunk?.(upload);
   if(upload.offset===upload.size){upload.done=true;const file=this.files.get(upload.id);file.blob=new Blob(upload.parts);file.size=String(file.blob.size);Object.assign(file,await hashBlob(file.blob));file.sha256Checksum=file.sha256;file.md5Checksum=file.md5;}
   if(this.dropResponseOnce){this.dropResponseOnce=false;throw new TypeError('synthetic offline');}
   if(options.signal?.aborted)throw new DOMException('abort','AbortError');
   return upload.done?json(this.metadata(this.files.get(upload.id))):new Response(null,{status:308,headers:{Range:`bytes=0-${upload.offset-1}`}});
  }
  throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
 }
 metadata(f){const {blob,sha256,md5,bytes,ownerId,...rest}=f;return {...rest,ownedByMe:rest.ownedByMe&&ownerId===this.userId};}
}
