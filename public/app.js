let deferredInstallPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstallPrompt=e;});
window.addEventListener('appinstalled',()=>{deferredInstallPrompt=null;toast('AVALON 앱이 설치되었습니다.');});
if('serviceWorker' in navigator && location.protocol==='https:')window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(console.warn));
const el=document.getElementById('app');let ws=null,state=null,selected=[],secretVisible=false,connected=false;let session=JSON.parse(sessionStorage.getItem('avalonSession')||'null');let confirmVote=null;let retryDelay=1600;let shareBase=location.origin;let networkAddresses=[];let pendingSeat=null;let seenSwapKey='';let openedQuest=null;let pendingBallot=null;let ballotTimeout=null;
fetch('/network-addresses').then(r=>r.json()).then(x=>{networkAddresses=x.addresses||[];if(['localhost','127.0.0.1'].includes(location.hostname)&&networkAddresses.length)shareBase=networkAddresses[0];if(state?.phase==='lobby')render();}).catch(()=>{});
const inviteUrl=()=>shareBase+'/?room='+encodeURIComponent(state.code);
const names={Merlin:'멀린',Percival:'퍼시벌',Assassin:'암살자',Morgana:'모르가나',Mordred:'모드레드',Oberon:'오베론','Loyal Servant':'충성스러운 신하',Minion:'악의 하수인'};
const roleImages={"Merlin": "/roles/merlin.webp", "Percival": "/roles/percival.webp", "Assassin": "/roles/assassin.webp", "Morgana": "/roles/morgana.webp", "Mordred": "/roles/mordred.webp", "Oberon": "/roles/oberon.webp", "Loyal Servant": "/roles/loyal-servant.webp", "Minion": "/roles/minion.webp"};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(t){let x=document.getElementById('toast');x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',3600)}
function emit(type,data={}){if(ws?.readyState!==1)return toast('서버 연결 중입니다.');ws.send(JSON.stringify({type,...data}));}
function clearBallotPending(){if(ballotTimeout){clearTimeout(ballotTimeout);ballotTimeout=null;}pendingBallot=null;}
function connect(){const socket=ws=new WebSocket((location.protocol==='https:'?'wss:':'ws:')+'//'+location.host);ws.onopen=()=>{connected=true;retryDelay=1600;if(session)emit('resume',session);else render();};ws.onclose=()=>{if(ws!==socket)return;clearBallotPending();connected=false;render();setTimeout(connect,retryDelay);retryDelay=Math.min(Math.round(retryDelay*1.5),10000)};ws.onmessage=e=>{if(ws!==socket)return;const m=JSON.parse(e.data);if(m.type==='error'){pendingSeat=null;clearBallotPending();toast(m.message);if(m.message.includes('기존 참가자 정보를')){session=null;sessionStorage.removeItem('avalonSession');state=null;render();}}if(m.type==='ballotAck'){clearBallotPending();if(state?.phase===m.phase)render();return;}if(m.type==='joined'){session={code:m.code,token:m.token};sessionStorage.setItem('avalonSession',JSON.stringify(session));}if(m.type==='left'){session=null;sessionStorage.removeItem('avalonSession');state=null;}if(m.type==='state'){pendingSeat=null;const previousPhase=state?.phase;if(previousPhase!==m.state.phase){secretVisible=false;selected=[];confirmVote=null;openedQuest=null;}state=m.state;if(pendingBallot&&(state.phase!==pendingBallot.phase||(pendingBallot.phase==='approval'&&state.hasApproved)||(pendingBallot.phase==='quest'&&state.hasQuestVoted)))clearBallotPending();if(previousPhase==='proposal'&&state.phase==='proposal'&&state.me.id===state.leaderId&&Array.isArray(state.draftTeam)&&state.draftTeam.join('|')===selected.join('|')){refreshQuestSelection();return;}}render();if(m.type==='state'){if(openedQuest!==null)showQuestPeek(openedQuest);processSwapNotice();}};}
function submitBallot(type,payload){
 const phase=type==='approve'?'approval':'quest';
 if(!connected||state?.phase!==phase)return toast('게임 상태가 변경됐습니다. 다시 확인해주세요.');
 if(pendingBallot?.phase===phase)return toast('서버 투표 접수 확인 중입니다.');
 if((phase==='approval'&&state.hasApproved)||(phase==='quest'&&state.hasQuestVoted))return toast('이미 제출했습니다.');
 pendingBallot={phase,type};emit(type,payload);render();ballotTimeout=setTimeout(()=>{if(!pendingBallot||pendingBallot.phase!==phase)return;clearBallotPending();toast('서버의 투표 접수 확인이 늦어지고 있습니다. 접수 여부를 확인한 뒤 다시 시도해주세요.');render();},4500);
}
function phaseRibbon(){
 if(!state||['lobby','ended'].includes(state.phase))return '';
 const labels={reveal:'비밀 역할 확인',proposal:'원정팀 선정',approval:'원정팀 찬반 투표',quest:'원정 비밀 투표',questResult:'원정 결과',assassin:'멀린 암살'};
 const leader=state.players.find(p=>p.id===state.leaderId)?.name||'미정';
 const round=Math.min(state.questIndex+1,5);
 const needed=state.questSizes?.[state.questIndex];
 const role=state.phase==='reveal'?'직업 확인 중':state.phase==='assassin'?'최종 판정':state.me?.id===state.leaderId?'내가 리더':'리더 '+leader;
 return `<div class="phase-ribbon" role="status" aria-label="현재 게임 진행 단계"><div class="phase-ribbon-main"><span class="phase-round">${round}차 원정</span><strong>${labels[state.phase]||'원정 진행'}</strong></div><div class="phase-ribbon-meta"><span>${esc(role)}</span>${needed&&state.phase!=='reveal'&&state.phase!=='assassin'?`<span>원정 ${needed}명</span>`:''}</div></div>`;
}
function layout(inner){const playing=!!state&&state.phase!=='lobby';const logo=playing?`<header class="mast inline-mast"><h1>AVALON</h1><span class="connection ${connected?'connected':'disconnected'}" role="status">${connected?'● 연결됨':'● 연결 끊김'}</span></header>`:`<header class="mast lobby-mast"><div class="mast-copy"><div class="eyebrow">OFFLINE PARTY COMPANION</div><h1>AVALON</h1><div class="sub">대화는 함께 · 진행은 간편하게</div></div><span class="connection ${connected?'connected':'disconnected'}" role="status">${connected?'● 연결됨':'● 연결 끊김'}</span></header>`;el.innerHTML=`${logo}${!connected?'<div class="notice center">● 서버 재연결 중...</div>':''}${phaseRibbon()}${inner}${playing?'':`<div class="footer">AVALON COMPANION · v1.29</div>`}`;}


// In-app confirmation dialog; explicit buttons avoid browser-native confirm popups.
function askConfirm(title,message,onAccept,acceptLabel='확인',danger=false,onCancel=null){
 document.getElementById('avalon-dialog')?.remove();
 const overlay=document.createElement('div');overlay.className='dialog-overlay';overlay.id='avalon-dialog';
 overlay.innerHTML=`<div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div class="dialog-emblem">✦</div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(message)}</p><div class="dialog-actions"><button type="button" data-dialog="accept" class="${danger?'red':'gold-action'}">${esc(acceptLabel)}</button><button type="button" data-dialog="cancel" class="ghost">취소</button></div></div>`;
 document.body.append(overlay);
 overlay.querySelector('[data-dialog="cancel"]').addEventListener('click',()=>{overlay.remove();onCancel?.();});
 overlay.querySelector('[data-dialog="accept"]').addEventListener('click',()=>{overlay.remove();onAccept();});
 overlay.addEventListener('click',e=>{if(e.target===overlay){overlay.remove();onCancel?.();}});
 overlay.querySelector('[data-dialog="accept"]').focus();
}
function showQuestPeek(index){
 const box=document.getElementById('quest-peek');if(!box||!state)return;
 const attempts=state.approvalHistory.filter(a=>a.quest===index+1);
 const result=state.results.find(r=>r.quest===index+1);
 const playerName=id=>esc(state.players.find(p=>p.id===id)?.name||'?');
 const teamChips=team=>`<div class="peek-chip-row">${team.map(id=>`<span class="peek-chip team">${playerName(id)}</span>`).join('')}</div>`;
 const voteChips=votes=>`<div class="peek-chip-row votes">${votes.map(v=>`<span class="peek-chip ${v.vote?'yes':'no'}">${playerName(v.id)} · ${v.vote?'찬성':'반대'}</span>`).join('')}</div>`;
 box.innerHTML=`<div class="peek-head"><b>${index+1}차 원정 기록</b></div>${attempts.length?attempts.map((a,i)=>`<div class="peek-entry"><div class="peek-label">${i+1}차 팀 구성</div>${teamChips(a.team)}<div class="peek-label vote">투표 결과 ${a.votes.filter(v=>v.vote).length>a.votes.filter(v=>!v.vote).length?'<span class="good">승인</span>':'<span class="bad">부결</span>'}</div>${voteChips(a.votes)}</div>`).join(''):'<p>아직 투표 기록이 없습니다.</p>'}${result?`<div class="peek-outcome ${result.success?'good':'bad'}">원정 ${result.success?'성공':'실패'} · 실패표 ${result.fails}장</div>`:''}`;
 box.hidden=false;
}
function hideQuestPeek(){const box=document.getElementById('quest-peek');if(box)box.hidden=true;}

function button(label,fn,cls=''){return `<button class="${cls}" data-act="${fn}">${label}</button>`;}
function playerRow(p,selected=false){return `<div class="player ${selected?'selected selectable':''}" ${selected?'data-pick="'+p.id+'"':''}><span class="dot ${p.online?'':'off'}"></span><span>${esc(p.name)}</span>${p.id===state.hostId?'<span class="pill">방장</span>':''}${p.id===state.me.id?'<span class="tiny gold">나</span>':''}</div>`;}
function board(){let s=state;return `<div class="panel board-panel"><div class="row"><span class="gold">원정 진행 현황</span><span class="pill">${Math.min(s.questIndex+1,5)} / 5</span></div><div class="grid" style="margin-top:12px">${s.questSizes.map((size,i)=>{let result=s.results[i];return `<button type="button" class="tile quest-tile ${result?(result.success?'good':'bad'):''}" data-quest-peek="${i}" aria-label="${i+1}차 원정 기록, 누르고 있는 동안 보기">${result?(result.success?'✓':'✕'):'♜'}<small>${size}명</small></button>`}).join('')}</div><div class="row" style="margin-top:10px"><span class="good">선 성공 ${s.successes}회</span><span class="bad">악 성공 ${s.failures}회</span></div>${s.phase!=='ended'?`<div class="tiny muted" style="margin-top:7px">리더: ${esc(s.players.find(p=>p.id===s.leaderId)?.name||'미정')} · 연속 부결: ${s.rejects}/5</div>`:''}<div class="tiny muted quest-peek-hint">기록은 원정 칸 터치로 확인</div><div id="quest-peek" class="quest-peek" hidden></div></div>`;}

function history(){
 const grouped={};
 const ensure=q=>grouped[q]||(grouped[q]={quest:q,proposals:[],result:null});
 state.approvalHistory.forEach(a=>{const yes=a.votes.filter(v=>v.vote).length;const no=a.votes.length-yes;ensure(a.quest).proposals.push({leaderId:a.leaderId,team:a.team,yes,no,passed:yes>no});});
 state.results.forEach(r=>{ensure(r.quest).result=r;});
 const quests=Object.values(grouped).sort((a,b)=>a.quest-b.quest);
 if(!quests.length)return '';
 return `<div class="panel history-panel"><div class="row"><h3>지난 원정 기록</h3><span class="pill">${quests.length}개 라운드</span></div><div class="quest-log">${quests.map(group=>`<div class="quest-card ${group.result?(group.result.success?'success':'fail'):''}"><div class="quest-card-head"><b>${group.quest}차 원정</b>${group.result?`<span class="quest-outcome ${group.result.success?'good':'bad'}">${group.result.success?'성공':'실패'}</span>`:''}</div>${group.proposals.map((p,idx)=>`<div class="quest-line"><span class="quest-step">${idx+1}팀</span><div class="quest-body"><div class="quest-team">${p.team.map(id=>esc(state.players.find(x=>x.id===id)?.name||id)).join(' · ')}</div><div class="quest-meta">찬성 ${p.yes} · 반대 ${p.no} · <span class="${p.passed?'good':'bad'}">${p.passed?'승인':'부결'}</span></div></div></div>`).join('')}${group.result?`<div class="quest-line quest-result-line"><span class="quest-step">결과</span><div class="quest-body"><div class="quest-meta"><span class="${group.result.success?'good':'bad'}">원정 ${group.result.success?'성공':'실패'}</span>${group.result.fails?` · 실패표 ${group.result.fails}장`:''}</div></div></div>`:''}</div>`).join('')}</div></div>`;
}
function tableView(mode='lobby') {
 const s=state,n=s.players.length,host=s.hostId===s.me.id,leader=s.leaderId;
  const seatPlayers=new Map(s.players.filter(p=>p.seat!==null).map(p=>[p.seat,p]));
 const allowPick=mode==='proposal'&&leader===s.me.id;
 const activeTeam=mode==='proposal'?(allowPick?selected:s.draftTeam||[]):s.proposal||[];
 let central='';
 if(mode==='lobby')central=`<b>착석 대기</b><small>${s.players.filter(x=>x.seat!==null).length}/${n}명 착석</small><small>${s.players.filter(x=>x.ready).length}/${n}명 준비 완료</small>`;
 else if(mode==='proposal')central=`<b>${s.questIndex+1}차 원정</b><small class="proposal-table-count">원정팀 ${activeTeam.length}/${s.questSizes[s.questIndex]}명</small><small>리더: ${esc(s.players.find(p=>p.id===leader)?.name||'')}</small>`;
 else if(mode==='approval')central=`<b>찬반 투표</b><small>${s.approvalCount}/${n}명 제출</small>${s.hasApproved?'<small>✓ 투표 접수 완료</small>':pendingBallot?.phase==='approval'?'<small>투표 전송 중…</small>':`<div class="table-votes">${button('찬성','yes','blue')}${button('반대','no','red')}</div>`}`;
 else if(mode==='quest')central=`<b>비밀 원정</b><small>${s.questCount}/${s.proposal.length}명 제출</small>`;
 else if(mode==='questResult')central=`<b>${s.latest?.success?'원정 성공':'원정 실패'}</b><small>실패표 ${s.latest?.fails}장</small>`;
 else if(mode==='assassin')central='<b>멀린 암살</b><small>최후의 추리</small>';
 else if(mode==='ended')central=`<b>${s.winner==='good'?'선 진영 승리':'악 진영 승리'}</b>`;
 const emptyHint=mode==='lobby'?'빈 좌석 선택':'빈 좌석';
 const seats=Array.from({length:n},(_,i)=>{
   const p=seatPlayers.get(i);
   const a=Math.PI/2+(2*Math.PI*i/n);
   const x=(50+42*Math.cos(a)).toFixed(2),y=(50+39*Math.sin(a)).toFixed(2);
   const mine=p?.id===s.me.id,team=p&&activeTeam.includes(p.id),chief=p?.id===leader;
   const clickable=mode==='lobby'?true:allowPick&&!!p;
   const readableLabel=p?`${p.name}${mine?' (내 자리)':''}${chief?' (원정 리더)':''}${team?' (원정팀 선택)':''}`:`${i+1}번 빈 좌석`;
   let label=p?`${esc(p.name)}${mine?' · 나':''}`:emptyHint;
   const info=mode==='lobby'?(p?(p.ready?'✓ 준비 완료':(mine?'다시 눌러 자리 비우기':'교환 요청')):'앉기'):team?'✦ 원정팀':mode==='approval'&&s.approvalVotes? (s.approvalVotes.find(x=>x.id===p.id)?.vote?'찬성':'반대') : '';
   return `<button type="button" data-player-id="${p?.id||''}" class="table-seat ${p?'occupied':'empty'} ${mine?'mine':''} ${team?'on-quest':''} ${chief?'leader-seat':''} ${p?.ready?'is-ready':''}" style="left:${x}%;top:${y}%" aria-label="${esc(readableLabel)}" aria-pressed="${mode==='proposal'&&!!team}" ${clickable?(mode==='lobby'?`data-seat="${i}"`:`data-pick="${p.id}"`):'disabled'}><span class="seat-name">${label}</span><span class="seat-info">${info}</span></button>`;
 }).join('');
 return `<div class="panel table-panel ${mode!=='lobby'&&s.me.id===leader?'i-am-leader':''}"><div class="row"><span class="gold">${mode==='lobby'?'원탁 자리 배치':'원탁 진행 상황'}</span><span class="pill">${n}인 게임</span></div><div class="table-stage"><img class="table-art" src="/avalon-table.png" alt="황금 문양의 중세 타원형 원탁"><div class="table-center">${central}</div>${seats}</div><p class="table-help">${mode==='lobby'?'실제 착석 위치에 해당하는 빈 좌석을 터치하세요. 준비 완료한 자리는 초록색으로 표시됩니다.':mode==='proposal'?'리더는 원정에 보낼 플레이어 좌석을 터치하세요.':mode==='approval'?'테이블 중앙에서 찬성 또는 반대를 제출하세요.':'자리 위치는 게임 시작 후 유지됩니다.'}</p></div>`;
}
function lobby(){const s=state,isHost=s.hostId===s.me.id,settings=s.settings;
 const readyAction=s.me.seat!==null?button(s.me.ready?'준비 취소':'✓ 준비 완료','ready',s.me.ready?'ghost':'green'):'<div class="notice">테이블에서 먼저 빈 좌석을 선택하세요.</div>';
 layout(`<div class="panel invite-panel"><div class="row"><div><span class="tiny muted">게임 방 코드</span><br><code class="room-mark">${s.code}</code></div><span class="pill live">대기실</span></div><div class="qr-wrap"><img class="qr-image" src="/qr.svg?url=${encodeURIComponent(inviteUrl())}" alt="초대 QR 코드"></div></div>${tableView('lobby')}<div class="panel ready-panel">${readyAction}</div>${isHost?`<div class="panel"><h2>특수 역할 설정</h2><div class="hint">멀린과 암살자는 항상 포함됩니다.</div>${[['percival','퍼시벌'],['morgana','모르가나'],['mordred','모드레드'],['oberon','오베론']].map(([key,title])=>`<label class="check"><span>${title}</span><input type="checkbox" data-setting="${key}" ${settings[key]?'checked':''}></label>`).join('')}<button data-act="start" ${s.players.length<5||s.players.some(p=>p.seat===null||!p.ready||!p.online)?'disabled':''}>게임 시작 (${s.players.filter(p=>p.ready).length}/${s.players.length}명 준비)</button></div>`:`<div class="panel center"><div class="muted">모두 준비되면 방장이 시작합니다.</div></div>`}${button('대기실 나가기','leave','ghost')}`);
}
function reveal(){const s=state;let p=s.me;layout(`<div class="panel center"><span class="pill">비밀 역할 확인</span><div class="space"></div>${secretVisible?`<img class="secret-role-art" src="${roleImages[p.role]}" alt="${esc(names[p.role])} 캐릭터 일러스트"><div class="role">${esc(names[p.role])}</div><div class="${p.alignment==='good'?'good':'bad'}">${p.alignment==='good'?'선의 진영':'악의 진영'}</div><div class="line"></div><h3>당신에게 공개되는 정보</h3>${p.knowledge.length?p.knowledge.map(x=>`<div class="notice">${esc(x.name)} · ${esc(x.hint)}</div>`).join(''):'<p class="muted">추가로 알 수 있는 참가자 정보가 없습니다.</p>'}<p class="hint">이 정보는 비밀입니다. 주변 사람이 화면을 보지 않도록 주의하세요.</p>${!s.hasRevealed?button('역할 확인 완료','revealed'): '<div class="pill live">확인 완료</div>'}${button('역할 정보 숨기기','toggleSecret','ghost')}`:`<div style="font-size:70px;margin:28px">🛡️</div><h2>나만의 비밀 역할</h2><p class="muted">주변에서 화면을 볼 수 없는지 확인하세요.</p>${button('역할 확인하기','toggleSecret')}`}</div><div class="panel center"><h3>다른 참가자 확인 대기</h3><div class="count">${s.revealedCount} / ${s.players.length}</div><div class="hint">각자 휴대폰에서 확인 완료를 누르면 자동으로 원정을 시작합니다.</div></div>`);}
function proposal(){let s=state;let leader=s.me.id===s.leaderId;let n=s.questSizes[s.questIndex];layout(board()+tableView('proposal')+`<div class="panel action-panel"><div class="row"><b>${leader?'원정팀 확정':'리더 선정 대기'}</b><span class="pill">${selected.length||s.draftTeam?.length||0}/${n}명</span></div>${leader?`<p class="center muted" id="proposal-selected-count">선택 ${selected.length} / ${n}</p><div class="selected-players" id="proposal-selected-names">${selected.length?selected.map(id=>`<span>${esc(s.players.find(p=>p.id===id)?.name)}</span>`).join(''):'원정팀으로 보낼 플레이어를 선택하세요.'}</div>`+`<button data-act="propose" ${selected.length!==n?'disabled':''}>원정팀 확정 (${selected.length}/${n})</button>`:'<p class="muted">테이블에서 선택된 팀을 확인하세요.</p>'}</div>`);}
// 원정팀 선택 때 화면 전체를 교체하지 않고 바뀐 좌석만 갱신한다.
// 전체 DOM 교체는 연속 터치 중 클릭 대상을 사라지게 할 수 있다.
function refreshQuestSelection(){
 if(state?.phase!=='proposal'||state.me.id!==state.leaderId)return;
 const limit=state.questSizes[state.questIndex];
 document.querySelectorAll('.table-seat[data-pick]').forEach(node=>{
  const on=selected.includes(node.dataset.pick);
  node.classList.toggle('on-quest',on);
  node.setAttribute('aria-pressed',String(on));
  const p=state.players.find(x=>x.id===node.dataset.pick);
  const info=node.querySelector('.seat-info');
  if(info&&p)info.textContent=on?'✦ 원정팀':'';
 });
 const center=document.querySelector('.proposal-table-count');
 if(center)center.textContent=`원정팀 ${selected.length}/${limit}명`;
 const count=document.getElementById('proposal-selected-count');
 if(count)count.textContent=`선택 ${selected.length} / ${limit}`;
 const labels=document.getElementById('proposal-selected-names');
 if(labels)labels.innerHTML=selected.length?selected.map(id=>`<span>${esc(state.players.find(p=>p.id===id)?.name||'')}</span>`).join(''):'원정팀으로 보낼 플레이어를 선택하세요.';
 const submit=document.querySelector('[data-act="propose"]');
 if(submit){submit.disabled=selected.length!==limit;submit.textContent=`원정팀 확정 (${selected.length}/${limit})`;}
}
function approval(){const s=state;layout(board()+tableView('approval')+`<div class="panel center"><div class="pill">원정팀 승인 투표</div><h2 style="margin-top:8px">팀 승인 진행 중</h2><div class="notice">${s.proposal.map(id=>esc(s.players.find(p=>p.id===id)?.name)).join(' · ')}</div>${s.hasApproved?`<h3 class="good">투표 제출 완료</h3><p class="muted">모든 사람이 제출하면 결과가 공개됩니다.</p>`:`<p class="hint">테이블 중앙에서 투표를 선택하세요.</p>`}<div class="progress"><div style="width:${s.approvalCount/s.players.length*100}%"></div></div><div class="tiny muted">${s.approvalCount} / ${s.players.length}명 투표 완료</div></div>`);}
function quest(){const s=state;const participant=s.proposal.includes(s.me.id);layout(board()+tableView('quest')+`<div class="panel center"><span class="pill">2단계 · 원정 성공/실패 비밀 투표 (원정팀만)</span><h2 style="margin-top:8px">${participant?(s.hasQuestVoted?'투표 접수 완료':pendingBallot?.phase==='quest'?'투표 전송 중…':'원정 결과를 선택하세요'):'원정팀의 선택을 기다리는 중'}</h2><div class="notice">참가자: ${s.proposal.map(id=>esc(s.players.find(p=>p.id===id)?.name)).join(' · ')}</div>${participant&&!s.hasQuestVoted&&pendingBallot?.phase!=='quest'?`<p class="hint">성공·실패 선택은 다른 참가자에게 공개되지 않습니다.</p>${button('원정 성공','questSuccess','blue')}${s.me.alignment==='evil'?button('원정 실패','questFail','red'):''}`:`<p class="good">${participant?(pendingBallot?.phase==='quest'?'투표 전송 중…':'✓ 비밀표 서버 접수 완료'):'원정 진행 중'}</p>`}<div class="progress"><div style="width:${s.questCount/s.proposal.length*100}%"></div></div><div class="tiny muted">${s.questCount} / ${s.proposal.length}명 제출 완료</div><div class="quest-voter-status">${s.proposal.map(id=>{const p=s.players.find(p=>p.id===id);const voted=(s.questVotedIds||[]).includes(id);return `<span class="voter-chip ${voted?'voted':'waiting'}">${esc(p?.name||'?')} · ${voted?'제출 완료':'대기'}</span>`}).join('')}</div></div>`);}
function questResult(){const s=state;layout(board()+tableView('questResult')+`<div class="panel center"><span class="pill">원정 결과 발표</span><div style="font-size:66px;margin:15px">${s.latest?.success?'🏆':'⚔️'}</div><h2 class="${s.latest?.success?'good':'bad'}">${s.latest?.quest}차 원정 ${s.latest?.success?'성공':'실패'}</h2><p>실패표 ${s.latest?.fails}장</p><p class="hint">어떤 참가자가 실패표를 제출했는지는 공개되지 않습니다.</p><div class="hint">지난 결과는 원정 칸을 누르고 있는 동안 확인할 수 있습니다.</div></div>`);}
function assassin(){const s=state;const isAssassin=s.me.role==='Assassin';layout(board()+tableView('assassin')+`<div class="panel"><h2 class="center">마지막 기회 · 멀린 암살</h2><p class="hint center">선의 진영이 원정 3회에 성공했습니다. 암살자가 멀린을 찾아내면 악의 진영이 역전합니다.</p>${isAssassin?`<h3>멀린으로 의심하는 참가자 선택</h3>${s.players.filter(p=>p.id!==s.me.id).map(p=>`<div class="player selectable ${selected.includes(p.id)?'selected':''}" data-pick="${p.id}"><span>${selected.includes(p.id)?'☑':'□'}</span><span>${esc(p.name)}</span></div>`).join('')}${button('최종 암살 지목','assassinate','red')}`:'<div class="notice center">암살자가 멀린을 선택하고 있습니다. 현장에서 마지막 추리와 토론을 진행하세요.</div>'}</div>`);}
function ended(){
 const s=state,good=s.winner==='good';
 const sorted=[...s.roles].sort((a,b)=>{const sa=s.players.find(p=>p.id===a.id)?.seat??99,sb=s.players.find(p=>p.id===b.id)?.seat??99;return sa-sb;});
 const roleCards=sorted.map(p=>`<div class="end-role ${p.alignment==='good'?'end-good':'end-evil'}"><img class="end-role-art" src="${roleImages[p.role]}" loading="lazy" alt=""><span class="end-role-name">${esc(p.name)}</span><span class="end-role-title">${esc(names[p.role])}</span></div>`).join('');
 layout(`<section class="panel end-hero ${good?'end-good-win':'end-evil-win'}"><span class="end-overline">GAME OVER · 최종 결과</span><div class="end-symbol">${good?'♛':'⚔'}</div><h2>${good?'선의 진영 승리':'악의 진영 승리'}</h2><p>${esc(s.reason)}</p><div class="end-summary"><span>원정 성공 ${s.successes}회</span><span>원정 실패 ${s.failures}회</span></div>${s.hostId===s.me.id?button('같은 멤버로 다시 시작','reset'):'<div class="hint">방장이 새 게임을 시작할 수 있습니다.</div>'}</section><section class="panel end-roster"><div class="row"><h3>모든 플레이어 정체 공개</h3><span class="pill">${sorted.length}명</span></div><div class="end-roles">${roleCards}</div></section>`+board());
}
function processSwapNotice(){
 const req=state?.swapRequest;
 if(!req){seenSwapKey='';return;}
 if(req.to!==state.me.id)return;
 const key=req.from+':'+req.expires;
 if(key===seenSwapKey)return;
 seenSwapKey=key;
 const person=state.players.find(p=>p.id===req.from);
 askConfirm('자리 교환 요청',`${person?.name||'다른 참가자'}님이 자리 교환을 요청했습니다. 수락하면 서로 좌석이 바뀌고 준비 상태가 해제됩니다.`,()=>emit('swapReply',{accept:true}),'교환 수락',false,()=>emit('swapReply',{accept:false}));
}
function render(){if(!state){layout(`<div class="panel"><h2>게임 시작하기</h2><p class="hint">각자 스마트폰으로 접속해 대면 토론을 하면서 진행합니다.</p>${!(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone)?'<button class="ghost install-app" data-act="installApp" type="button">📲 홈 화면에 AVALON 설치하기</button>':''}<input id="name" maxlength="18" placeholder="닉네임" autocomplete="nickname"><button data-act="create">새로운 방 만들기</button><div class="line"></div><input id="code" maxlength="4" inputmode="numeric" pattern="[0-9]{4}" placeholder="방 코드 숫자 4자리" value="${esc((new URLSearchParams(location.search).get('room')||'').replace(/\D/g,'').slice(0,4))}"><button class="ghost" data-act="join">기존 방 참가하기</button></div><div class="footer">같은 Wi-Fi 또는 인터넷 연결이 필요합니다.</div>`);return;}
 if(state.phase==='lobby')lobby();else if(state.phase==='reveal')reveal();else if(state.phase==='proposal')proposal();else if(state.phase==='approval')approval();else if(state.phase==='quest')quest();else if(state.phase==='questResult')questResult();else if(state.phase==='assassin')assassin();else if(state.phase==='ended')ended();if(openedQuest!==null)showQuestPeek(openedQuest);}
document.addEventListener('click',async e=>{const seat=e.target.closest('[data-seat]');if(seat&&state?.phase==='lobby'){const clicked=Number(seat.dataset.seat);const next=state.me.seat===clicked?null:clicked;if(!connected)return toast('서버에 연결 중입니다.');if(next!==null&&state.players.some(p=>p.id!==state.me.id&&p.seat===next)){
 const other=state.players.find(p=>p.id!==state.me.id&&p.seat===next);
 if(state.me.seat===null)return toast('먼저 빈 좌석에 착석해주세요.');
 return askConfirm('자리 교환 요청',`${other.name}님에게 자리 교환을 요청하시겠습니까? 상대가 동의해야 교환됩니다.`,()=>emit('swapRequest',{target:other.id}),'교환 요청',false);
 }emit('seat',{seat:next});return;}const pick=e.target.closest('[data-pick]');if(pick){const id=pick.dataset.pick;if(state.phase==='assassin')selected=[id];else if(state.phase==='proposal'){if(state.me.id!==state.leaderId)return;const max=state.questSizes[state.questIndex];if(selected.includes(id))selected=selected.filter(x=>x!==id);else if(selected.length<max)selected=[...selected,id];else return toast(`이번 원정은 ${max}명까지만 선택할 수 있습니다.`);refreshQuestSelection();emit('draftTeam',{ids:selected});return;}else selected=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id];render();return;}const act=e.target.closest('[data-act]')?.dataset.act;if(!act)return;switch(act){case 'installApp':{if(deferredInstallPrompt){const p=deferredInstallPrompt;deferredInstallPrompt=null;await p.prompt();}else if(/iPad|iPhone|iPod/.test(navigator.userAgent)){toast('Safari의 공유 버튼 → 홈 화면에 추가를 선택해 주세요.');}else{toast('브라우저 메뉴(⋮) → 홈 화면에 추가 또는 앱 설치를 선택해 주세요.');}break;}case 'create':emit('create',{name:document.getElementById('name').value});break;case 'join':{const entered=document.getElementById('code').value.trim();if(!/^\d{4}$/.test(entered))return toast('숫자 4자리 방 코드를 입력해주세요.');emit('join',{name:document.getElementById('name').value,code:entered});break;}case 'copy':{const url=inviteUrl();try{if(navigator.share)await navigator.share({title:'아발론 게임 참가',url});else{await navigator.clipboard.writeText(url);toast('초대 링크를 복사했습니다.');}}catch{window.prompt('이 링크를 복사해서 공유하세요.',url);}break;}case 'start':emit('start');break;case 'ready':emit('ready',{ready:!state.me.ready});break;case 'leave':askConfirm('대기실 나가기','현재 게임 방에서 나가시겠습니까?',()=>emit('leave'),'나가기',true);break;case 'toggleSecret':secretVisible=!secretVisible;render();break;case 'revealed':secretVisible=false;emit('revealed');break;case 'propose':if(selected.length!==state.questSizes[state.questIndex])return toast('원정 인원수를 맞춰주세요.');emit('propose',{ids:selected});break;case 'yes':askConfirm('원정팀 승인 투표','선정된 원정팀에 찬성하시겠습니까? 제출 후 변경할 수 없습니다.',()=>submitBallot('approve',{vote:true}),'찬성 제출',false);break;case 'no':askConfirm('원정팀 승인 투표','선정된 원정팀에 반대하시겠습니까? 제출 후 변경할 수 없습니다.',()=>submitBallot('approve',{vote:false}),'반대 제출',true);break;case 'questSuccess':askConfirm('비밀 원정 투표','원정 성공표를 제출하시겠습니까? 비밀 투표이며 제출 후 변경할 수 없습니다.',()=>submitBallot('questVote',{success:true}),'성공 제출',false);break;case 'questFail':askConfirm('비밀 원정 투표','원정 실패표를 제출하시겠습니까? 비밀 투표이며 제출 후 변경할 수 없습니다.',()=>submitBallot('questVote',{success:false}),'실패 제출',true);break;case 'assassinate':if(selected.length!==1)return toast('한 명을 선택해주세요.');{const target=selected[0];askConfirm('최종 암살 지목',`${state.players.find(p=>p.id===target)?.name}님을 멀린으로 지목하시겠습니까?`,()=>emit('assassinate',{target}),'최종 지목',true);}break;case 'reset':emit('reset');break;}});
document.addEventListener('change',e=>{if(e.target.id==='shareBase'){shareBase=e.target.value;render();return;}const key=e.target.dataset.setting;if(key)emit('settings',{settings:{...state.settings,[key]:e.target.checked}});});
document.addEventListener('input',e=>{if(e.target.id==='code')e.target.value=e.target.value.replace(/\D/g,'').slice(0,4);});
connect();render();

// 한 번 누르면 열고, 다시 누르면 닫는 기록 상세 보기
 document.addEventListener('click',e=>{const tile=e.target.closest('[data-quest-peek]');if(!tile)return;
 const index=Number(tile.dataset.questPeek);
 if(openedQuest===index){openedQuest=null;hideQuestPeek();}else{openedQuest=index;showQuestPeek(index);}
 document.querySelectorAll('.quest-tile').forEach(x=>x.classList.toggle('peeking',Number(x.dataset.questPeek)===openedQuest));
});
