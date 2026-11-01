// Deliberately loaded only by tests/preview.mjs, never by the application.
(() => {
  const qs = new URLSearchParams(location.search), now = Date.now();
  localStorage.setItem('hunty-prefs', JSON.stringify({boot:false,wall:qs.get('wall') || '',wallBlur:16,wallDim:30,glass:'liquid',glassA:60,lite:qs.has('lite'),sound:false,liveBg:false,font:'system',updT:now,lastChat:'preview-group'}));
  // No permission prompts in the synthetic preview.
  Object.defineProperty(window, 'Notification', {value: class {static permission = 'denied';}});
  const me = 'preview-me', friend = 'preview-friend';
  const members = [{peer:me,nick:'anton',ava:'mob:fox',role:'owner',me:true,online:true},{peer:friend,nick:'vasyan',ava:'mob:axolotl',role:'member',online:true}];
  const messages = [
    {id:'1',from:friend,text:'Вечером собираемся? ✨',ts:now-180000},
    {id:'2',from:me,text:'Да, в девять буду. Можно пока обсудить планы здесь.',ts:now-150000},
    {id:'3',from:friend,text:'Отлично! Зайду в голос и покажу, что построил 🏡',ts:now-120000},
    {id:'4',from:me,text:'Договорились. Приглашай остальных — всё готово.',ts:now-60000},
  ].map(m=>({...m,room:'preview-group',kind:'text',data:{}}));
  const group = {id:'preview-group',kind:'group',name:'Вечерняя компания',color:'#a8c9ff',owner:me,members,voice:true,invite:'all',admin:true,unread:0,count:4,last:messages.at(-1),created:now-86400000};
  const dm = {id:'preview-dm',kind:'dm',name:'',members,voice:true,unread:0,count:0,created:now};
  const state = {version:'0.4.0-preview',me:{peer:me,onboarded:true,profile:{nick:'anton',ava:'mob:fox',line:'на связи'}},friends:[{peer:friend,profile:{nick:'vasyan',ava:'mob:axolotl',line:'строю уютный дом'},state:'friend',dm:dm.id,online:true}],rooms:[group,dm],online:{[friend]:{rtt:24,via:'lan'}},nearby:[],voice:{mine:null,rooms:{}},config:{},ice:[],blocked:[],net:null};
  let sequence = 10;
  window.WebSocket = class {
    constructor() { setTimeout(()=>this.onopen?.({}),0); }
    send(text) {
      const v = JSON.parse(text); let ok = {ok:true};
      if(v.cmd === 'state') ok = state;
      if(v.cmd === 'msgs') ok = {room:v.room,msgs:v.room === group.id ? messages : [],total:v.room === group.id ? messages.length : 0};
      if(v.cmd === 'friend_code') ok = {code:'hunty://add/preview',peer:me};
      if(v.cmd === 'hall') ok = {entries:[],awards:[],week:now};
      if(v.cmd === 'media_list') ok = {msgs:[],total:0};
      if(v.cmd === 'send') {ok={id:String(++sequence),room:v.room,from:me,ts:Date.now(),kind:v.kind,text:v.text,data:v.data || {}}; messages.push(ok);}
      if(v.cmd === 'storage') ok = {rooms:[],total:0,log:0,dir:'preview'};
      if(v.cmd === 'net') ok = {};
      setTimeout(()=>this.onmessage?.({data:JSON.stringify({rid:v.rid,ok})}),0);
    }
    close() {}
  };
})();
