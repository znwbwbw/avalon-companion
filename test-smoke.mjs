/** Run against a started server: npm.cmd run dev; another terminal npm.cmd test */
import WebSocket from 'ws';
import assert from 'node:assert/strict';

const origin=process.env.AVALON_URL || 'ws://127.0.0.1:3000';
const wait=async (check,label,ms=8000)=>{const start=Date.now();while(Date.now()-start<ms){if(check())return;await new Promise(r=>setTimeout(r,15));}throw new Error('시간 초과: '+label)};
async function connect(){const socket=new WebSocket(origin);const player={socket,state:null,token:null,errors:[]};socket.on('message',raw=>{const msg=JSON.parse(raw.toString());if(msg.type==='state')player.state=msg.state;if(msg.type==='joined')player.token=msg.token;if(msg.type==='error')player.errors.push(msg.message)});await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});return player;}
const send=(p,type,data={})=>p.socket.send(JSON.stringify({type,...data}));
const all=(ps,phase)=>ps.every(p=>p.state?.phase===phase);
async function scenario(n){
 const ps=[];
 try{
  for(let i=0;i<n;i++)ps.push(await connect());
  send(ps[0],'create',{name:'01'});await wait(()=>ps[0].token&&ps[0].state,'방 생성');
  const code=ps[0].state.code;
  for(let i=1;i<n;i++){send(ps[i],'join',{code,name:String(i+1).padStart(2,'0')});await wait(()=>ps[i].token&&ps[i].state,'참가');}
  await wait(()=>ps.every(p=>p.state?.players.length===n),'전체 입장');
  for(let i=0;i<n;i++){send(ps[i],'seat',{seat:i});await wait(()=>ps.every(p=>p.state?.players[i].seat===i),'착석');send(ps[i],'ready',{ready:true});await wait(()=>ps.every(p=>p.state?.players[i].ready),'준비');}
  send(ps[0],'start');await wait(()=>all(ps,'reveal'),'역할 시작');
  // re-connect one player during reveal using their own token
  const previous=ps[n-1];const resumed=await connect();send(resumed,'resume',{code,token:previous.token});await wait(()=>resumed.state?.phase==='reveal','재접속');ps[n-1]=resumed;await wait(()=>!previous.state?.players.some(x=>x.online===false)||resumed.state.players.length===n,'재접속 확인');
  for(const p of ps)send(p,'revealed');await wait(()=>all(ps,'proposal'),'역할 공개 완료');
  const roster=()=>ps[0].state.players;
  for(let round=0;round<(n>=7?4:3);round++){
   await wait(()=>all(ps,'proposal'),'원정 준비');
   const snapshot=ps[0].state;const needed=snapshot.questSizes[round];let chosen=roster().slice(0,needed).map(p=>p.id);
   // round 2: ensure one evil is included and submits a fail so 4th round is reached
   if((round===1||round===3)&&n>=7){const evil=ps.find(p=>p.state.me.alignment==='evil');chosen[0]=evil.state.me.id;chosen=[...new Set(chosen)];for(const p of roster())if(chosen.length<needed&&!chosen.includes(p.id))chosen.push(p.id);}
   const lead=ps.find(p=>p.state.me.id===snapshot.leaderId);send(lead,'draftTeam',{ids:chosen});await wait(()=>ps.every(p=>p.state?.draftTeam.length===needed),'팀 공유');
   send(lead,'propose',{ids:chosen});await wait(()=>all(ps,'approval'),'찬반 단계');
   for(const p of ps)send(p,'approve',{vote:true});await wait(()=>all(ps,'quest'),'원정 비밀 단계');
   let failed=false;for(const p of ps.filter(p=>chosen.includes(p.state.me.id))){const success=!((round===1||round===3)&&n>=7&&!failed&&p.state.me.alignment==='evil');if(!success)failed=true;send(p,'questVote',{success});}
   await wait(()=>ps.every(p=>p.state?.results.length===round+1),'원정 결과 수집');
   if(round===1&&n>=7)assert.equal(ps[0].state.results[round].success,false,'2차 원정 실패');
   if(round===3&&n>=7){assert.equal(ps[0].state.results[round].fails,1,'4차 실패표 한 장');assert.equal(ps[0].state.results[round].success,true,'4차 원정 실패표 1장이어도 성공');}
  }
  assert.equal(ps[0].state.results.length,n>=7?4:3);
  assert.equal(ps[0].state.phase,'assassin');
  assert(ps.every(p=>p.errors.length===0),'서버 오류: '+ps.flatMap(p=>p.errors).join(', '));
  console.log(`PASS ${n}인: 입장/착석/역할/재접속/실시간 팀 공유/투표/원정 집계`);
 } finally {for(const p of ps)p.socket.close();}
}
for(const n of [5,7,10])await scenario(n);
console.log('모든 자동 시나리오 통과');
