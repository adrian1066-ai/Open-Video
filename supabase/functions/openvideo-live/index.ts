import { UUID, fresh, canWatch, publicSession, validEndpoint, playbackToken } from './core.mjs';

// No upstream URLs, SDP, JWTs or database errors are logged or included in errors.
const base=Deno.env.get('SUPABASE_URL')!;
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const headers={apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
class Problem extends Error { status:number; constructor(status:number,message:string){super(message);this.status=status;} }
async function db(path:string,method='GET',body?:unknown,prefer='return=representation') {
 const r=await fetch(`${base}/rest/v1/${path}`,{method,headers:{...headers,Prefer:prefer},body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok) { if(r.status===409)throw new Problem(409,'The live input is busy. Please try again shortly.'); throw new Problem(503,'Live data is temporarily unavailable.'); }
 const t=await r.text(); return t?JSON.parse(t):null;
}
async function storage(path:string,method='POST',body?:unknown) {
 const r=await fetch(`${base}/storage/v1/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok)throw new Problem(503,'Replay storage is temporarily unavailable.');
 return r.status===204?null:await r.json();
}
const query=(v:unknown)=>encodeURIComponent(String(v));
const fail=(status:number,message:string):never=>{throw new Problem(status,message);};
const id=(v:unknown)=>typeof v==='string'&&UUID.test(v)?v:fail(400,'Invalid identifier.');
async function closeConnection(c:any) {
 // Only server-created and allowlisted Cloudflare session URLs reach this table.
 try {const r=await fetch(c.resource_url,{method:'DELETE',redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok&&![404,410].includes(r.status))throw new Error();}
 catch {throw new Problem(503,'Could not close the previous media session. Please retry.');}
 await db(`live_connections?id=eq.${c.id}`,'DELETE');
}
async function sessionFor(liveId:string) {
 const rows=await db(`live_sessions?id=eq.${id(liveId)}&limit=1`);
 return rows[0]||fail(404,'Live session not found.');
}
async function authorize(s:any,userId:string|null) {
 let sub=null;
 if(s.access==='subscribers'&&userId&&s.owner_id!==userId)sub=(await db(`live_subscriptions?channel_id=eq.${s.channel_id}&user_id=eq.${userId}&limit=1`))[0];
 if(!canWatch(s,userId,sub))fail(403,'An active subscription to this channel is required.');
}

Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const allowed=origin==='https://adrian1066-ai.github.io'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
 const cors={'Access-Control-Allow-Origin':allowed?origin:'https://adrian1066-ai.github.io','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 try{
  if(origin&&!allowed)fail(403,'Origin not allowed.');
  if(req.method!=='POST')fail(405,'Use POST.');
  const raw=await req.text(); if(raw.length>150000)fail(413,'Request too large.');
  let b:any;try{b=JSON.parse(raw);}catch{fail(400,'Invalid request.');}
  let user:any=null;
  const bearer=req.headers.get('Authorization');
  if(bearer){
   const r=await fetch(`${base}/auth/v1/user`,{headers:{apikey:secret,Authorization:bearer}});
   if(!r.ok)fail(401,'Sign in again to continue.');user=await r.json();
   if(!user.id||user.is_anonymous)fail(401,'A verified account is required.');
  }
  const requireUser=()=>user?.id||fail(401,'Sign in to continue.');
  const action=b.action;
  const viewerKey=user?.id?`user:${user.id}`:`guest:${id(b.viewerId)}`;
  if(action==='list') {
   const rows=await db('live_sessions?select=*&order=created_at.desc&limit=60');
   const visible=rows.filter((s:any)=>fresh(s)||s.replay_state==='ready');
   const stats=visible.length?await db('rpc/openvideo_live_stats','POST',{p_ids:visible.map((s:any)=>s.id)}):[];
   const channels=visible.length?await db(`channels?select=id,name&id=in.(${[...new Set(visible.map((s:any)=>s.channel_id))].join(',')})`):[];
   return reply({sessions:visible.map((s:any)=>publicSession(s,channels.find((c:any)=>c.id===s.channel_id),stats.find((c:any)=>c.live_id===s.id)))});
  }
  if(action==='create') {
   const owner=requireUser();
   const title=String(b.title||'').trim();if(!title||title.length>160||!['public','subscribers'].includes(b.access))fail(400,'Enter a title and choose an audience.');
   const channel=(await db(`channels?select=id,owner_id&id=eq.${id(b.channelId)}&owner_id=eq.${owner}`))[0];
   if(!channel)fail(403,'You can only broadcast from your own channel.');
   const config=await db('rpc/openvideo_live_config','POST',{});if(!config?.whip)fail(503,'Live input is not configured.');
   // Lease expiry and the unique partial index prevent two broadcasters sharing this input.
   const stale=await db(`live_sessions?state=in.(starting,live)&heartbeat_at=lt.${query(new Date(Date.now()-60000).toISOString())}`);
   for(const s of stale){
    const connections=await db(`live_connections?live_id=eq.${s.id}`);for(const c of connections)await closeConnection(c);
    await db(`live_sessions?id=eq.${s.id}&heartbeat_at=lt.${query(new Date(Date.now()-60000).toISOString())}`,'PATCH',{state:'ended',ended_at:new Date().toISOString(),replay_state:'incomplete'});
   }
   const rows=await db('live_sessions','POST',{channel_id:channel.id,owner_id:owner,title,access:b.access,input_uid:config.inputUid});
   return reply({id:rows[0].id});
  }
  const s=await sessionFor(b.liveId);
  const own=()=>{if(requireUser()!==s.owner_id)fail(403,'Only the broadcaster can do this.');};
  if(action==='signal') {
   const publishing=b.kind==='publish';if(!publishing&&b.kind!=='play')fail(400,'Invalid connection type.');
   if(publishing)own();else await authorize(s,user?.id);
   if(!fresh(s)||(publishing&&s.state!=='starting')||(!publishing&&s.state!=='live'))fail(409,'This broadcast is not available.');
   if(typeof b.sdp!=='string'||!b.sdp.startsWith('v=0')||b.sdp.length>120000)fail(400,'Invalid media offer.');
   const existing=await db(`live_connections?live_id=eq.${s.id}&viewer_key=eq.${query(viewerKey)}&kind=eq.${b.kind}`);
   for(const c of existing)await closeConnection(c);
   const config=await db('rpc/openvideo_live_config','POST',{});
   if(config.inputUid!==s.input_uid||!validEndpoint(config.whip,config.host,'publish')||!validEndpoint(config.whep,config.host,'play'))fail(503,'Live configuration is invalid.');
   const upstream=publishing?config.whip:`https://${config.host}/${await playbackToken(config)}/webRTC/play`;
   const r=await fetch(upstream,{method:'POST',headers:{'Content-Type':'application/sdp'},body:b.sdp,redirect:'error',signal:AbortSignal.timeout(15000)});
   if(!r.ok)fail(502,publishing?'Cloudflare could not start this broadcast.':'The broadcaster is not sending media yet. Try again.');
   const answer=await r.text(),location=r.headers.get('Location');
   if(!location)fail(502,'Cloudflare did not return a media session.');
   const resource=new URL(location,upstream);
   if(resource.protocol!=='https:'||resource.hostname!==config.host||resource.username||resource.password)fail(502,'Invalid media session.');
   let connection;
   try {connection=(await db('live_connections','POST',{live_id:s.id,viewer_key:viewerKey,kind:b.kind,resource_url:resource.toString()}))[0];}
   catch(e){await fetch(resource,{method:'DELETE'}).catch(()=>{});throw e;}
   return reply({sdp:answer,connectionId:connection.id});
  }
  if(action==='disconnect'){
   const cs=await db(`live_connections?id=eq.${id(b.connectionId)}&live_id=eq.${s.id}&viewer_key=eq.${query(viewerKey)}`);
   for(const c of cs)await closeConnection(c);
   await db(`live_viewers?live_id=eq.${s.id}&viewer_key=eq.${query(viewerKey)}`,'DELETE');
   return reply({ok:true});
  }
  if(action==='heartbeat'){
   if(b.broadcast){own();if(!fresh(s))fail(409,'Broadcast lease expired. Please start again.');
    await db(`live_sessions?id=eq.${s.id}&state=in.(starting,live)`,'PATCH',{state:'live',heartbeat_at:new Date().toISOString()});
   } else {await authorize(s,user?.id);if(!fresh(s))fail(409,'This broadcast has ended.');
    const connected=await db(`live_connections?select=id&live_id=eq.${s.id}&viewer_key=eq.${query(viewerKey)}&kind=eq.play&limit=1`);
    if(!connected.length)fail(409,'Connect to the broadcast before joining the audience.');
    if(user?.id!==s.owner_id)await db('live_viewers?on_conflict=live_id,viewer_key','POST',{live_id:s.id,viewer_key:viewerKey,seen_at:new Date().toISOString()},'resolution=merge-duplicates,return=minimal');
   }return reply({ok:true});
  }
  if(action==='end'){
   own();
   const cs=await db(`live_connections?live_id=eq.${s.id}`);for(const c of cs)await closeConnection(c);
   await db(`live_sessions?id=eq.${s.id}`,'PATCH',{state:'ended',ended_at:s.ended_at||new Date().toISOString(),replay_state:s.replay_state==='ready'?'ready':'uploading'});
   await db(`live_viewers?live_id=eq.${s.id}`,'DELETE');return reply({ok:true});
  }
  if(action==='segment-upload'){
   own();if(s.replay_state==='ready')fail(409,'Replay already finalized.');
   if(!Number.isInteger(b.ordinal)||b.ordinal<0||b.ordinal>1439||!Number.isInteger(b.bytes)||b.bytes<1||b.bytes>20971520||!Number.isInteger(b.durationMs)||b.durationMs<1||b.durationMs>120000||!['video/webm','video/mp4'].includes(b.mime))fail(400,'Invalid recording segment.');
   const path=`${s.owner_id}/${s.id}/${b.ordinal}.${b.mime==='video/mp4'?'mp4':'webm'}`;
   const previous=(await db(`live_segments?live_id=eq.${s.id}&ordinal=eq.${b.ordinal}`))[0];
   if(previous?.uploaded)return reply({uploaded:true});
   await db('live_segments?on_conflict=live_id,ordinal','POST',{live_id:s.id,ordinal:b.ordinal,object_path:path,mime:b.mime,duration_ms:b.durationMs,bytes:b.bytes,uploaded:false},'resolution=merge-duplicates,return=minimal');
   const signed=await storage(`object/upload/sign/live-replays/${path}`,'POST',{});
   // This token permits writing exactly one replay object; it is unrelated to WHIP credentials.
   return reply({path,token:signed.token||new URL(signed.url,base+'/storage/v1').searchParams.get('token')});
  }
  if(action==='segment-complete'){
   own();const ordinal=Number(b.ordinal);if(!Number.isInteger(ordinal)||ordinal<0||ordinal>1439)fail(400,'Invalid segment.');
   const seg=(await db(`live_segments?live_id=eq.${s.id}&ordinal=eq.${ordinal}`))[0];if(!seg)fail(404,'Segment not found.');
   const info=await storage(`object/info/authenticated/live-replays/${seg.object_path}`,'GET');
   if(Number(info.metadata?.size??info.size)!==seg.bytes)fail(409,'Recording upload is incomplete.');
   await db(`live_segments?live_id=eq.${s.id}&ordinal=eq.${ordinal}`,'PATCH',{uploaded:true});return reply({ok:true});
  }
  if(action==='finalize'){
   own();if(s.state!=='ended')fail(409,'End the broadcast before publishing its replay.');
   const count=Number(b.count);if(!Number.isInteger(count)||count<1||count>1440)fail(400,'No complete recording was found.');
   const segments=await db(`live_segments?live_id=eq.${s.id}&order=ordinal`);
   if(segments.length!==count||segments.some((x:any,i:number)=>x.ordinal!==i||!x.uploaded))fail(409,'Some recording segments are still uploading.');
   await db(`live_sessions?id=eq.${s.id}`,'PATCH',{replay_state:'ready',segment_count:count});return reply({ok:true});
  }
  await authorize(s,user?.id);
  if(action==='state'){
   const stats=(await db('rpc/openvideo_live_stats','POST',{p_ids:[s.id]}))[0];
   const messages=await db(`live_messages?select=id,display_name,body,created_at&live_id=eq.${s.id}&order=id.desc&limit=60`);
   const liked=user?(await db(`live_likes?live_id=eq.${s.id}&user_id=eq.${user.id}`)).length>0:false;
   return reply({state:fresh(s)?s.state:'ended',replay_state:s.replay_state,...stats,messages:messages.reverse(),liked});
  }
  if(action==='chat'){
   const uid=requireUser();if(!fresh(s))fail(409,'This live chat has ended.');
   const body=String(b.body||'').trim();if(!body||body.length>1000)fail(400,'Messages must contain 1–1,000 characters.');
   const recent=await db(`live_messages?select=id&user_id=eq.${uid}&created_at=gt.${query(new Date(Date.now()-2000).toISOString())}&limit=1`);
   if(recent.length)fail(429,'Wait a moment before sending another message.');
   const profile=(await db(`profiles?select=display_name&id=eq.${uid}`))[0];
   await db('live_messages','POST',{live_id:s.id,user_id:uid,display_name:String(profile?.display_name||'Viewer').slice(0,80),body});return reply({ok:true});
  }
  if(action==='like'){
   const uid=requireUser();if(typeof b.liked!=='boolean')fail(400,'Invalid like.');
   if(b.liked)await db('live_likes?on_conflict=live_id,user_id','POST',{live_id:s.id,user_id:uid},'resolution=ignore-duplicates,return=minimal');
   else await db(`live_likes?live_id=eq.${s.id}&user_id=eq.${uid}`,'DELETE');return reply({ok:true});
  }
  if(action==='replay'){
   if(s.replay_state!=='ready')fail(409,'The replay is not ready yet.');
   const segments=await db(`live_segments?select=ordinal,duration_ms&live_id=eq.${s.id}&uploaded=eq.true&order=ordinal`);
   return reply({segments});
  }
  if(action==='replay-segment'){
   if(s.replay_state!=='ready'||!Number.isInteger(b.ordinal))fail(409,'The replay is not ready yet.');
   const seg=(await db(`live_segments?live_id=eq.${s.id}&ordinal=eq.${b.ordinal}&uploaded=eq.true`))[0];if(!seg)fail(404,'Segment not found.');
   const signed=await storage(`object/sign/live-replays/${seg.object_path}`,'POST',{expiresIn:120});
   return reply({url:new URL(`${base}/storage/v1${signed.signedURL}`).toString()});
  }
  fail(400,'Unknown Live action.');
 }catch(e){return reply({error:e instanceof Problem?e.message:'Live is temporarily unavailable.'},e instanceof Problem?e.status:500);}
});
