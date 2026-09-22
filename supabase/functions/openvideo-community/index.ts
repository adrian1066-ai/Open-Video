// Identity is verified here; atomic state transitions and permissions live in service-only SQL functions.
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const allowed=origin==='https://adrian1066-ai.github.io'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Origin':allowed?origin:'https://adrian1066-ai.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const reply=(body:any,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 try{
  if(origin&&!allowed)return reply({error:'Origin not allowed.'},403);
  if(req.method!=='POST')return reply({error:'Use POST.'},405);
  const bearer=req.headers.get('Authorization');if(!bearer)return reply({error:'Sign in to continue.'},401);
  const auth=await fetch(base+'/auth/v1/user',{headers:{apikey:key,Authorization:bearer}});
  if(!auth.ok)return reply({error:'Sign in again.'},401);const user=await auth.json();
  if(!user.id||user.is_anonymous)return reply({error:'An account is required.'},401);
  const raw=await req.text();if(raw.length>12000)return reply({error:'Request too large.'},413);
  let b:any;try{b=JSON.parse(raw);}catch{return reply({error:'Invalid request.'},400);}
  const actions:Record<string,string[]>={challenge:['list','create','accept','submit','review'],progress:['list'],request:['list','create','alerts','accept','start','complete','cancel'],mission:['list','create','accept','complete'],event:['list','create','join','leave','close']};
  if(!b||!Object.hasOwn(actions,b.module)||!actions[b.module].includes(b.action))return reply({error:'Unknown action.'},400);
  if(b.data!==undefined&&(!b.data||typeof b.data!=='object'||Array.isArray(b.data)))return reply({error:'Invalid data.'},400);
  const r=await fetch(base+'/rest/v1/rpc/openvideo_'+b.module+'_action',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_actor:user.id,p_action:b.action,p_data:b.data||{}})});
  const data=await r.json();
  if(!r.ok)return reply({error:data.code==='P0001'?data.message:data.code==='23505'?'This proof was already used.':'Could not complete the action. Check the details and try again.'},data.code==='23505'?409:400);
  return reply(data);
 }catch{return reply({error:'Community tools are temporarily unavailable.'},503);}
});
