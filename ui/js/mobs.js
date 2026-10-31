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
  ghast:{n:'Гаст',p:{W:'#f0f0f0',w:'#dcdcdc',k:'#2a2a2a',R:'#b23a3a'},g:['WWWwWWWW','WwWWWWwW','WkkWWkkW','WWWWWWWW','WWWWwWWW','WWkkkkWW','WWkRRkWW','WWWWWWWW']},
  chicken:{n:'Курица',p:{W:'#f4f4f4',w:'#e2e2e2',k:'#1b1b1b',Y:'#f2b21b',y:'#d9930f',R:'#d6312b'},g:['WWwWWWWw','WWWWWwWW','wWWWWWWW','WkWWWWkW','WWYYYYWW','WWyyyyWW','WWWRRWWw','wWWRRWWW']},
  panda:{n:'Панда',p:{W:'#f2f2f2',w:'#dcdcdc',K:'#1e1e1e',e:'#ffffff',N:'#2a2a2a'},g:['KKWWWWKK','KWWwWWWK','WWWWWWWW','WKKWWKKW','WKeWWeKW','WWWNNWWW','WwWWWWwW','wWWWWWWw']},
  frog:{n:'Лягушка',p:{G:'#6b9e3a',g:'#5a8a2e',L:'#9fc25a',D:'#2d4d18',w:'#f5f5f5',k:'#111111'},g:['gGGggGGg','GwkGGkwG','GGGGGGGG','GLGGGGLG','GGGGGGGG','GDDDDDDG','GGGGGGGG','gGLLLLGg']},
  wolf:{n:'Волк',p:{W:'#d8d8d8',w:'#c4c4c4',g:'#a9a9a9',L:'#ece8e0',K:'#1a1a1a',k:'#2a2a2a'},g:['WwWWWWwW','WWWWWWWW','WgWWWWgW','WkWWWWkW','WWgLLgWW','WWLKKLWW','WWLLLLWW','wWLLLLWw']},
  cat:{n:'Кот',p:{O:'#e8a14b',o:'#c97f2c',g:'#5ac94a',k:'#151515',W:'#f5efe6',P:'#f19ca8'},g:['OoOOOOoO','OOoooOOO','OOOOOOOO','OgkOOkgO','OOOOOOOO','OOWPPWOO','OOWWWWOO','oOOOOOOo']},
  mooshroom:{n:'Грибная корова',p:{R:'#a8231f',r:'#8c1a17',W:'#e6e6e6',k:'#111111',n:'#c9b8a8',N:'#6a5342'},g:['RrRRRRrR','RWWWRRRR','WWWWWRrR','kWWWRRRk','RWWWRrRR','RnnnnnnR','RnNnnNnR','RnnnnnnR']},
  witch:{n:'Ведьма',p:{P:'#3b2a4d',p:'#2d1f3b',G:'#7cc142',S:'#b48a70',s:'#9c7660',w:'#f2f2f2',g:'#5a2a7a',N:'#8c5f48',m:'#3d7d2f'},g:['PPPPPPPP','pPPGGPPp','SSSSSSSS','SwgSSgwS','SSSNNSSS','SSSNmSSS','SSsNNsSS','SSSSSSSS']},
  pillager:{n:'Разбойник',p:{H:'#3c3c3c',h:'#2e2e2e',S:'#9da3a6',s:'#8b9194',B:'#2a2a2a',w:'#e8e8e8',k:'#1a4a3a',N:'#7f8588'},g:['HhHHHHhH','HHHHHHHH','SSSSSSSS','SBBBBBBS','SwkSSkwS','SSSNNSSS','SsSNNSsS','SSSSSSSS']},
  pumpkin:{n:'Тыква',p:{O:'#e08a1e',o:'#c2700f',Y:'#ffd94a',y:'#ffb52e'},g:['OoOOOOoO','OOOoOOOO','OYYOOYYO','OYyOOyYO','OOOOOOOO','OYOYYOYO','OyYYYYyO','oOOOOOOo']},
  parrot:{n:'Попугай',p:{R:'#e23b2e',r:'#c42c21',w:'#f2f2f2',k:'#111111',Y:'#f5c542',B:'#2e7bd6',b:'#2563b0'},g:['RrRRRRrR','RRRRRRRR','RwkRRkwR','RRRRRRRR','RRYYYYRR','RRRYYRRR','BBRRRRBB','bBBRRBBb']},
  allay:{n:'Тихоня',p:{C:'#4fd6ff',c:'#a8f0ff',B:'#1b4b8a',W:'#ffffff'},g:['CCCCCCCC','CccccccC','CcBccBcC','CcBccBcC','CccccccC','CccWWccC','CCccccCC','cCCCCCCc']},
  warden:{n:'Хранитель',p:{D:'#0f3a3f',d:'#0b2c30',C:'#2fe0d0',c:'#1fa89c'},g:['DdDDDDdD','CDDDDDDC','CDdDDdDC','DDDDDDDD','DcDDDDcD','DDDCCDDD','DdDccDdD','DDDdDDDD']},
  strider:{n:'Лавомерка',p:{R:'#9c2f2f',r:'#7f2424',w:'#e8e0d0',k:'#1a1a1a',M:'#4a1212'},g:['RrRRRRrR','RRRRRRRR','RwkRRkwR','RRRRRRRR','RRMMMMRR','RrRRRRrR','RRRRRRRR','rRRrrRRr']},
  shulker:{n:'Шалкер',p:{P:'#8b5c94',p:'#744a7d',Y:'#f2e7a6',y:'#e0d38a',k:'#2a2a2a'},g:['PPPPPPPP','PpPPPPpP','PPYYYYPP','PYkYYkYP','PYYyyYYP','PPYYYYPP','PpPPPPpP','PPPPPPPP']},
  rabbit:{n:'Кролик',p:{B:'#a57b55',b:'#8e6646',k:'#151515',W:'#efe6da',P:'#e991a1'},g:['BbBBBBbB','BBBBBBBB','BkWBBWkB','BBBBBBBB','BBWPPWBB','BBWWWWBB','bBBWWBBb','BBBBBBBB']},
  husk:{n:'Кадавр',p:{H:'#6b5a3a',h:'#7a6844',s:'#b8a77a',t:'#a89768',u:'#c7b78a',k:'#2a2112',m:'#7a6a44'},g:['HhHHhHHh','hHsHHtHs','ssutsust','skksskku','tsssusst','sutmmtsu','stsmmsts','tsustsus']},
  magma:{n:'Магмовый куб',p:{K:'#3a1212',R:'#ff7a1a',r:'#c94a0e',Y:'#ffd23a'},g:['KRKKrKKR','RKKRKKrK','KYYKKYYK','KrKKKKRK','RKKRrKKR','KKrKKRKK','rKKKKKKR','KRKrKRKK']},
  llama:{n:'Лама',p:{W:'#e8dcc2',w:'#d4c6a8',k:'#1a1a1a',B:'#f4eedf',N:'#6a5342'},g:['WwWWWWwW','WWWWWWWW','WkWWWWkW','WWWWWWWW','WWBBBBWW','WWBNNBWW','WWBBBBWW','wWWWWWWw']}
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
