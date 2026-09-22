/* In-app inbox; delivery is produced by database events, not by client-created notifications. */
(()=>{
 const esc=x=>escapeHtml(String(x??'')),el=id=>document.getElementById(id);let timer=null,loading=false;
 const section=document.createElement('section');section.id='view-notifications';section.className='view';section.innerHTML='<div class="section-title"><h2>Notifications</h2><button class="ghost" id="notificationRefresh">Refresh</button></div><p class="notice" id="notificationStatus" role="status"></p><div id="notificationList"></div>';
 document.querySelector('.main').append(section);
 const button=document.createElement('button');button.id='notificationBell';button.className='icon-btn';button.textContent='Inbox';button.setAttribute('aria-label','Open notifications');button.onclick=()=>go('notifications');document.querySelector('.top-actions').prepend(button);
 const style=document.createElement('style');style.textContent='.top-actions{width:auto;flex-shrink:0}#notificationList .studio-card{margin-bottom:12px;overflow-wrap:anywhere}@media(max-width:540px){.topbar{gap:8px}.top-actions{gap:4px}.top-actions .icon-btn{padding:8px 6px;font-size:12px}.brand img{width:100px}.top-actions .avatar{width:30px;height:30px}}';document.head.append(style);
 async function refresh(){if(loading)return;loading=true;try{
  const {data:{session}}=await sb.auth.getSession();if(!session){el('notificationList').innerHTML='';el('notificationStatus').textContent='Sign in to see notifications.';button.textContent='Inbox';return;}
  const {data,error}=await sb.from('notifications').select('id,type,title,message,read,route,created_at').order('created_at',{ascending:false}).limit(100);if(error)throw error;
  const unread=data.filter(n=>!n.read).length;button.textContent=unread?`Inbox (${unread})`:'Inbox';
  el('notificationStatus').textContent=data.length?'Your recent notifications':'No notifications yet.';
  el('notificationList').innerHTML=data.map(n=>`<article class="studio-card"><strong>${n.read?'':'● '}${esc(n.title)}</strong><p>${esc(n.message)}</p><p class="subtext">${esc(new Date(n.created_at).toLocaleString())}</p><div class="live-actions">${n.route?`<button class="ghost" data-notification-open="${n.id}">Open</button>`:''}${n.read?'':`<button class="ghost" data-notification-read="${n.id}">Mark read</button>`}</div></article>`).join('');
  el('notificationList').querySelectorAll('[data-notification-read]').forEach(b=>b.onclick=async()=>{b.disabled=true;const {error}=await sb.from('notifications').update({read:true}).eq('id',b.dataset.notificationRead);if(error){toast('Could not update notification.');b.disabled=false;}else refresh();});
  el('notificationList').querySelectorAll('[data-notification-open]').forEach(b=>b.onclick=async()=>{const n=data.find(x=>x.id===b.dataset.notificationOpen);const route=n.route||'';
   // Only known internal routes. Database text can never redirect to an external URL.
   if(/^real-[0-9a-f-]{36}$/i.test(route))await watchCommunityVideo(route.slice(5));
   else if(/^channel-[0-9a-f-]{36}$/i.test(route))await openRealChannel(route.slice(8));
   else if(/^live-[0-9a-f-]{36}$/i.test(route))await OpenVideoLive.open(route.slice(5));
   else if(['challenges','requests','missions','progress','profile'].includes(route))go(route);
   else toast('This notification has no available destination.');
  });
 }catch{el('notificationStatus').textContent='Notifications could not load. Try Refresh.';}finally{loading=false;}}
 el('notificationRefresh').onclick=refresh;
 document.addEventListener('openvideo:view',e=>{if(e.detail==='notifications')refresh();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
 sb.auth.onAuthStateChange(()=>{setTimeout(refresh,0);});
 timer=setInterval(()=>{if(!document.hidden)refresh();},30000);
 refresh();if(location.hash==='#notifications')go('notifications');
})();
