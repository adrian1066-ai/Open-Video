import test from 'node:test';
import assert from 'node:assert/strict';
let handler;
globalThis.Deno={env:{get:key=>key==='SUPABASE_URL'?'https://database.test':'service-secret'},serve:fn=>{handler=fn;}};
await import('../supabase/functions/openvideo-live/index.ts');
const uid='11111111-1111-4111-8111-111111111111';
const liveId='22222222-2222-4222-8222-222222222222';
const guest='33333333-3333-4333-8333-333333333333';
const channel='44444444-4444-4444-8444-444444444444';
const session={id:liveId,owner_id:uid,channel_id:channel,input_uid:'input',access:'subscribers',state:'live',heartbeat_at:new Date().toISOString(),replay_state:'recording'};
function mock({user=null,live=session,subscription=[],other={}}={}){
 const calls=[];
 globalThis.fetch=async(url,opts={})=>{
  const u=new URL(url);calls.push({path:u.pathname,method:opts.method||'GET',body:opts.body});
  if(u.pathname==='/auth/v1/user')return Response.json(user||{error:'Invalid JWT'},{status:user?200:401});
  if(u.pathname==='/rest/v1/live_sessions')return Response.json([live]);
  if(u.pathname==='/rest/v1/live_subscriptions')return Response.json(subscription);
  if(u.pathname in other)return Response.json(other[u.pathname]);
  throw Error('Unexpected privileged request: '+u.pathname);
 };
 return calls;
}
async function request(action,params={},token){
 const headers={'Content-Type':'application/json'};if(token)headers.Authorization='Bearer '+token;
 const r=await handler(new Request('https://edge.test',{method:'POST',headers,body:JSON.stringify({action,liveId,viewerId:guest,...params})}));
 return {status:r.status,body:await r.json()};
}

test('finalizing a complete recording saves a private draft without publishing',async()=>{
 const calls=mock({user:{id:uid},live:{...session,state:'ended',recording_enabled:true},other:{'/rest/v1/live_segments':[{ordinal:0,uploaded:true}]}});
 assert.equal((await request('finalize',{count:1},'valid')).status,200);
 const patch=JSON.parse(calls.find(c=>c.method==='PATCH').body);
 assert.deepEqual(patch,{replay_state:'ready',segment_count:1});
});
test('private replay blocks public audience and signed segment URLs but permits creator review',async()=>{
 const live={...session,access:'public',state:'ended',replay_state:'ready',replay_published_at:null};
 for(const action of ['replay','replay-segment']){
  const calls=mock({live});assert.equal((await request(action,{ordinal:0})).status,403);
  assert.ok(!calls.some(c=>c.path.startsWith('/storage/')));
 }
 mock({live,user:{id:uid},other:{'/rest/v1/live_segments':[{ordinal:0,duration_ms:1000}]}});
 assert.equal((await request('replay',{},'valid')).status,200);
 mock({live:{...live,replay_published_at:new Date().toISOString()},other:{'/rest/v1/live_segments':[]}});
 assert.equal((await request('replay')).status,200);
});
test('publishing and unpublishing are explicit creator-only actions',async()=>{
 const live={...session,state:'ended',replay_state:'ready'};
 mock({live});assert.equal((await request('publish-replay',{published:true})).status,401);
 mock({live,user:{id:guest}});assert.equal((await request('publish-replay',{published:true},'valid')).status,403);
 for(const published of [true,false]){
  const calls=mock({live,user:{id:uid}});assert.equal((await request('publish-replay',{published},'valid')).status,200);
  const patch=JSON.parse(calls.find(c=>c.method==='PATCH').body);
  assert.equal(!!patch.replay_published_at,published);
 }
 mock({live:{...live,replay_state:'uploading'},user:{id:uid}});
 assert.equal((await request('publish-replay',{published:true},'valid')).status,409);
});
test('broadcast heartbeat cannot advertise a session without a WHIP connection',async()=>{
 const calls=mock({user:{id:uid},other:{'/rest/v1/live_connections':[]}});
 assert.equal((await request('heartbeat',{broadcast:true},'valid')).status,409);
 assert.ok(calls.every(c=>c.method==='GET'));
});
test('disabled recording rejects upload and finalize',async()=>{
 for(const action of ['segment-upload','finalize']){
  const calls=mock({live:{...session,state:'ended',recording_enabled:false},user:{id:uid}});
  assert.equal((await request(action,{count:1},'valid')).status,409);
  assert.ok(calls.every(c=>c.method==='GET'));
 }
});
test('ending hides discovery even if upstream teardown must be retried',async()=>{
 const calls=mock({user:{id:uid},other:{'/rest/v1/live_connections':[{id:guest,resource_url:'https://media.test/session'}]}});
 assert.equal((await request('end',{},'valid')).status,503);
 const patch=JSON.parse(calls.find(c=>c.method==='PATCH').body);
 assert.ok(patch.ended_at);assert.equal(patch.state,undefined);
});
test('library requires sign-in and owner filtering',async()=>{
 mock();assert.equal((await request('library')).status,401);
});
test('invalid JWT is rejected before database access',async()=>{
 const calls=mock();const r=await request('end',{},'invalid');assert.equal(r.status,401);assert.equal(calls.length,1);
});
test('anonymous users cannot publish, end, upload or finalize',async()=>{
 for(const action of ['create','end','segment-upload','segment-complete','finalize']){
  const calls=mock();assert.equal((await request(action)).status,401);
  assert.ok(calls.every(c=>c.method==='GET'));
 }
});
test('another account cannot modify the broadcaster session',async()=>{
 for(const action of ['end','segment-upload','segment-complete','finalize','signal']){
  const calls=mock({user:{id:guest}});assert.equal((await request(action,{kind:'publish',sdp:'v=0'},'valid')).status,403);
  assert.ok(calls.every(c=>c.method==='GET'));
 }
});
test('subscriber checks protect media, chat, likes, state and replay',async()=>{
 for(const action of ['signal','heartbeat','chat','like','state','replay','replay-segment']){
  const calls=mock({user:{id:guest}});const r=await request(action,{kind:'play',sdp:'v=0',liked:true},'valid');
  assert.equal(r.status,403,action);assert.ok(calls.every(c=>c.method==='GET'));
 }
});
test('expired or wrong-channel membership never grants playback',async()=>{
 for(const subscription of [[{user_id:guest,channel_id:channel,expires_at:'2000-01-01'}],[{user_id:guest,channel_id:uid,expires_at:'2999-01-01'}]]){
  mock({user:{id:guest},subscription});assert.equal((await request('state',{},'valid')).status,403);
 }
});
test('valid membership can read escaped-by-client chat data and live counts',async()=>{
 mock({user:{id:guest},subscription:[{user_id:guest,channel_id:channel,expires_at:'2999-01-01'}],other:{
  '/rest/v1/rpc/openvideo_live_stats':[{live_id:liveId,viewers:2,likes:1}],'/rest/v1/live_messages':[], '/rest/v1/live_likes':[]
 }});
 const r=await request('state',{},'valid');assert.equal(r.status,200);assert.equal(r.body.viewers,2);
});
test('audience heartbeat requires an established playback session',async()=>{
 const calls=mock({live:{...session,access:'public'},other:{'/rest/v1/live_connections':[]}});
 assert.equal((await request('heartbeat')).status,409);assert.ok(calls.every(c=>c.method==='GET'));
});
test('incomplete replay cannot be published',async()=>{
 mock({user:{id:uid},live:{...session,state:'ended'},other:{'/rest/v1/live_segments':[{ordinal:0,uploaded:false}]}});
 assert.equal((await request('finalize',{count:1},'valid')).status,409);
});
test('database errors do not expose credentials or upstream URLs',async()=>{
 mock({user:{id:uid}});
 const r=await request('state',{},'valid');assert.equal(r.status,500);
 assert.deepEqual(r.body,{error:'Live is temporarily unavailable.'});
});
