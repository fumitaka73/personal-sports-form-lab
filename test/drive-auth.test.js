import test from 'node:test';import assert from 'node:assert/strict';
import {DriveAuth,DRIVE_SCOPE,validClientId} from '../src/drive-auth.js';
function harness(){let config,requested=0,revoke;const sdk={initTokenClient(c){config=c;return {requestAccessToken(){requested++;}};},hasGrantedAllScopes:(r,scope)=>r.scope===scope,revoke(token,cb){revoke=token;cb({successful:true});}};const auth=new DriveAuth({loadSDK:async()=>sdk,now:()=>1000});return {auth,sdk,get config(){return config;},get requested(){return requested;},get revoke(){return revoke;}};}
test('GIS request is synchronous with tap, drive.file only; tokens are not serialized to settings',async()=>{
 const h=harness();await h.auth.prepare('123-test.apps.googleusercontent.com');const p=h.auth.connect();assert.equal(h.requested,1);assert.equal(h.config.scope,DRIVE_SCOPE);assert.equal(h.config.include_granted_scopes,false);
 h.config.callback({access_token:'synthetic-token',scope:DRIVE_SCOPE,expires_in:3600});await p;h.auth.setAccount({permissionId:'user',displayName:'test'});assert.equal(h.auth.connected,true);assert.equal(h.auth.getToken(),'synthetic-token');assert.equal(await h.auth.disconnect(),true);assert.equal(h.revoke,'synthetic-token');assert.equal(h.auth.connected,false);
});
test('denial, popup close, invalid setup and expiry do not produce connected state',async()=>{
 const h=harness();assert.equal(validClientId('client-secret'),false);await assert.rejects(h.auth.prepare('client-secret'),/Client ID/);await h.auth.prepare('123-test.apps.googleusercontent.com');
 let p=h.auth.connect();h.config.callback({error:'access_denied'});await assert.rejects(p,/許可/);assert.equal(h.auth.connected,false);
 p=h.auth.connect();h.config.error_callback({type:'popup_closed'});await assert.rejects(p,/閉じられ/);
 p=h.auth.connect();h.config.callback({error:'origin_mismatch'});await assert.rejects(p,/オリジン/);
 p=h.auth.connect();h.config.callback({access_token:'synthetic-token',scope:DRIVE_SCOPE,expires_in:1});await p;assert.throws(()=>h.auth.getToken(),/期限/);assert.equal(h.auth.token,null);
});
test('configuration cannot change during account consent',async()=>{const h=harness();await h.auth.prepare('123-test.apps.googleusercontent.com');const p=h.auth.connect();await assert.rejects(h.auth.prepare('456-test.apps.googleusercontent.com'),/閉じて/);h.config.error_callback({});await assert.rejects(p);});
