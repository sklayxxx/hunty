// AFK-мобы: пока тебя нет (без мыши, клавы и голоса), приходят по очереди и застраивают экран блоками
import { $, $$, pick, prefs } from './core.js';
import { tmsg, closeW, actx as uiActx, winOpen } from './ui.js';
import { mobURL } from './mobs.js';
import { egg } from './eggs.js';
/* ---------- AFK-мобы: пока тебя нет, приходят по очереди и застраивают экран ---------- */
export const steveAPI=(()=>{
const mc=$('.js-mc'),mcb=$('.js-mcb');
const QS=new URLSearchParams(location.search);
const STV={on:true,after:60,speed:3,mode:'off',last:Date.now(),once:false,K:4,who:'queue'};
try{const sv=JSON.parse(localStorage.getItem('hunty-afk')||'{}');if(sv.after)STV.after=sv.after;if(sv.speed)STV.speed=sv.speed;if(sv.who)STV.who=sv.who}catch(_){}
STV.on=STV.who!=='off';
if(QS.get('steve'))STV.after=Math.max(1,+QS.get('steve')||60);
if(QS.has('calm'))STV.speed=1;
function saveAfk(){try{localStorage.setItem('hunty-afk',JSON.stringify({after:STV.after,speed:STV.speed,who:STV.who}))}catch(_){}}
/* пиксель-арт, вид сбоку, лицом вправо */
const R=(s,n)=>Array(n).fill(s);
const AM={
  steve:{n:'Стив',W:8,H:32,move:'walk',tex:'dirt',arm:-80,stack:true,hold:{x:8.6,y:4.6},crumbs:['#5b3f2a','#866043','#a57a55'],
    pal:{h:'#3b2614',H:'#2c1b0d',S:'#c48c64',s:'#a9744f',w:'#ffffff',e:'#4836a8',m:'#7a4a2c',T:'#00a9a9',t:'#008a8a',P:'#3a40ad',p:'#2d3290',G:'#6e6e74',g:'#56565c'},
    parts:[{a:'legb',x:2,y:20,r:[...R('pPPP',10),'gGGG','gGGG'],d:1,z:0,ox:2,oy:0},{a:'armb',x:2,y:8,r:[...R('tTTT',4),...R('sSSS',8)],d:1,z:1,ox:2,oy:2},
      {x:2,y:8,r:R('tTTT',12),z:2},{a:'legf',x:2,y:20,r:[...R('pPPP',10),'gGGG','gGGG'],z:3,ox:2,oy:0},
      {x:0,y:0,r:['Hhhhhhhh','Hhhhhhhh','HhhhhhhS','HhhhSSSS','HhhSSSwe','HhSSSSSS','HhSSSSmm','HhsSSmmS'],z:4},
      {a:'armf',x:2,y:8,r:[...R('tTTT',4),...R('sSSS',8)],z:6,ox:2,oy:2}],
    say:{go:['ты afk? ща замурую','никого нет? строим','тишина… значит, стройка'],full:'всё. замурован. отдыхай',wake:['о, живой! ща уберу','вернулся? разбираю','ладно-ладно, уношу']}},
  villager:{n:'Житель',W:10,H:34,move:'walk',tex:'ore',arm:null,stack:true,hold:{x:7,y:5},crumbs:['#7e7e7e','#d8af93','#41f384','#5decf5'],
    pal:{S:'#bd8b72',s:'#a3735c',N:'#a8735b',n:'#8f5f4b',B:'#3f2a1e',w:'#ffffff',g:'#2b8f43',R:'#6e4b32',r:'#5b3c27',K:'#4a3021',L:'#3c2a1e',l:'#2f2117'},
    parts:[{a:'legb',x:2,y:22,r:R('lLLL',12),d:1,z:0,ox:2,oy:0},{a:'legf',x:2,y:22,r:R('lLLL',12),z:1,ox:2,oy:0},
      {x:1,y:10,r:[...R('rRRRRR',16),'KKKKKK','KKKKKK'],z:2},
      {x:0,y:0,r:['sSSSSSSS..','sSSSSSSS..','sSSSSSSS..','sSSSSSSS..','sSSSSBBB..','sSSSSSwg..','sSSSSSSSNN','sSSSSSSSNN','sSSSSSSSNN','ssSSSSSSnn'],z:4},
      {x:5,y:13,r:['.RRRRR','RRRRRR','RRSSSR','RRRRRR','.rrrrr'],z:6}],
    say:{go:['хмм… хмм','хм! руда по скидке','хмм-хмм. сделка?'],full:'хмм. всё в руде. изумруд с тебя',wake:['хмм!','хм-хм… собираю','хмм. торговля закрыта']}},
  slime:{n:'Слайм',W:12,H:12,move:'hop',tex:'slime',arm:null,stack:false,hold:{x:2.4,y:2.4,s:.6,o:.75,z:2},crumbs:['#8fdc6c','#6fbf4f','#b8f59a'],
    pal:{G:'rgba(132,214,104,.55)',g:'rgba(104,190,80,.6)',h:'rgba(214,255,190,.8)',c:'#5aa844',C:'#4c9638',k:'#183312'},
    parts:[{x:2,y:2,r:['cccccccc','cCcccccc','cccccCcc','cccccccc','ccCccccc','ccccccCc','cccccccc','cccCcccc'],z:1},
      {x:0,y:0,r:['gGGGGGGGGGGg','GhhGGGGGGGGG','GhGGGGGGGGGG','GGGGGGkkGkkG','GGGGGGkkGkkG','GGGGGGGGGGGG','GGGGGGGGGGGG','GGGGGGGGkGGG','GGGGGGGGGGGG','GGGGGGGGGGGG','GGGGGGGGGGGG','gGGGGGGGGGGg'],z:3}],
    say:{go:['*шлёп*','бульк. ты где?','шлёп-шлёп-шлёп'],full:'бульк. всё в слизи',wake:['*чвяк* ой','бульк! убираю','шлёп… засасываю обратно']}},
  enderman:{n:'Эндермен',W:8,H:50,move:'tp',tex:'end',arm:-40,stack:false,hold:{x:11,y:21},crumbs:['#e6e3a8','#cfd292','#b9bb7c'],
    pal:{B:'#161616',b:'#0d0d0d',c:'#242424',P:'#d23cff',p:'#f2b6ff'},
    parts:[{a:'legb',x:3,y:20,r:R('Bb',30),d:1,z:0,ox:1,oy:0},{a:'armb',x:3,y:8,r:R('Bb',30),d:1,z:1,ox:1,oy:1},
      {x:2,y:8,r:R('bBBc',12),z:2},{a:'legf',x:3,y:20,r:R('bB',30),z:3,ox:1,oy:0},
      {x:0,y:0,r:['bBcBbBcB','BbBBcBbB','cBbBBbBc','BBcBbBBb','BbBcBbPp','bBBbBcBb','BcBBbBBc','bBBcBbBB'],z:4},
      {a:'armf',x:3,y:8,r:R('bB',30),z:6,ox:1,oy:1}],
    say:{go:['…','*вжух*','не смотри мне в глаза'],full:'я переставил всё. совсем всё.',wake:['*вжух*… ладно','не смотрел? хорошо','забираю. все блоки мои']}},
  creeper:{n:'Крипер',W:8,H:26,move:'walk',tex:'tnt',arm:null,stack:true,hold:{x:0,y:-8},crumbs:['#db2f1f','#e8e8e8','#3a3a3a'],
    pal:{a:'#6ccf55',b:'#57b844',c:'#479e37',d:'#8be070',e:'#3a8a2c',k:'#0e130d'},
    parts:[{a:'legf',x:0,y:20,r:['abca','dbab','cabd','bdac','acbd','eeee'],d:1,z:0,ox:2,oy:0},{a:'legb',x:4,y:20,r:['abca','dbab','cabd','bdac','acbd','eeee'],d:1,z:0,ox:2,oy:0},
      {x:2,y:8,r:['abca','dbab','cadb','bdac','acbd','dbac','cabd','bdca','acbd','dbab','cadb','bdac'],z:2},
      {a:'legb',x:0,y:20,r:['abca','dbab','cabd','bdac','acbd','eeee'],z:3,ox:2,oy:0},{a:'legf',x:4,y:20,r:['abca','dbab','cabd','bdac','acbd','eeee'],z:3,ox:2,oy:0},
      {x:0,y:0,r:['abcadbac','dbabcadb','acbdabkk','bdacbdkk','cadbacak','bacdbakk','dcabdckk','abdcabak'],z:4}],
    say:{go:['сссс…','ссс… ты тут?','тссс… несу динамит'],full:'сссс… сюрприз',wake:['ссс… шучу','не взорвётся. наверное','ссс! уношу-уношу']}}
};
const ORDERM=['steve','villager','slime','enderman','creeper'];
let qi=0;try{qi=+localStorage.getItem('hunty-afkq')||0}catch(_){}
function shade(c,f){if(c.startsWith('rgba'))return c;const n=parseInt(c.slice(1),16);const v=[n>>16,n>>8&255,n&255].map(x=>Math.round(x*f));return `rgb(${v})`}
function sprite(rows,pal,dark){const c=document.createElement('canvas');c.width=rows[0].length;c.height=rows.length;const x=c.getContext('2d');
  rows.forEach((r,y)=>[...r].forEach((ch,i)=>{if(pal[ch]){x.fillStyle=dark?shade(pal[ch],.72):pal[ch];x.fillRect(i,y,1,1)}}));return `url(${c.toDataURL()})`}
function rng(seed){let s=seed>>>0;return()=>((s=Math.imul(s^s>>>15,1|s)+0x6D2B79F5|0,s^=s+Math.imul(s^s>>>7,61|s),(s^s>>>14)>>>0)/4294967296)}
function tex(fn){const c=document.createElement('canvas');c.width=c.height=16;fn(c.getContext('2d'));return `url(${c.toDataURL()})`}
function noise(x,r,P,pw=1.15){for(let y=0;y<16;y++)for(let i=0;i<16;i++){const k=Math.floor(Math.pow(r(),pw)*P.length);x.fillStyle=P[Math.min(P.length-1,k)];x.fillRect(i,y,1,1)}}
const TEX={
  dirt:v=>tex(x=>{const r=rng(1337+v*97);noise(x,r,['#5b3f2a','#66472f','#734f35','#7d583b','#866043','#8f6747','#9a6f4c','#a57a55']);
    for(let n=0;n<7;n++){x.fillStyle=r()<.5?'#4a3322':'#a88566';x.fillRect(Math.floor(r()*15),Math.floor(r()*15),r()<.5?2:1,1)}
    for(let n=0;n<3;n++){x.fillStyle='#8d8178';x.fillRect(Math.floor(r()*16),Math.floor(r()*16),1,1)}}),
  ore:v=>tex(x=>{const r=rng(4242+v*131);noise(x,r,['#686868','#717171','#7a7a7a','#838383','#8c8c8c','#959595'],1);
    const O=[['#d8af93','#b88a6c','#f0d0b8'],['#fcee4b','#d8b431','#fff8a6'],['#41f384','#17a84c','#b6ffd0'],['#5decf5','#2bb5c0','#d2fdff']][v%4];
    for(let n=0;n<5;n++){const cx=1+Math.floor(r()*13),cy=1+Math.floor(r()*13);x.fillStyle=O[1];x.fillRect(cx,cy,2,2);x.fillStyle=O[0];x.fillRect(cx,cy,1,1);if(r()<.6){x.fillStyle=O[2];x.fillRect(cx+1,cy,1,1)}if(r()<.5){x.fillStyle=O[1];x.fillRect(cx+2,cy+1,1,1)}}}),
  slime:v=>tex(x=>{const r=rng(777+v*53);x.fillStyle='rgba(120,206,92,.82)';x.fillRect(0,0,16,16);x.fillStyle='rgba(170,236,140,.9)';x.fillRect(0,0,16,1);x.fillRect(0,0,1,16);
    x.fillStyle='rgba(80,160,60,.9)';x.fillRect(0,15,16,1);x.fillRect(15,0,1,16);x.fillStyle='rgba(96,180,72,.95)';x.fillRect(4,4,8,8);x.fillStyle='rgba(150,226,120,.95)';x.fillRect(5,5,6,6);
    x.fillStyle='rgba(205,255,180,.9)';x.fillRect(5,5,2,1);for(let n=0;n<6;n++){x.fillStyle='rgba(225,255,210,.55)';x.fillRect(1+Math.floor(r()*14),1+Math.floor(r()*14),1,1)}}),
  end:v=>tex(x=>{const r=rng(909+v*71);noise(x,r,['#d6d89a','#dbde9e','#e0e3a6','#e5e8ae','#cfd292'],1);for(let n=0;n<9;n++){x.fillStyle=r()<.5?'#b9bb7c':'#a7aa6c';x.fillRect(Math.floor(r()*15),Math.floor(r()*15),r()<.4?2:1,1)}}),
  tnt:v=>tex(x=>{const r=rng(31+v*17);for(let y=0;y<16;y++)for(let i=0;i<16;i++){x.fillStyle=(i%4===1)?'#b3230f':(r()<.15?'#c92a17':'#db2f1f');x.fillRect(i,y,1,1)}
    x.fillStyle='#e8e8e8';x.fillRect(0,5,16,6);x.fillStyle='#c8c8c8';x.fillRect(0,10,16,1);x.fillStyle='#1c1c1c';
    [[2,6],[3,6],[4,6],[3,7],[3,8],[3,9],[6,6],[6,7],[6,8],[6,9],[7,7],[8,8],[9,6],[9,7],[9,8],[9,9],[11,6],[12,6],[13,6],[12,7],[12,8],[12,9]].forEach(([a,b])=>x.fillRect(a,b,1,1))})
};
const stv=document.createElement('div');stv.className='steve mob';stv.hidden=true;mc.appendChild(stv);
const say=document.createElement('div');say.className='mc-say';mc.appendChild(say);
let M=AM.steve,MK='steve',hold=null,bodyW=null;
function setMob(k){MK=AM[k]?k:'steve';M=AM[MK];stv.className='steve mob m-'+MK;stv.style.setProperty('--mw',M.W);stv.style.setProperty('--mh',M.H);
  stv.innerHTML='';bodyW=document.createElement('b');bodyW.className='mbody';stv.appendChild(bodyW);
  for(const pt of M.parts){const el=document.createElement('i');el.className='mp'+(pt.a?' '+pt.a:'');const w=pt.r[0].length,h=pt.r.length;
    el.style.cssText=`left:calc(var(--p)*${pt.x});top:calc(var(--p)*${pt.y});width:calc(var(--p)*${w});height:calc(var(--p)*${h});z-index:${pt.z||1};transform-origin:calc(var(--p)*${pt.ox??w/2}) calc(var(--p)*${pt.oy??0});background-image:${sprite(pt.r,M.pal,pt.d)}`;bodyW.appendChild(el)}
  hold=document.createElement('span');hold.className='s-hold'+(M.stack?'':' one');const H=M.hold;
  hold.style.cssText=`left:calc(var(--p)*${H.x});top:calc(var(--p)*${H.y});z-index:${H.z||5}`+(H.s?`;transform:scale(${H.s});transform-origin:0 0;opacity:${H.o||1}`:'');bodyW.appendChild(hold);
  [0,1,2,3].forEach(v=>mc.style.setProperty('--d'+v,TEX[M.tex](v)));mc.dataset.mob=MK;setCarry(S.carry)}
function nextMob(){if(STV.who!=='queue'&&STV.who!=='random'&&AM[STV.who])return STV.who;if(STV.who==='random')return pick(ORDERM.filter(k=>k!==MK));const k=ORDERM[qi%ORDERM.length];return k}
function advance(){if(STV.who==='queue'){qi=(ORDERM.indexOf(MK)+1)%ORDERM.length;try{localStorage.setItem('hunty-afkq',qi)}catch(_){}}renderQueue()}
// геометрия
let B=64,cols=23,rows=15,VW=0,p=3.6;
function geo(){VW=innerWidth;const H=innerHeight,q=Math.max(3,Math.round(Math.min(VW/18,H/11)/16));B=q*16;cols=Math.ceil(VW/B);rows=Math.max(2,Math.floor(H/B)+(H%B>B*.5?1:0));p=B*1.8/32;
  mc.style.setProperty('--B',B+'px');mc.style.setProperty('--p',p.toFixed(2)+'px');blocks.forEach((b,i)=>pos(b,i))}
const blocks=[];const cellOf=i=>({r:Math.floor(i/cols),c:i%cols});
function pos(el,i){const {r,c}=cellOf(i);el.style.setProperty('--c',c);el.style.setProperty('--r',r)}
const total=()=>cols*rows;
const S={x:0,y:0,f:-1,carry:0,ph:0,task:null,shown:false,jy:0,sq:1,op:1};
const OFF=()=>VW+B*1.3,atOff=()=>Math.abs(S.x-OFF())<1;
function render(){stv.style.setProperty('--x',S.x.toFixed(1));stv.style.setProperty('--y',(S.y+S.jy).toFixed(1));stv.style.setProperty('--f',S.f);stv.style.setProperty('--sq',S.sq.toFixed(3));stv.style.setProperty('--op',S.op.toFixed(2));
  const walk=S.task&&S.task.k==='walk'&&M.move==='walk',a=walk?Math.sin(S.ph)*30:0;stv.style.setProperty('--leg',a.toFixed(1));
  let af=-a*.85,ab=a*.85;if(S.carry>0&&M.arm!=null){af=M.arm+(walk?Math.sin(S.ph*2)*3:0);ab=M.arm+4}
  if(S.task&&S.task.swing!=null&&M.arm!=null){af=M.arm+Math.sin(Math.min(1,S.task.t/S.task.d)*Math.PI)*S.task.swing}
  stv.style.setProperty('--armf',af.toFixed(1));stv.style.setProperty('--armb',ab.toFixed(1));
  say.style.setProperty('--x',Math.max(140,Math.min(VW-140,S.x)).toFixed(1));say.style.setProperty('--y',Math.min(S.y+S.jy,innerHeight-p*(M.H+4)-56).toFixed(1));say.style.setProperty('--sayh',M.H+4)}
function setCarry(n){S.carry=n;if(!hold)return;let h='';if(M.stack){const k=Math.min(n,6);for(let i=0;i<k;i++)h+=`<i class="blk v${i%4}" style="--k:${i}"></i>`;if(n>6)h+=`<b>×${n}</b>`}
  else if(n>0){h=`<i class="blk v${n%4}" style="--k:0"></i>`+(n>1?`<b>×${n}</b>`:'')}hold.innerHTML=h}
let sayT=0;function speak(t,ms=2600){say.textContent=t;say.classList.add('on');clearTimeout(sayT);sayT=setTimeout(()=>say.classList.remove('on'),ms)}
function actx(){return prefs.sound?uiActx():null}
function noiseHit(freq,dur,gain,type='lowpass'){const a=actx();if(!a)return;try{const t=a.currentTime,n=a.createBufferSource(),b=a.createBuffer(1,a.sampleRate*dur,a.sampleRate),d=b.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,3);n.buffer=b;const f=a.createBiquadFilter();f.type=type;f.frequency.value=freq;const g=a.createGain();g.gain.value=gain;n.connect(f);f.connect(g);g.connect(a.destination);n.start(t)}catch(_){}}
function sweep(f0,f1,dur,gain){const a=actx();if(!a)return;try{const t=a.currentTime,o=a.createOscillator(),g=a.createGain();o.type='sine';o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+dur);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g);g.connect(a.destination);o.start(t);o.stop(t+dur+.02)}catch(_){}}
function thud(f=1){({dirt:()=>noiseHit(380*f,.12,.22),ore:()=>noiseHit(1100*f,.08,.2,'bandpass'),slime:()=>{noiseHit(520*f,.16,.2,'bandpass');sweep(260,120,.14,.05)},end:()=>noiseHit(700*f,.1,.18),tnt:()=>noiseHit(460*f,.11,.2)})[M.tex]()}
function vwoop(){sweep(900,180,.28,.05)}
function hiss(){noiseHit(3200,.9,.05,'highpass')}
function burst(cx,cy,cols,n=6,grav=.55,big=1){for(let i=0;i<n;i++){const d=document.createElement('i');d.className='prt';d.style.background=cols[i%cols.length];d.style.left=cx+'px';d.style.top=cy+'px';if(big!==1)d.style.transform=`scale(${big})`;mc.appendChild(d);
  const a=Math.random()*Math.PI*2,v=B*(.35+Math.random()*.4);d.animate([{transform:'translate(0,0)',opacity:1},{transform:`translate(${Math.cos(a)*v}px,${Math.sin(a)*v*.6+B*grav}px)`,opacity:0}],{duration:420+Math.random()*200,easing:'cubic-bezier(.2,.6,.4,1)'}).onfinish=()=>d.remove()}}
function crumbs(c,r){const cx=(c+.5)*B,cy=innerHeight-(r+.5)*B;burst(cx,cy,M.crumbs,6,.55);
  if(M.tex==='slime')for(let i=0;i<3;i++){const d=document.createElement('i');d.className='prt drip';d.style.left=(c*B+B*(.2+Math.random()*.6))+'px';d.style.top=(innerHeight-r*B-2)+'px';mc.appendChild(d);
    d.animate([{transform:'scaleY(.4)',opacity:.95},{transform:`translateY(${B*(.5+Math.random()*.6)}px) scaleY(1.8)`,opacity:0}],{duration:900+Math.random()*500,easing:'cubic-bezier(.5,0,.9,.6)'}).onfinish=()=>d.remove()}}
function tpFx(x,y){burst(x,innerHeight-y-p*M.H*.5,['#d23cff','#f2b6ff','#7b1fa2'],10,-.2,1.2)}
function holdRect(){const r=hold.getBoundingClientRect();const s=M.hold.s||1;return {x:r.left+r.width/2,y:r.top+r.height/2,s:(r.width/B)}}
function flyBlock(c,r,toCell,cb){const h=holdRect(),cx=(c+.5)*B,cy=innerHeight-(r+.5)*B;const f=document.createElement('i');f.className='blk fly v'+((c+r)%4);
  f.style.transform=`translate(${cx-B/2}px,${cy-B/2}px)`;mc.appendChild(f);const A=`translate(${h.x-B/2}px,${h.y-B/2}px) scale(${h.s})`,Z=`translate(${cx-B/2}px,${cy-B/2}px) scale(1)`;
  f.animate(toCell?[{transform:A},{transform:Z}]:[{transform:Z},{transform:A}],{duration:170,easing:toCell?'cubic-bezier(.3,.7,.4,1)':'cubic-bezier(.6,0,.7,.4)'}).onfinish=()=>{f.remove();cb&&cb()}}
function addBlock(){if(blocks.length>=total())return;const i=blocks.length,{r,c}=cellOf(i),el=document.createElement('i');el.className='blk pop v'+((c*7+r*3)%4);pos(el,i);mcb.appendChild(el);blocks.push(el);crumbs(c,r);thud(1)}
function takeBlock(){const el=blocks.pop();if(!el)return null;const i=blocks.length,{r,c}=cellOf(i);el.remove();return {r,c}}
// планировщик
const spd=()=>STV.speed*(STV.mode==='clear'?1.9:1);
function plan(){const n=blocks.length;
  if(STV.mode==='build'){
    if(n>=total()){if(!S.full){S.full=1;speak(M.say.full,3200)}return atOff()?null:{k:'walk',x:OFF()}}S.full=0;
    const {r,c}=cellOf(n),y=r*B;
    if(S.carry===0){if(!atOff())return {k:'walk',x:OFF()};if(S.y!==y)return {k:'warp',y};return {k:'pick',d:.34}}
    if(S.y!==y)return atOff()?{k:'warp',y}:{k:'walk',x:OFF()};
    const tx=(c+1.5)*B;if(Math.abs(S.x-tx)>1)return {k:'walk',x:tx};
    return {k:'place',d:.36,swing:34,c,r}}
  if(n===0){if(!atOff())return {k:'walk',x:OFF()};if(S.carry)return {k:'drop',d:.2};return null}
  if(S.carry>=STV.K)return atOff()?{k:'drop',d:.2}:{k:'walk',x:OFF()};
  const {r,c}=cellOf(n-1),y=r*B;
  if(S.y!==y){if(!atOff())return {k:'walk',x:OFF()};if(S.carry)return {k:'drop',d:.2};return {k:'warp',y}}
  const tx=(c+1.5)*B;if(Math.abs(S.x-tx)>1)return {k:'walk',x:tx};
  return {k:'grab',d:.14,swing:-26,c,r}}
function step(dt){const T=S.task;
  if(T.k==='walk'&&M.move==='tp'){T.t=(T.t||0)+dt*Math.sqrt(spd());const d=.34;if(!T.a){T.a=1;tpFx(S.x,S.y);vwoop()}
    if(T.t<d/2)S.op=1-T.t/(d/2);else{if(!T.b){T.b=1;S.f=T.x<S.x?-1:1;S.x=T.x;tpFx(S.x,S.y)}S.op=Math.min(1,(T.t-d/2)/(d/2))}
    if(T.t>=d){S.op=1;S.task=null}return}
  if(T.k==='walk'){const v=B*(M.move==='hop'?3.4:4.4)*spd(),d=T.x-S.x,st=v*dt;S.f=d<0?-1:1;
    if(Math.abs(d)<=st){S.x=T.x;S.task=null;S.jy=0;S.sq=1;if(M.move==='hop')thud(.8)}else{S.x+=Math.sign(d)*st;S.ph+=st/(M.move==='hop'?B*.9/Math.PI:p*5.5)}
    if(M.move==='hop'&&S.task){const s=Math.abs(Math.sin(S.ph));S.jy=s*B*.5;S.sq=s<.18?.82+s:1+Math.min(.08,s*.08)}return}
  if(T.k==='warp'){S.y=T.y;S.task=null;return}
  T.t=(T.t||0)+dt*Math.sqrt(spd());
  if(M.move==='hop'&&(T.k==='place'||T.k==='grab'||T.k==='pick')){const k=Math.min(1,T.t/T.d);S.sq=1-Math.sin(k*Math.PI)*.2}
  if(T.k==='place'){S.f=-1;if(!T.done&&T.t>=T.d*.45){T.done=1;setCarry(S.carry-1);flyBlock(T.c,T.r,true,addBlock)}}
  if(T.k==='grab'){S.f=-1;if(!T.done&&T.t>=T.d*.3){T.done=1;const b=takeBlock();if(b){thud(1.4);S.carry++;flyBlock(b.c,b.r,false,()=>setCarry(S.carry))}}}
  if(T.t>=T.d){S.sq=1;if(T.k==='pick')setCarry(S.carry+1);if(T.k==='drop'){setCarry(0);STV.K=Math.max(4,Math.min(cols*2,Math.ceil(blocks.length/6)))}S.task=null}}
let raf=0,prev=0;
function loop(ts){raf=0;const dt=Math.min(.1,prev?(ts-prev)/1000:.016);prev=ts;
  if(!S.task)S.task=plan();
  if(!S.task){if(STV.mode!=='build'&&!blocks.length){STV.mode='off';S.shown=false;stv.hidden=true;mc.hidden=true;prev=0;advance();return}prev=0;render();return}
  step(dt);render();raf=requestAnimationFrame(loop)}
function kick(){if(!raf){prev=0;raf=requestAnimationFrame(loop)}}
function begin(force){if(!S.shown){if(!blocks.length)setMob(force||nextMob());geo();S.shown=true;mc.hidden=false;stv.hidden=false;S.x=OFF();S.y=0;S.f=-1;S.op=1;S.jy=0;S.sq=1;setCarry(S.carry);render()}
  STV.mode='build';mcb.classList.remove('prime');if(S.task&&S.task.k==='walk')S.task=null;kick();
  speak(pick(M.say.go));if(MK==='creeper')hiss();if(MK==='enderman')vwoop()}
function wake(){STV.last=Date.now();if(STV.mode==='build'){if(blocks.length>2)egg('steve');STV.mode='clear';STV.K=Math.max(4,Math.min(cols*2,Math.ceil(blocks.length/6)));if(S.task&&S.task.k==='walk')S.task=null;
  if(MK==='creeper'&&blocks.length){mcb.classList.add('prime');hiss();setTimeout(()=>{mcb.classList.remove('prime');kick()},1100)}else kick();
  if(blocks.length)speak(pick(M.say.wake),2200)}}
['pointermove','pointerdown','keydown','wheel','touchstart'].forEach(ev=>addEventListener(ev,wake,{passive:true,capture:true}));

setInterval(()=>{if((!STV.on&&!STV.once)||STV.mode==='build'||document.hidden||$('.boot')||(winOpen()==='onboard'))return;const lim=(STV.once?3:STV.after)*1000;if(Date.now()-STV.last>lim){STV.once=false;begin()}},400);
addEventListener('resize',()=>{if(S.shown)geo()});
// настройки
function renderQueue(){const q=$('.js-afkq');if(!q)return;const nx=nextMob();
  q.innerHTML=ORDERM.map(k=>`<button type="button" class="aq${k===nx?' nx':''}" data-m="${k}" aria-pressed="${k===nx}" title="${AM[k].n}${k===nx?' · придёт следующим':''}"><img alt="" src="${mobURL(k)}" width="26" height="26"><span>${AM[k].n}</span></button>`).join('');
  const b=$('.js-steve-now');if(b)b.lastChild.textContent='Позвать: '+AM[nx].n}
$('.js-steve-after').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;STV.after=+b.dataset.s;$$('.js-steve-after button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));saveAfk()});
$('.js-steve-speed').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;STV.speed=+b.dataset.v;$$('.js-steve-speed button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));saveAfk()});
const whoEl=$('.js-afkwho');if(whoEl)whoEl.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;STV.who=b.dataset.w;STV.on=STV.who!=='off';$$('button',whoEl).forEach(x=>x.setAttribute('aria-pressed',String(x===b)));saveAfk();renderQueue()});
const qEl=$('.js-afkq');if(qEl)qEl.addEventListener('click',e=>{const b=e.target.closest('[data-m]');if(!b)return;if(STV.who==='queue'){qi=ORDERM.indexOf(b.dataset.m);try{localStorage.setItem('hunty-afkq',qi)}catch(_){}}else{STV.who=b.dataset.m;STV.on=true;if(whoEl)$$('button',whoEl).forEach(x=>x.setAttribute('aria-pressed','false'));saveAfk()}renderQueue();tmsg('ok',`следующим придёт ${AM[nextMob()].n}`)});
$('.js-steve-now').addEventListener('click',()=>{STV.once=true;closeW();tmsg('ping',`${AM[nextMob()].n} уже в пути · замри на 3 сек: без мыши, клавы и голоса`)});
$$('.js-steve-after button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.s===STV.after)));
$$('.js-steve-speed button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.v===STV.speed)));
if(whoEl)$$('button',whoEl).forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.w===STV.who)));
if(QS.get('mob')&&AM[QS.get('mob')]){STV.who=QS.get('mob')}
setMob(nextMob());renderQueue();
return {state:()=>({mode:STV.mode,mob:MK,next:nextMob(),blocks:blocks.length,total:total(),carry:S.carry,x:Math.round(S.x),y:S.y,task:S.task&&S.task.k,B}),go:k=>begin(k),wake,mobs:ORDERM,
  fill:(n,k)=>{if(!S.shown)begin(k);for(let i=0;i<n&&blocks.length<total();i++){const {r,c}=cellOf(blocks.length),el=document.createElement('i');el.className='blk v'+((c*7+r*3)%4);pos(el,blocks.length);mcb.appendChild(el);blocks.push(el)}
    S.x=OFF();S.y=cellOf(Math.min(blocks.length,total()-1)).r*B;S.task=null;kick()}};
})();
