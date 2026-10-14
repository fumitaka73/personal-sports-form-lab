export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
export const validClientId=id=>/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(id);
let sdkPromise;
export function loadGoogleIdentity(){
 if(globalThis.google?.accounts?.oauth2)return Promise.resolve(globalThis.google.accounts.oauth2);
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;script.defer=true;
  const timeout=setTimeout(()=>{script.remove();sdkPromise=null;reject(new Error('Googleの連携機能を読み込めません。通信を確認し、再試行してください。'));},20000);
  script.onload=()=>{clearTimeout(timeout);if(globalThis.google?.accounts?.oauth2)resolve(globalThis.google.accounts.oauth2);else{sdkPromise=null;reject(new Error('Googleの連携機能を利用できません。'));}};
  script.onerror=()=>{clearTimeout(timeout);script.remove();sdkPromise=null;reject(new Error('Googleの連携機能を読み込めません。通信・コンテンツブロッカーを確認してください。'));};document.head.append(script);
 });return sdkPromise;
}
// Tokens exist only in this tab's memory. No refresh token or client secret.
export class DriveAuth{
 constructor({loadSDK=loadGoogleIdentity,now=()=>Date.now()}={}){this.loadSDK=loadSDK;this.now=now;this.clear();this.client=null;this.pending=null;}
 clear(){this.token=null;this.expiresAt=0;this.account=null;}
 get connected(){return !!this.account&&!!this.token&&this.expiresAt>this.now()+30000;}
 getToken(){if(!this.token||this.expiresAt<=this.now()+30000){this.clear();throw Object.assign(new Error('Googleの認証期限が切れました。「Googleアカウントと連携」で再接続してから再試行してください。'),{code:'auth'});}return this.token;}
 async prepare(clientId){
  if(this.pending)throw new Error('Googleの連携画面を閉じてから設定を変更してください。');
  if(!validClientId(clientId))throw new Error('Google CloudのOAuth Client IDを入力してください。Client Secretは入力しません。');
  if(this.clientId===clientId&&this.client)return;
  const generation=(this.generation??0)+1;this.generation=generation;this.clear();this.client=null;this.clientId=clientId;this.sdk=await this.loadSDK();if(generation!==this.generation)throw new Error('連携設定が変更されました。もう一度設定してください。');
  this.client=this.sdk.initTokenClient({client_id:clientId,scope:DRIVE_SCOPE,include_granted_scopes:false,
   callback:r=>{const pending=this.pending;this.pending=null;if(!pending)return;
    if(['invalid_client','origin_mismatch','invalid_scope','unauthorized_client'].includes(r.error)){this.clear();pending.reject(new Error('Google CloudのOAuth Client ID・承認済みJavaScriptオリジン・Driveスコープを確認してください。'));return;}
    if(r.error||!r.access_token||!this.sdk.hasGrantedAllScopes(r,DRIVE_SCOPE)){this.clear();pending.reject(new Error('Driveへのアクセスが許可されませんでした。アカウントと許可項目を確認してください。'));return;}
    this.token=r.access_token;this.expiresAt=this.now()+Number(r.expires_in??3600)*1000;pending.resolve();
   },error_callback:()=>{const p=this.pending;this.pending=null;p?.reject(new Error('Googleの連携画面が開けないか、閉じられました。Safariでポップアップを許可して再試行してください。'));}});
 }
 // Called directly from a button tap, before any await or database access.
 connect(){if(!this.client)return Promise.reject(new Error('Client IDを保存し、連携機能の読み込み完了を待ってください。'));if(this.pending)return Promise.reject(new Error('Googleの連携操作を完了してください。'));this.clear();return new Promise((resolve,reject)=>{this.pending={resolve,reject};try{this.client.requestAccessToken({prompt:'select_account'});}catch{this.pending=null;reject(new Error('Googleの連携画面を開けません。Safariのポップアップ設定を確認してください。'));}});}
 setAccount(account){if(!account?.permissionId)throw new Error('保存先のGoogleアカウントを確認できませんでした。');this.account={id:account.permissionId,name:account.displayName??'Googleアカウント',email:account.emailAddress??null};}
 async disconnect(){
  const token=this.token;this.clear();if(!token||!this.sdk)return false;
  return new Promise(resolve=>{const timer=setTimeout(()=>resolve(false),10000);try{this.sdk.revoke(token,r=>{clearTimeout(timer);resolve(!!r?.successful);});}catch{clearTimeout(timer);resolve(false);}});
 }
}
export const driveAuth=new DriveAuth();
