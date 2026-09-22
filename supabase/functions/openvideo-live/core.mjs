export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const fresh = s => !s.safety_hidden && !s.ended_at && ['starting','live'].includes(s.state) && Date.now()-Date.parse(s.heartbeat_at)<60000;
export const replayAvailable = (s,userId) => s.state==='ended' && s.replay_state==='ready' && (s.owner_id===userId || !!s.replay_published_at);
export function canWatch(session, userId, subscription) {
  return session.access === 'public' || session.owner_id === userId ||
    !!(userId && subscription?.user_id === userId && subscription.channel_id === session.channel_id && Date.parse(subscription.expires_at)>Date.now());
}
export function publicSession(s, channel, stats={}) {
  return {id:s.id,channel_id:s.channel_id,title:s.title,access:s.access,
    state:fresh(s)?s.state:'ended',replay_state:s.replay_state,created_at:s.created_at,
    category:s.category,country:s.country,city:s.city,started_at:s.started_at,ended_at:s.ended_at,
    recording_enabled:s.recording_enabled,replay_published_at:s.replay_published_at,
    channel_name:channel?.name||'Creator',viewers:Number(stats.viewers||0),likes:Number(stats.likes||0)};
}
export function validEndpoint(value, host, kind) {
  try { const u=new URL(value); return u.protocol==='https:' && u.hostname===host && !u.username && !u.password && u.pathname.endsWith(`/webRTC/${kind}`); } catch { return false; }
}
export const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
export async function playbackToken(config) {
 const enc=new TextEncoder(), encode=o=>b64url(enc.encode(JSON.stringify(o)));
 const payload=`${encode({alg:'RS256',kid:config.keyId})}.${encode({sub:config.inputUid,kid:config.keyId,exp:Math.floor(Date.now()/1000)+60})}`;
 const key=await crypto.subtle.importKey('jwk',JSON.parse(atob(config.jwk)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 return `${payload}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(payload)))}`;
}
