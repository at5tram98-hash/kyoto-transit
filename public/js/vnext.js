import {createNetwork} from './network.js';
import {locate} from './mobility.js';
import {createLocationSession} from './location-session.js';
import {mountTimetables,mountOperations} from './timetable-ui.js';
import {$,$$,esc,icon,state,haptic,tokyoNow,augmentKyotoBusGeometry,ensureRailFeed,nearest} from './vnext-state.js';
import {autoDetectRide,updateBusTrail} from './vnext-detect.js';
import {renderNow} from './vnext-view.js';
import {renderSettings,setupSettings,refreshNetwork} from './vnext-network-view.js';
import {openFoldback,setupFoldback} from './vnext-foldback.js';
import {mountArrivals} from './vnext-arrivals.js';

let timetables,operations,arrivals;
function setTab(tab){if(!['now','timetable','operations','settings'].includes(tab))return;state.tab=tab;$$('[data-view]').forEach(v=>v.hidden=v.dataset.view!==tab);$$('.tab-button').forEach(b=>{const active=b.dataset.tab===tab;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});$('#view-title').textContent={now:'今',timetable:'時刻表',operations:'運行情報',settings:'設定'}[tab];$('#view-subtitle').textContent=tab==='now'?'現在地に合わせて自動案内':'My Map';if(tab==='operations'){arrivals?.show();operations.show();}if(tab==='settings')renderSettings();window.scrollTo({top:0,behavior:'instant'});haptic();}
function setupEvents(){
  $('.tabbar').addEventListener('click',e=>{const b=e.target.closest('[data-tab]');if(b)setTab(b.dataset.tab);});
  document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-retry-location'))state.locationSession?.start({retry:true});else if(b.dataset.openTimetable){timetables.select(b.dataset.openTimetable);setTab('timetable');}else if(b.dataset.openArrivals){await arrivals?.selectStop(b.dataset.openArrivals,true);setTab('operations');}else if(b.id==='ride-foldback')openFoldback();else if(b.id==='ride-operations')setTab('operations');else if(b.id==='ride-end'){state.ride=null;state.rideShift=0;state.rideConfidence=0;state.rideSource=null;renderNow();}else if(b.id==='network-refresh')refreshNetwork();else if(b.id==='location-indicator')state.locationSession?.start({retry:true});});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderNow();if(state.tab==='operations'){arrivals?.show();operations.show();}autoDetectRide(true,renderNow);}});setupFoldback();
}
async function init(){
  $('.tabbar').innerHTML=[['now','今'],['timetable','時刻表'],['operations','運行情報'],['settings','設定']].map(([id,label])=>`<button class="tab-button ${id==='now'?'active':''}" data-tab="${id}" aria-current="${id==='now'?'page':'false'}">${icon(id)}<span>${label}</span></button>`).join('');
  try{
    const [catalog,geo]=await Promise.all([fetch('data/bus-catalog.json').then(r=>{if(!r.ok)throw Error('路線データを読み込めません');return r.json();}),fetch('data/locations.json').then(r=>{if(!r.ok)throw Error('位置データを読み込めません');return r.json();})]);
    state.network=createNetwork(catalog);state.geo=geo;augmentKyotoBusGeometry();timetables=mountTimetables({network:state.network,getState:()=>({favorites:[]}),now:tokyoNow,setTab});operations=mountOperations();arrivals=mountArrivals({network:state.network,setTab});renderSettings();setupSettings(renderNow);setupEvents();
    state.locationSession=createLocationSession({geolocation:navigator.geolocation,loadData:async()=>state.geo,onStatus:s=>{state.locationStatus=s;renderNow();},onPosition:(p,g)=>{state.geo=g;state.fix={lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy,timestamp:p.timestamp,speed:p.coords.speed,heading:p.coords.heading};state.samples=[...state.samples.filter(x=>p.timestamp-x.timestamp<120000),state.fix].slice(-40);state.location=locate(state.fix,state.geo,state.network);const near=nearest(),bus=near.all.find(s=>s.stop.type==='citybus');updateBusTrail(bus?.id,bus?.meters??Infinity);renderNow();autoDetectRide(false,renderNow);if(state.tab==='operations')arrivals.show();}});
    state.locationSession.start();renderNow();setInterval(()=>{if(document.hidden)return;renderNow();autoDetectRide(false,renderNow);if(state.ride&&['kintetsu','through'].includes(state.ride.operator)&&Date.now()-state.railFeedAt>45000)ensureRailFeed().then(renderNow);},15000);
  }catch(e){console.error(e);$('#now-hero').innerHTML=`<section class="hero-card warning"><h2>起動できませんでした</h2><p>${esc(e.message)}</p><button class="primary-action" data-reload>再読み込み</button></section>`;document.addEventListener('click',ev=>{if(ev.target.closest('[data-reload]'))location.reload();},{once:true});}
}
init();
