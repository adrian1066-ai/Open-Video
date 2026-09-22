// Authenticated safety API. No secrets, tokens, media URLs or request bodies are logged.
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const service={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
class Problem extends Error{status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const fail=(code:number,message:string):never=>{throw new Problem(code,message);};
const uuid=(x:any)=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)?x:fail(400,'Invalid identifier.');
const q=(s:any)=>encodeURIComponent(String(s));
async function db(path:string,method='GET',body?:any){const r=await fetch(`${base}/rest/v1/${path}`,{method,headers:{...service,Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)fail(r.status===403?403:503,'Safety service is temporarily unavailable.');const t=await r.text();return t?JSON.parse(t):null;}
async function target(kind:string,id:any){
 if(kind==='live-comment'){if(!/^\d{1,18}$/.test(String(id)))fail(400,'Invalid comment.');return (await db(`live_messages?select=id,user_id,body,live_id&id=eq.${id}`))[0];}
 uuid(id);
 if(kind==='video')return (await db(`videos?select=id,title,description,channel_id&id=eq.${id}`))[0];
 if(kind==='live')return (await db(`live_sessions?select=id,title,owner_id,channel_id,state&id=eq.${id}`))[0];
 if(kind==='comment')return (await db(`video_comments?select=id,user_id,body,video_id&id=eq.${id}`))[0];
 if(kind==='user')return (await db(`profiles?select=id,display_name&id=eq.${id}`))[0];
 fail(400,'Invalid report type.');
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const allowed=origin==='https://adrian1066-ai.github.io'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
 const cors={'Access-Control-Allow-Origin':allowed?origin:'https://adrian1066-ai.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store','Vary':'Origin'};
 const reply=(b:any,status=200)=>new Response(JSON.stringify(b),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 try{
 if(origin&&!allowed)fail(403,'Origin not allowed.');if(req.method!=='POST')fail(405,'Use POST.');
 const bearer=req.headers.get('Authorization');if(!bearer)fail(401,'Sign in to continue.');
 const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:bearer}});
 if(!auth.ok)fail(401,'Sign in again.');const user=await auth.json();if(!user.id||user.is_anonymous)fail(401,'An account is required.');
 const raw=await req.text();if(raw.length>16000)fail(413,'Request too large.');
 let b:any;try{b=JSON.parse(raw);}catch{fail(400,'Invalid request.');}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'Invalid request.');
 const moderator=async()=>{if(!(await db(`openvideo_moderators?user_id=eq.${user.id}&limit=1`)).length)fail(403,'Moderator access required.');};
 if(b.action==='report'){
  const reason=String(b.reason||'').trim(),description=String(b.description||'').trim();
  if(!['spam','harassment','violence','sexual','copyright','other'].includes(reason)||description.length>2000)fail(400,'Choose a reason and keep details under 2,000 characters.');
  if(!await target(b.kind,b.targetId))fail(404,'Content not found.');
  if(!await db('rpc/openvideo_consume_limit','POST',{p_actor:user.id,p_scope:'report',p_limit:5,p_seconds:3600}))fail(429,'Report limit reached. Please try later.');
  const old=await db(`reports?select=id,status&reporter_id=eq.${user.id}&target_kind=eq.${q(b.kind)}&target_id=eq.${q(b.targetId)}&status=in.(open,reviewing)&limit=1`);
  if(old.length)return reply({report:old[0]});
  const rows=await db('reports','POST',{reporter_id:user.id,target_kind:b.kind,target_id:String(b.targetId),reason,description,status:'open'});
  return reply({report:{id:rows[0].id,status:'open'}});
 }
 if(b.action==='my-reports')return reply({reports:await db(`reports?select=id,target_kind,target_id,reason,status,created_at,resolved_at&reporter_id=eq.${user.id}&order=created_at.desc&limit=100`)});
 if(b.action==='blocks')return reply({blocks:await db(`user_blocks?select=blocked_id,created_at&blocker_id=eq.${user.id}&order=created_at.desc`)});
 if(b.action==='block'){
  let blocked=b.userId;
  if(b.channelId){const c=(await db(`channels?select=owner_id&id=eq.${uuid(b.channelId)}`))[0];if(!c)fail(404,'Creator not found.');blocked=c.owner_id;}
  uuid(blocked);if(blocked===user.id||typeof b.blocked!=='boolean')fail(400,'Invalid block request.');
  if(!await target('user',blocked))fail(404,'User not found.');
  if(!await db('rpc/openvideo_consume_limit','POST',{p_actor:user.id,p_scope:'block',p_limit:30,p_seconds:60}))fail(429,'Please wait before trying again.');
  if(b.blocked){const rows=await db(`user_blocks?blocker_id=eq.${user.id}&blocked_id=eq.${blocked}`);if(!rows.length)await db('user_blocks','POST',{blocker_id:user.id,blocked_id:blocked});}
  else await db(`user_blocks?blocker_id=eq.${user.id}&blocked_id=eq.${blocked}`,'DELETE');
  return reply({ok:true});
 }
 if(b.action==='capabilities')return reply({moderator:(await db(`openvideo_moderators?user_id=eq.${user.id}&limit=1`)).length>0});
 if(b.action==='queue'){
  await moderator();return reply({reports:await db('reports?select=id,target_kind,target_id,reason,description,status,created_at&order=created_at.desc&limit=100')});
 }
 if(b.action==='review-target'){
  await moderator();return reply({target:await target(b.kind,b.targetId)});
 }
 if(b.action==='review'){
  await moderator();uuid(b.reportId);
  if(!['reviewing','dismissed','resolved','hide','restore'].includes(b.decision)||typeof b.note!=='string'||b.note.length>2000)fail(400,'Invalid review.');
  await db('rpc/openvideo_review_report','POST',{p_actor:user.id,p_report:b.reportId,p_action:b.decision,p_note:b.note});return reply({ok:true});
 }
 fail(400,'Unknown action.');
 }catch(e){return reply({error:e instanceof Problem?e.message:'Safety service is temporarily unavailable.'},e instanceof Problem?e.status:500);}
});
