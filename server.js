import http from 'node:http';
import { WebSocketServer } from 'ws';
import { randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();
const sizes = {5:[2,3,2,3,3],6:[2,3,4,3,4],7:[2,3,3,4,4],8:[3,4,4,5,5],9:[3,4,4,5,5],10:[3,4,4,5,5]};
const evils = {5:2,6:2,7:3,8:3,9:3,10:4};
const uid = () => randomBytes(18).toString('hex');
const code = () => String(randomInt(0, 10000)).padStart(4, '0');
const send = (ws,payload) => { if(ws?.readyState===1) ws.send(JSON.stringify(payload)); };
const error = (ws,message) => send(ws,{type:'error',message});
const own = (r,player)=>({id:player.id,name:player.name,role:player.role,alignment:player.alignment,seat:player.seat??null,ready:!!player.ready,knowledge:knowledge(r,player)});
function knowledge(r,p) {
  if(!p.role) return [];
  if(p.role==='Merlin') return r.players.filter(x=>x.alignment==='evil'&&x.role!=='Mordred').map(x=>({name:x.name,hint:'악의 진영'}));
  if(p.role==='Percival') return r.players.filter(x=>['Merlin','Morgana'].includes(x.role)).map(x=>({name:x.name,hint:'멀린 또는 모르가나'}));
  if(p.alignment==='evil' && p.role!=='Oberon') return r.players.filter(x=>x.alignment==='evil' && x.id!==p.id && x.role!=='Oberon').map(x=>({name:x.name,hint:'악의 동료'}));
  return [];
}
function visible(r,p) {
  return {code:r.code,phase:r.phase,hostId:r.hostId,me:own(r,p),players:r.players.map(x=>({id:x.id,name:x.name,online:!!x.ws&&x.ws.readyState===1,seat:x.seat??null,ready:!!x.ready})),settings:r.settings,leaderId:r.players[r.leader]?.id,questIndex:r.questIndex,questSizes:sizes[r.players.length]||[],proposal:r.proposal,draftTeam:r.phase==='proposal'?r.draftTeam||[]:[],rejects:r.rejects,approvalCount:Object.keys(r.approvals).length,approvedIds:r.phase==='approval'?Object.keys(r.approvals):[],approvalVotes:r.lastApprovals,approvalHistory:r.approvalHistory,questCount:Object.keys(r.questVotes).length,questVotedIds:r.phase==='quest'?Object.keys(r.questVotes):[],hasApproved:r.approvals[p.id]!==undefined,hasQuestVoted:r.questVotes[p.id]!==undefined,hasRevealed:r.revealed.has(p.id),revealedCount:r.revealed.size,successes:r.results.filter(x=>x.success).length,failures:r.results.filter(x=>!x.success).length,results:r.results,latest:r.latest,nextQuestAt:r.nextQuestAt??null,winner:r.winner,reason:r.reason,swapRequest:r.swapRequest&&[r.swapRequest.from,r.swapRequest.to].includes(p.id)?{from:r.swapRequest.from,to:r.swapRequest.to,expires:r.swapRequest.expires}:null,roles:r.phase==='ended'?r.players.map(x=>({id:x.id,name:x.name,role:x.role,alignment:x.alignment})):null};
}
function broadcast(r) {for(const p of r.players) send(p.ws,{type:'state',state:visible(r,p)});}
function win(r,side,reason) {if(r.advanceTimer)clearTimeout(r.advanceTimer);r.advanceTimer=null;r.nextQuestAt=null;r.phase='ended';r.winner=side;r.reason=reason;r.latest=null;}
function nextLeader(r) {r.leader=(r.leader+1)%r.players.length;}
function onAction(ws,msg) {
  if(!msg||typeof msg!=='object'||typeof msg.type!=='string') return;
  if(msg.type==='create') {
    const name=String(msg.name||'').trim().slice(0,18);
    if(!name) return error(ws,'닉네임을 입력해주세요.');
    let c;do{c=code();}while(rooms.has(c));
    const id=uid(), token=uid();
    const p={id,token,name,ws,role:null,alignment:null,seat:null,ready:false};
    const r={code:c,phase:'lobby',players:[p],hostId:id,settings:{percival:true,morgana:true,mordred:false,oberon:false},leader:0,questIndex:0,proposal:[],draftTeam:[],approvals:{},lastApprovals:null,approvalHistory:[],questVotes:{},revealed:new Set(),rejects:0,results:[],latest:null,winner:null,reason:null,swapRequest:null,created:Date.now()};
    rooms.set(c,r);ws.room=c;ws.player=id;send(ws,{type:'joined',code:c,token,id});broadcast(r);return;
  }
  if(msg.type==='join'||msg.type==='resume') {
    const c=String(msg.code||'').trim();if(!/^\d{4}$/.test(c))return error(ws,'방 코드는 숫자 4자리입니다.');const r=rooms.get(c);
    if(!r) return error(ws,'방을 찾을 수 없습니다.');
    let p=msg.token?r.players.find(x=>x.token===msg.token):null;
    if(!p){if(msg.type==='resume') return error(ws,'기존 참가자 정보를 찾지 못했습니다.');if(r.phase!=='lobby') return error(ws,'이미 시작된 게임입니다. 이전에 참가했다면 같은 브라우저에서 재접속하세요.');if(r.players.length>=10) return error(ws,'최대 10명까지 참가할 수 있습니다.');const name=String(msg.name||'').trim().slice(0,18);if(!name) return error(ws,'닉네임을 입력해주세요.');if(r.players.some(x=>x.name===name)) return error(ws,'이미 사용 중인 닉네임입니다.');p={id:uid(),token:uid(),name,ws:null,role:null,alignment:null,seat:null,ready:false};r.players.push(p);}
    if(p.ws&&p.ws!==ws){send(p.ws,{type:'error',message:'동일 참가자가 다른 창에서 접속했습니다. 각 창에서 새로 방에 참가해주세요.'});p.ws.close(4000,'another session');}p.ws=ws;ws.room=c;ws.player=p.id;send(ws,{type:'joined',code:c,token:p.token,id:p.id});broadcast(r);return;
  }
  const r=rooms.get(ws.room);const p=r?.players.find(x=>x.id===ws.player&&x.ws===ws);
  if(!r||!p) return error(ws,'먼저 방에 참가해주세요.');
  const host=p.id===r.hostId;
  if(msg.type==='swapRequest') {
    if(r.phase!=='lobby'||p.seat===null)return error(ws,'착석한 대기실에서만 교환할 수 있습니다.');
    const to=r.players.find(x=>x.id===msg.target);
    if(!to||to.id===p.id||to.seat===null)return error(ws,'교환할 상대를 확인해주세요.');
    if(r.swapRequest&&r.swapRequest.expires>Date.now())return error(ws,'이미 진행 중인 자리 교환 요청이 있습니다.');
    r.swapRequest={from:p.id,to:to.id,expires:Date.now()+30000};const expires=r.swapRequest.expires;setTimeout(()=>{if(r.swapRequest?.expires===expires){r.swapRequest=null;broadcast(r);}},30000).unref();broadcast(r);return;
  }
  if(msg.type==='swapReply') {
    const request=r.swapRequest;
    if(r.phase!=='lobby'||!request||request.to!==p.id)return error(ws,'유효한 교환 요청이 없습니다.');
    r.swapRequest=null;
    if(request.expires<Date.now())return error(ws,'교환 요청이 만료되었습니다.');
    if(msg.accept===true){const from=r.players.find(x=>x.id===request.from);if(!from||from.seat===null||p.seat===null)return error(ws,'좌석이 변경되어 교환할 수 없습니다.');
      [from.seat,p.seat]=[p.seat,from.seat];from.ready=false;p.ready=false;
    }
    broadcast(r);return;
  }
  if(msg.type==='seat') {
    if(r.phase!=='lobby')return error(ws,'대기실에서만 좌석을 변경할 수 있습니다.');
    const seat=msg.seat;
    if(seat!==null&&(!Number.isInteger(seat)||seat<0||seat>=r.players.length))return error(ws,'유효하지 않은 좌석입니다.');
    if(seat!==null&&r.players.some(x=>x.id!==p.id&&x.seat===seat))return error(ws,'이미 다른 플레이어가 착석한 자리입니다.');
    p.seat=seat;p.ready=false;r.swapRequest=null;broadcast(r);return;
  }
  if(msg.type==='ready') {
    if(r.phase!=='lobby'||p.seat===null)return error(ws,'먼저 빈 좌석을 선택해주세요.');
    p.ready=!!msg.ready;broadcast(r);return;
  }
  if(msg.type==='settings') {if(!host||r.phase!=='lobby') return error(ws,'대기실 방장만 설정할 수 있습니다.');const input=msg.settings||{};r.settings={percival:!!input.percival,morgana:!!input.morgana,mordred:!!input.mordred,oberon:!!input.oberon};broadcast(r);return;}
  if(msg.type==='start') {
    if(!host||r.phase!=='lobby') return error(ws,'대기실 방장만 시작할 수 있습니다.');const n=r.players.length;if(n<5||n>10) return error(ws,'아발론은 5~10명이 필요합니다.');if(r.players.some(x=>x.seat===null||!x.ready||!x.ws||x.ws.readyState!==1)) return error(ws,'모든 참가자가 착석하고 준비 완료 및 접속 상태를 확인해야 합니다.');r.players.sort((a,b)=>a.seat-b.seat);
    const goodRoles=['Merlin'];if(r.settings.percival)goodRoles.push('Percival');
    const badRoles=['Assassin'];for(const [flag,role] of [['morgana','Morgana'],['mordred','Mordred'],['oberon','Oberon']])if(r.settings[flag])badRoles.push(role);
    if(badRoles.length>evils[n]) return error(ws,`악 진영 특수 역할이 너무 많습니다. ${n}명 게임의 악 진영은 ${evils[n]}명입니다.`);
    const roles=[...goodRoles,...Array(n-evils[n]-goodRoles.length).fill('Loyal Servant'),...badRoles,...Array(evils[n]-badRoles.length).fill('Minion')];
    if(roles.length!==n) return error(ws,'역할 구성을 확인해주세요.');
    for(let i=roles.length-1;i>0;i--){const j=randomBytes(4).readUInt32BE(0)%(i+1);[roles[i],roles[j]]=[roles[j],roles[i]];}
    r.players.forEach((x,i)=>{x.role=roles[i];x.alignment=['Assassin','Morgana','Mordred','Oberon','Minion'].includes(roles[i])?'evil':'good';});
    r.phase='reveal';r.draftTeam=[];r.leader=randomBytes(4).readUInt32BE(0)%n;r.revealed.clear();r.latest=null;broadcast(r);return;
  }
  if(msg.type==='revealed') {if(r.phase!=='reveal')return error(ws,'지금은 역할 확인 단계가 아닙니다.');r.revealed.add(p.id);if(r.revealed.size===r.players.length)r.phase='proposal';broadcast(r);return;}
  if(msg.type==='draftTeam') {
    if(r.phase!=='proposal'||r.players[r.leader].id!==p.id)return error(ws,'원정 리더만 팀을 선택할 수 있습니다.');
    const ids=msg.ids;const needed=sizes[r.players.length][r.questIndex];
    if(!Array.isArray(ids)||ids.length>needed||new Set(ids).size!==ids.length||ids.some(id=>!r.players.some(x=>x.id===id)))return error(ws,'원정팀 선택 정보가 올바르지 않습니다.');
    r.draftTeam=[...ids];broadcast(r);return;
  }
  if(msg.type==='propose') {
    if(r.phase!=='proposal'||r.players[r.leader].id!==p.id) return error(ws,'현재 원정 리더만 제안할 수 있습니다.');
    const ids=Array.isArray(msg.ids)?msg.ids:[];const needed=sizes[r.players.length][r.questIndex];
    if(ids.length!==needed||new Set(ids).size!==needed||ids.some(id=>!r.players.some(x=>x.id===id))) return error(ws,`원정 참가자 ${needed}명을 정확히 선택해주세요.`);
    r.proposal=ids;r.draftTeam=[];r.approvals={};r.lastApprovals=null;r.phase='approval';broadcast(r);return;
  }
  if(msg.type==='approve') {
    if(r.phase!=='approval'||typeof msg.vote!=='boolean')return error(ws,'현재 투표할 수 없습니다.');
    if(r.approvals[p.id]!==undefined){send(ws,{type:'state',state:visible(r,p)});return;}
    r.approvals[p.id]=msg.vote;send(ws,{type:'ballotAck',phase:'approval',accepted:true});
    if(Object.keys(r.approvals).length===r.players.length){r.lastApprovals=r.players.map(x=>({id:x.id,vote:r.approvals[x.id]}));r.approvalHistory.push({quest:r.questIndex+1,leaderId:r.players[r.leader].id,team:[...r.proposal],votes:r.lastApprovals});const yes=Object.values(r.approvals).filter(Boolean).length;
      if(yes>r.players.length/2){r.phase='quest';r.questVotes={};r.latest={kind:'approval',passed:true,yes,no:r.players.length-yes};}
      else{r.rejects++;r.latest={kind:'approval',passed:false,yes,no:r.players.length-yes};if(r.rejects>=5)win(r,'evil','원정팀 제안이 5번 연속 부결되었습니다.');else{nextLeader(r);r.phase='proposal';r.proposal=[];r.draftTeam=[];}}
    }broadcast(r);return;
  }
  if(msg.type==='questVote') {
    if(r.phase!=='quest'||!r.proposal.includes(p.id)||typeof msg.success!=='boolean')return error(ws,'현재 원정 투표를 제출할 수 없습니다.');
    if(r.questVotes[p.id]!==undefined){send(ws,{type:'state',state:visible(r,p)});return;}
    if(p.alignment==='good'&&!msg.success)return error(ws,'선의 진영은 성공만 제출할 수 있습니다.');r.questVotes[p.id]=msg.success;send(ws,{type:'ballotAck',phase:'quest',accepted:true});
    if(Object.keys(r.questVotes).length===r.proposal.length){const fails=Object.values(r.questVotes).filter(x=>!x).length;const threshold=r.players.length>=7&&r.questIndex===3?2:1;const success=fails<threshold;
      r.results.push({quest:r.questIndex+1,team:[...r.proposal],success,fails});r.latest={kind:'quest',quest:r.questIndex+1,success,fails};r.rejects=0;r.questIndex++;
      if(r.results.filter(x=>!x.success).length>=3)win(r,'evil','원정 3회 실패');
      else if(r.results.filter(x=>x.success).length>=3)r.phase='assassin';
      else {nextLeader(r);r.phase='proposal';r.proposal=[];r.draftTeam=[];r.latest=null;}
    }broadcast(r);return;
  }
  if(msg.type==='assassinate') {if(r.phase!=='assassin'||p.role!=='Assassin')return error(ws,'암살자만 지목할 수 있습니다.');const victim=r.players.find(x=>x.id===msg.target);if(!victim)return error(ws,'유효하지 않은 참가자입니다.');win(r,victim.role==='Merlin'?'evil':'good',victim.role==='Merlin'?'암살자가 멀린을 찾아냈습니다.':'암살자가 멀린을 찾지 못했습니다.');r.assassinated=victim.id;broadcast(r);return;}
  if(msg.type==='reset') {if(!host||r.phase!=='ended')return error(ws,'종료된 게임은 방장만 다시 시작할 수 있습니다.');if(r.advanceTimer)clearTimeout(r.advanceTimer);r.advanceTimer=null;r.nextQuestAt=null;r.phase='lobby';r.leader=0;r.questIndex=0;r.proposal=[];r.draftTeam=[];r.approvals={};r.lastApprovals=null;r.approvalHistory=[];r.questVotes={};r.revealed=new Set();r.rejects=0;r.results=[];r.latest=null;r.winner=null;r.reason=null;r.swapRequest=null;r.players.forEach(x=>{x.role=null;x.alignment=null;x.ready=false;});broadcast(r);return;}
  if(msg.type==='leave') {if(r.phase!=='lobby')return error(ws,'진행 중인 게임에서는 퇴장할 수 없습니다.');r.swapRequest=null;r.players=r.players.filter(x=>x.id!==p.id);r.players.forEach(x=>{x.seat=null;x.ready=false;});ws.room=null;ws.player=null;send(ws,{type:'left'});if(!r.players.length)rooms.delete(r.code);else{if(host)r.hostId=r.players[0].id;broadcast(r);}return;}
  error(ws,'알 수 없는 요청입니다.');
}
const base=join(process.cwd(),'public');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=http.createServer(async(req,res)=>{try{
  const requestUrl=new URL(req.url,'http://localhost');
  if(requestUrl.pathname==='/network-addresses'){
    if(process.env.NODE_ENV==='production'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({addresses:[]}));return;}
    const addresses=[];
    for(const interfaces of Object.values(networkInterfaces())) for(const info of interfaces||[]){
      if(info.family==='IPv4'&&!info.internal)addresses.push(`http://${info.address}:${PORT}`);
    }
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({addresses:[...new Set(addresses)]}));return;
  }
  if(requestUrl.pathname==='/qr.svg'){
    const raw=requestUrl.searchParams.get('url')||'';let target;
    try{target=new URL(raw);}catch{return res.writeHead(400).end('Invalid URL');}
    if(!['http:','https:'].includes(target.protocol)|| !/^\d{4}$/.test(target.searchParams.get('room')||'') || raw.length>400)return res.writeHead(400).end('Invalid invitation');
    const svg=await QRCode.toString(target.toString(),{type:'svg',margin:2,width:280,errorCorrectionLevel:'M',color:{dark:'#172238',light:'#FFFFFF'}});
    res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(svg);return;
  }
  const path=requestUrl.pathname;if(path==='/health'){res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({status:'ok'}));return;}const file=join(base,normalize(decodeURIComponent(path==='/'?'/index.html':path)).replace(/^([/\\]|\.\.[/\\])+/g,''));if(!file.startsWith(base))throw Error('invalid');const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}});
const wss=new WebSocketServer({server,maxPayload:10000});
wss.on('connection',ws=>{ws.isAlive=true;ws.on('pong',()=>{ws.isAlive=true});ws.on('message',raw=>{try{onAction(ws,JSON.parse(raw.toString()));}catch(e){console.error(e);error(ws,'요청 처리 중 오류가 발생했습니다.');}});ws.on('close',()=>{const r=rooms.get(ws.room);const p=r?.players.find(x=>x.id===ws.player);if(p&&p.ws===ws){p.ws=null;broadcast(r);}});});
setInterval(()=>{for(const client of wss.clients){if(!client.isAlive){client.terminate();continue;}client.isAlive=false;client.ping();}},30000).unref();
setInterval(()=>{for(const [key,r] of rooms)if(Date.now()-r.created>24*3600*1000&&r.players.every(x=>!x.ws))rooms.delete(key);},3600000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`Avalon ready on http://localhost:${PORT}`));
