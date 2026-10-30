// Аватарки-мобы: пиксель-арт 8×8 → SVG. Моба выдаёт система, на рандом.
const SKEL=['wWWgWWwW','WwWWWWWg','WWgWWwWW','WkkWWkkW','WWWKKWWW','gWWWWWWw','WkKkKkKW','wWWWWWWW'];
export const MOBS={
  steve:{n:'Стив',p:{H:'#3b2614',h:'#2c1b0d',S:'#c69874',s:'#b0805c',w:'#ffffff',e:'#4836a8',n:'#8b5a40',m:'#6b3e26'},g:['HHhHHHhH','HhHHHHHH','HSSSSSSH','SSSSSSSS','SweSSewS','SSSnnSSS','SSmSSmSS','SSmmmmSS']},
  alex:{n:'Алекс',p:{H:'#e9792f',h:'#c95f1e',S:'#f4c9a3',s:'#e4b088',w:'#ffffff',g:'#3a8c3f',m:'#d98f78'},g:['HHhHHHHh','HHHHhHHH','HhSSSSHH','HSSSSSSH','HwgSSgwH','HSSSSSSH','SSSmmSSH','SSSSSSHH']},
  creeper:{n:'Крипер',p:{a:'#6ccf55',b:'#57b844',c:'#479e37',d:'#8be070',k:'#0e130d',m:'#1d2a1a'},g:['abcadbac','dbabcadb','akkbckka','bkkadkkc','cadmmbda','bammmmab','dcmmmmcb','abmcdmba']},
  zombie:{n:'Зомби',p:{H:'#2f5a2a',h:'#3a6b33',s:'#5a9a44',t:'#4c8739',u:'#67a851',k:'#101a0d',m:'#3b6630'},g:['HhHHhHHh','hHsHHtHs','ssutsust','skksskku','tsssusst','sutmmtsu','stsmmsts','tsustsus']},
  skeleton:{n:'Скелет',p:{W:'#dcdcdc',w:'#c6c6c6',g:'#a8a8a8',k:'#252525',K:'#3c3c3c'},g:SKEL},
  wither:{n:'Визер-скелет',p:{W:'#353535',w:'#2a2a2a',g:'#444444',k:'#070707',K:'#121212'},g:SKEL},
  enderman:{n:'Эндермен',p:{B:'#171717',b:'#0e0e0e',c:'#222222',P:'#c63cf2',p:'#f0b3ff'},g:['bBcBbBcB','BbBBcBbB','cBbBBbBc','BBcBbBBb','PpPBBPpP','BbBcBbBB','bBBbBcBb','BcBBbBBc']},
  pig:{n:'Свинья',p:{S:'#f2a7a4',s:'#e8928f',t:'#f7bcb9',n:'#fad3d1',N:'#a85d5b',w:'#ffffff',k:'#1d1d1d'},g:['SsStSSsS','tSSSsSSt','SSsSSStS','wkSSsSkw','SSnnnnSS','sSNnnNSs','SSSsSSSS','StSSSSsS']},
  villager:{n:'Житель',p:{S:'#c2917a',s:'#a87862',B:'#3e2a22',w:'#f2f2f2',G:'#2f8f3a',N:'#a8705a',n:'#8c5a46'},g:['ssSsssSs','SSSSSSSS','SBBBBBBS','SwGSSGwS','SSSNNSSS','SSsNNsSS','SSSNNSSS','SSSnnSSS']},
  cow:{n:'Корова',p:{B:'#3a2a1e',b:'#2d2017',W:'#ececec',w:'#d4d4d4',k:'#111111',n:'#c2ae9c',N:'#6a5342'},g:['BbBBBBbB','BWWWBBBB','WWWwWBbB','kWWWBBBk','BWWWBbBB','BnnnnnnB','BnNnnNnB','BnnnnnnB']},
  slime:{n:'Слизень',p:{G:'#7dd05e',g:'#6abb4c',L:'#a3e486',D:'#2f6b22',d:'#3f8a31'},g:['LLGLGGLG','LGGGGGGg','GDDGGDDG','GDLGGDLG','GGGGGGGg','GGGGdGGG','gGGGGGGg','ggGgggGg']},
  blaze:{n:'Ифрит',p:{Y:'#ffd43b',y:'#f5b61f',O:'#e8871a',o:'#c86e10',K:'#3a2306'},g:['yYOyYYOy','YYYYyYYY','OYyYYYyO','YKKYYKKY','YYYYYYYY','yOYYYYOy','OoOOOOoO','oOyOOyOo']},
  spider:{n:'Паук',p:{D:'#3b3532',d:'#2a2421',c:'#4a433f',R:'#c8161d',r:'#ff4545'},g:['dDdcdDdD','DdDDdDcd','dDdrrdDd','dRrdDrRd','rDdDdDdr','DdcDDdDd','dDDdcDDd','DdDdDdcD']},
  golem:{n:'Железный голем',p:{W:'#dad3c9',w:'#c3bbb0',B:'#6f6860',R:'#b3301f',N:'#c8bfb4',n:'#a99f93',G:'#4f8a35',g:'#3d6e29'},g:['wWWwWWWw','WWWWWwWW','WBBBBBBW','WRwWWwRW','WWWNNWWW','GWWNNWWw','GgWNNWGW','WGWnnWgW']},
  fox:{n:'Лиса',p:{O:'#e2822f',o:'#c76a20',W:'#f4efe6',w:'#e0d8cb',k:'#1a1310',K:'#5a3418'},g:['OoOOOOoO','OOOOoOOO','oOOOOOOo','OkKOOKkO','WWOOOOWW','WWWkkWWW','wWWWWWWw','ooWwwWoo']},
  axolotl:{n:'Аксолотль',p:{P:'#f7a9cf',p:'#ec92bf',g:'#ff5d9e',G:'#d9437f',k:'#1b1b1b',M:'#b8507f'},g:['gPPPPPPg','GPpPPpPG','gPPPPPPg','PkPPPPkP','PPPPPPPP','PPMMMMPP','pPPPPPPp','ppPppPpp']},
  drowned:{n:'Утопленник',p:{H:'#2c5f55',h:'#244c44',T:'#4fa9a2',t:'#3f8f88',D:'#2a6965',C:'#a6f8ff',c:'#3fd2e2'},g:['HhHHhHHh','HTHhTHHT','TTtTTTtT','TCcTTcCT','TTTTtTTT','tTTDDTTt','TTDDDDTT','TtTTTTtT']},
  sheep:{n:'Овца',p:{W:'#efefef',w:'#d9d9d9',F:'#d8b89c',f:'#c7a586',k:'#1b1b1b',v:'#ffffff',n:'#e7bfa8',N:'#b07c6a'},g:['WwWWWwWW','WFFFFFFw','WFfFFfFW','FkvFFvkF','FFFFFFFF','FFnNNnFF','FFFnnFFF','wFFFFFFW']},
  bee:{n:'Пчела',p:{Y:'#f1c232',y:'#e0ad1f',K:'#2b2418',B:'#2c3f66',w:'#ffffff'},g:['YYyYYYyY','KKKKKKKK','YYYYYYYY','BwYYYYwB','BBYYYYBB','YYYYYYYY','KKKKKKKK','YyYYyYYY']},
  piglin:{n:'Пиглин',p:{S:'#e9a59a',s:'#d88d83',t:'#f0b7ac',n:'#f5c6bc',N:'#9b5b52',w:'#ffffff',k:'#1d1d1d',T:'#f2ede0'},g:['sSSsSSsS','SStSSSSS','SwkSSkwS','SSSSSSSS','SSnnnnSS','SSNnnNSS','STsSSsTS','SSSSSSSS']},
  ghast:{n:'Гаст',p:{W:'#f0f0f0',w:'#dcdcdc',k:'#2a2a2a',R:'#b23a3a'},g:['WWWwWWWW','WwWWWWwW','WkkWWkkW','WWWWWWWW','WWWWwWWW','WWkkkkWW','WWkRRkWW','WWWWWWWW']}
};
// Стив занят AFK-гэгом, гаст и пиглин — для пасхалок
export const MOBKEYS=Object.keys(MOBS).filter(k=>!['ghast','steve','piglin'].includes(k));
const cache={};
export function mobURL(k){if(cache[k])return cache[k];const m=MOBS[k]||MOBS.creeper;let r='';
  m.g.forEach((row,y)=>{let x=0;while(x<8){const ch=row[x];let w=1;while(x+w<8&&row[x+w]===ch)w++;r+=`<rect x="${x}" y="${y}" width="${w}" height="1" fill="${m.p[ch]||'#000'}"/>`;x+=w}});
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges">${r}</svg>`;
  return cache[k]='data:image/svg+xml;base64,'+btoa(svg)}
/** профиль.ava: "mob:<ключ>" или data:image/… */
export function mobKey(ava){return typeof ava==='string'&&ava.startsWith('mob:')?ava.slice(4):''}
export function avaURL(ava,seed=''){const k=mobKey(ava);if(k&&MOBS[k])return mobURL(k);if(typeof ava==='string'&&ava.startsWith('data:image/'))return ava;
  let h=0;for(const c of String(seed))h=(h*31+c.charCodeAt(0))>>>0;return mobURL(MOBKEYS[h%MOBKEYS.length])}
export const mobName=ava=>(MOBS[mobKey(ava)]||{}).n||'моб';
export const randomMob=(not='')=>{const ks=MOBKEYS.filter(k=>'mob:'+k!==not);return 'mob:'+ks[Math.floor(Math.random()*ks.length)]};
