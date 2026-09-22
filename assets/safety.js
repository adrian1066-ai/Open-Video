/* Additive reporting, blocking and moderator tools. Privileges are checked on the server. */
(()=>{
 const el=id=>document.getElementById(id),esc=value=>escapeHtml(String(value??''));
 let reportTarget=null;
 async function api(action,data={}){
  const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('Sign in to use safety tools.');
  const r=await fetch(SUPABASE_URL+'/functions/v1/openvideo-safety',{method:'POST',headers:{apikey:SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({action,...data}),signal:AbortSignal.timeout(15000)});
  const body=await r.json();if(!r.ok)throw Error(body.error||'Safety tools are unavailable.');return body;
 }
 const modal=el('reportModal').querySelector('.modal-card');
 modal.innerHTML='<h2>Report content</h2><form id="safetyReportForm"><div class="field"><label for="safetyReason">Reason</label><select id="safetyReason"><option value="spam">Spam or deceptive practices</option><option value="harassment">Harassment</option><option value="violence">Violence / dangerous content</option><option value="sexual">Sexual content</option><option value="copyright">Copyright issue</option><option value="other">Other</option></select></div><div class="field"><label for="safetyDescription">Details (optional)</label><textarea id="safetyDescription" maxlength="2000"></textarea></div><p id="safetyReportStatus" role="status"></p><div class="live-actions"><button id="safetySubmit" class="primary">Submit report</button><button type="button" class="ghost" id="safetyCancel">Cancel</button></div></form>';
 el('safetyCancel').onclick=()=>closeModal('reportModal');
 function report(kind,targetId){if(!targetId){toast('Choose real content to report.');return;}reportTarget={kind,targetId};el('safetyDescription').value='';el('safetyReportStatus').textContent='Reports are reviewed by OpenVideo moderators.';openModal('reportModal');}
 el('safetyReportForm').onsubmit=async e=>{e.preventDefault();el('safetySubmit').disabled=true;try{const result=await api('report',{...reportTarget,reason:el('safetyReason').value,description:el('safetyDescription').value});el('safetyReportStatus').textContent='Report received · '+result.report.status;toast('Report received');}catch(e){el('safetyReportStatus').textContent=e.message;}finally{el('safetySubmit').disabled=false;}};
 window.openReport=()=>current?.real?report('video',current.video_id):toast('Reports are available for community videos.');
 async function block(data){try{await api('block',{...data,blocked:true});toast('User blocked. Manage blocks in Safety.');go('safety');await load();loadPublicCommunityVideos().catch(()=>{});}catch(e){toast(e.message);}}
 const section=document.createElement('section');section.id='view-safety';section.className='view';section.innerHTML='<div class="section-title"><h2>Safety & reports</h2><button id="safetyRefresh" class="ghost">Refresh</button></div><p id="safetyStatus" class="notice" role="status"></p><h3>My reports</h3><div id="safetyReports"></div><h3>Blocked users</h3><div id="safetyBlocks"></div><div id="safetyModerator" hidden><h3>Moderation queue</h3><p class="subtext">Review the target and context before making a decision. All actions are recorded.</p><div id="safetyQueue"></div></div>';
 document.querySelector('.main').append(section);
 const nav=document.createElement('button');nav.textContent='Safety & reports';nav.onclick=()=>go('safety');document.querySelector('.nav').append(nav);
 const liveSafety=document.createElement('button');liveSafety.textContent='Safety';liveSafety.className='ghost';liveSafety.onclick=()=>go('safety');el('liveRefresh').after(liveSafety);
 const profileActions=document.createElement('div');profileActions.className='live-actions';profileActions.innerHTML='<button id="safetyReportCreator" class="ghost">Report creator</button><button id="safetyBlockCreator" class="ghost">Block creator</button>';el('channelFollowBtn').after(profileActions);
 el('safetyReportCreator').onclick=()=>activeChannel&&report('user',activeChannel.owner_id);
 el('safetyBlockCreator').onclick=()=>activeChannel&&block({channelId:activeChannel.id});
 const watchActions=document.createElement('div');watchActions.className='live-actions';watchActions.innerHTML='<button id="safetyReportLive" class="ghost">Report Live</button><button id="safetyBlockLive" class="ghost">Block creator</button>';el('liveWatchDetails').after(watchActions);
 el('safetyReportLive').onclick=()=>{const s=OpenVideoLive.getWatching();if(s)report('live',s.id);};
 el('safetyBlockLive').onclick=()=>{const s=OpenVideoLive.getWatching();if(s?.channelId)block({channelId:s.channelId});};
 async function load(){
  el('safetyStatus').textContent='Loading…';el('safetyModerator').hidden=true;el('safetyReports').innerHTML='';el('safetyBlocks').innerHTML='';el('safetyQueue').innerHTML='';
  try{
   const [reports,blocks,caps]=await Promise.all([api('my-reports'),api('blocks'),api('capabilities')]);
   el('safetyReports').innerHTML=reports.reports.map(r=>`<article class="studio-card"><strong>${esc(r.target_kind||'Content')} · ${esc(r.reason)}</strong><p>${esc(r.status)} · ${esc(new Date(r.created_at).toLocaleString())}</p></article>`).join('')||'<p class="subtext">No reports submitted.</p>';
   el('safetyBlocks').innerHTML=blocks.blocks.map(b=>`<article class="studio-card"><span>Blocked account ${esc(b.blocked_id.slice(0,8))}</span> <button class="ghost" data-unblock="${b.blocked_id}">Unblock</button></article>`).join('')||'<p class="subtext">No blocked users.</p>';
   el('safetyBlocks').querySelectorAll('[data-unblock]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;try{await api('block',{userId:btn.dataset.unblock,blocked:false});await load();}catch(e){toast(e.message);btn.disabled=false;}});
   if(caps.moderator){el('safetyModerator').hidden=false;await queue();}
   el('safetyStatus').textContent='Blocking limits interactions between signed-in accounts. Public content may still be visible when signed out.';
  }catch(e){el('safetyStatus').textContent=e.message;}
 }
 async function queue(){
  const {reports}=await api('queue');
  el('safetyQueue').innerHTML=reports.map(r=>`<article class="studio-card"><strong>${esc(r.target_kind||'Legacy report')} · ${esc(r.reason)} · ${esc(r.status)}</strong><p>${esc(r.description)}</p><button class="ghost" data-inspect="${r.id}">Review target</button><pre id="safety-target-${r.id}" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre><label>Review note <textarea maxlength="2000" id="safety-note-${r.id}"></textarea></label><div class="live-actions">${['reviewing','dismissed','resolved','hide','restore'].map(a=>`<button class="ghost" data-review="${r.id}" data-decision="${a}">${a}</button>`).join('')}</div></article>`).join('')||'<p class="subtext">No reports awaiting review.</p>';
  el('safetyQueue').querySelectorAll('[data-inspect]').forEach(btn=>btn.onclick=async()=>{try{const r=reports.find(x=>x.id===btn.dataset.inspect);const data=await api('review-target',{kind:r.target_kind,targetId:r.target_id});el('safety-target-'+r.id).textContent=JSON.stringify(data.target,null,2);}catch(e){toast(e.message);}});
  el('safetyQueue').querySelectorAll('[data-review]').forEach(btn=>btn.onclick=async()=>{btn.disabled=true;try{await api('review',{reportId:btn.dataset.review,decision:btn.dataset.decision,note:el('safety-note-'+btn.dataset.review).value});await load();}catch(e){toast(e.message);btn.disabled=false;}});
 }
 el('safetyRefresh').onclick=load;
 document.addEventListener('openvideo:view',e=>{if(e.detail==='safety')load();});
 sb.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){el('safetyQueue').innerHTML='';el('safetyReports').innerHTML='';el('safetyBlocks').innerHTML='';el('safetyModerator').hidden=true;}});
 window.OpenVideoSafety={report,blockUser:userId=>block({userId}),open:()=>go('safety')};
 if(location.hash==='#safety')go('safety');
})();
