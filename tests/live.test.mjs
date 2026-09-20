import test from 'node:test';
import assert from 'node:assert/strict';
import {canWatch,fresh,publicSession,validEndpoint,playbackToken} from '../supabase/functions/openvideo-live/core.mjs';

const session={id:'stream',owner_id:'owner',channel_id:'channel',access:'subscribers',state:'live',heartbeat_at:new Date().toISOString()};
test('subscriber access is bound to user, channel and an unexpired entitlement',()=>{
 assert.equal(canWatch(session,null,null),false);
 assert.equal(canWatch(session,'viewer',null),false);
 assert.equal(canWatch(session,'owner',null),true);
 const sub={user_id:'viewer',channel_id:'channel',expires_at:new Date(Date.now()+60000).toISOString()};
 assert.equal(canWatch(session,'viewer',sub),true);
 assert.equal(canWatch(session,'stranger',sub),false);
 assert.equal(canWatch({...session,channel_id:'other'},'viewer',sub),false);
 assert.equal(canWatch(session,'viewer',{...sub,expires_at:'2000-01-01'}),false);
 assert.equal(canWatch({...session,access:'public'},null,null),true);
});
test('stale broadcasts are never advertised as live',()=>{
 assert.equal(fresh(session),true);
 assert.equal(fresh({...session,heartbeat_at:new Date(Date.now()-61000).toISOString()}),false);
 assert.equal(fresh({...session,state:'ended'}),false);
 assert.equal(fresh({...session,ended_at:new Date().toISOString()}),false);
});
test('public discovery strips all credentials and owner identifiers',()=>{
 const result=publicSession({...session,input_uid:'secret',whip:'secret',resource_url:'secret'}, {name:'Creator'});
 for(const field of ['input_uid','whip','resource_url','owner_id'])assert.equal(field in result,false);
});
test('only configured HTTPS Cloudflare endpoints are accepted',()=>{
 const host='customer-test.cloudflarestream.com';
 assert.equal(validEndpoint(`https://${host}/secret/webRTC/publish`,host,'publish'),true);
 assert.equal(validEndpoint(`http://${host}/secret/webRTC/publish`,host,'publish'),false);
 assert.equal(validEndpoint('https://evil.invalid/webRTC/publish',host,'publish'),false);
 assert.equal(validEndpoint(`https://${host}/id/webRTC/play`,host,'publish'),false);
});
test('WHEP tokens carry live input, key and a one-minute expiry with a valid signature',async()=>{
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=btoa(JSON.stringify(await crypto.subtle.exportKey('jwk',keys.privateKey)));
 const token=await playbackToken({jwk,keyId:'key',inputUid:'input'});
 const [h,p,s]=token.split('.');const claims=JSON.parse(Buffer.from(p,'base64url'));
 assert.equal(claims.sub,'input');assert.equal(claims.kid,'key');
 assert.ok(claims.exp*1000>Date.now()&&claims.exp*1000<=Date.now()+60000);
 assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5',keys.publicKey,Buffer.from(s,'base64url'),new TextEncoder().encode(h+'.'+p)));
});
