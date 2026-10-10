import {subwayIds,kintetsuIds} from './network.js';
import {distance} from './mobility.js';
import {trajectory,freshFix} from './riding.js';
import {getRailLocation,CAPTURE_API} from './live.js';
import {officialData} from './timetable-ui.js';

export const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
export const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const minuteOf=time=>{const [h,m]=String(time).split(':').map(Number);return h*60+m;};
export const tokyoNow=()=>{const p=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).split(' ');return {date:p[0],time:p[1],minute:minuteOf(p[1])};};
const icons={
 now:'<path d="M4 12a8 8 0 1 0 16 0A8 8 0 0 0 4 12Z"/><path d="M12 7v5l3 2"/>',
 timetable:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M8 3v4m8-4v4M4 10h16M8 14h3m2 0h3m-8 3h3m2 0h3"/>',
 operations:'<path d="M4 16c2-5 4-7 8-7s6 2 8 7"/><circle cx="12" cy="17" r="2"/><path d="M7 11 5 8m12 3 2-3M12 7V3"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.4-1a8 8 0 0 0 1.7 1l.4 3h5l.4-3a8 8 0 0 0 1.7-1l2.4 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1Z"/>',
 location:'<path d="m12 3 7 18-7-5-7 5Z"/>',train:'<rect x="5" y="3" width="14" height="16" rx="4"/><path d="M5 11h14M12 3v8M8 22l2-3m6 3-2-3M8 15h.01M16 15h.01"/>',
 bus:'<rect x="4" y="4" width="16" height="15" rx="3"/><path d="M4 11h16M12 4v7M7 19v3m10-3v3M7 15h.01M17 15h.01"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.2 7.7A8 8 0 0 1 19 9m-1.2 7.3A8 8 0 0 1 5 15"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',fold:'<path d="M5 17V9a5 5 0 0 1 10 0v10m-4-4 4 4 4-4"/>',close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
export const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]??icons.info}</svg>`;
export const settings=Object.assign({autoDetect:true,haptics:true,showConfidence:false,railGuideDistance:350,passCityBus:false,passKyotoBus:false,passSubway:false,passSubwayFrom:'K01',passSubwayTo:'K11',passExpires:''},JSON.parse(localStorage.getItem('mymap-vnext-settings')||'{}'));
export const saveSettings=()=>localStorage.setItem('mymap-vnext-settings',JSON.stringify(settings));
export const state={network:null,geo:null,fix:null,location:null,samples:[],tab:'now',ride:null,rideSource:null,rideConfidence:0,rideShift:0,rideCandidates:[],rideConsensusCount:0,railFeed:null,railFeedAt:0,subwayFeed:null,subwayFeedAt:0,subwayStaticFeed:null,subwayStaticFeedDate:null,subwayStaticFeedAt:0,kyotoBusFeed:null,kyotoBusFeedAt:0,busLive:null,busLiveAt:0,busTrail:[],detectBusy:false,lastDetectAt:0,lastNearbyId:null,locationStatus:'loading',locationSession:null,lastRideSeenAt:0,foldbackRide:null};
export const haptic=()=>{if(settings.haptics&&navigator.vibrate)navigator.vibrate(8);};
export function toast(message){const el=$('#toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),2800);}
export function nearest(){const {fix,geo,network}=state;if(!fix||!geo||!network||!freshFix(fix))return {rail:null,bus:null,kyotoBus:null,all:[]};const all=geo.stops.filter(s=>network.stops.has(s.id)).map(s=>({...s,meters:distance(fix,s),stop:network.stops.get(s.id)})).sort((a,b)=>a.meters-b.meters);return {all,rail:all.find(s=>['subway','kintetsu'].includes(s.stop.type)),bus:all.find(s=>['citybus','kyotobus'].includes(s.stop.type)),kyotoBus:all.find(s=>s.stop.type==='kyotobus')};}
export function speed(){const m=trajectory(state.samples);return Number.isFinite(m.speed)?m.speed:0;}
export function augmentKyotoBusGeometry(){for(const [id,name] of [['kyotobus-karasuma-marutamachi','烏丸丸太町'],['kyotobus-senbon-marutamachi','千本丸太町']]){if(state.geo.stops.some(s=>s.id===id))continue;const city=[...state.network.stops.values()].find(s=>s.type==='citybus'&&s.name===name),point=city&&state.geo.stops.find(s=>s.id===city.id);if(point)state.geo.stops.push({id,lat:point.lat,lng:point.lng});}}
export const rideKey=ride=>ride?JSON.stringify([ride.operator,ride.route,ride.from,ride.to,ride.depart,ride.destination]):'';
export function serviceName(ride){if(!ride)return '';if(ride.operator==='subway')return '地下鉄烏丸線';if(ride.operator==='kintetsu')return `近鉄京都線${ride.category==='express'?'・急行':'・普通'}`;if(ride.operator==='through')return `烏丸線→近鉄直通${ride.category==='express'?'・急行':''}`;if(ride.operator==='citybus')return `京都市バス ${ride.route}系統`;if(ride.operator==='kyotobus')return `京都バス ${ride.route}系統`;return ride.label??'乗車中';}
export const modeClass=ride=>['citybus','kyotobus'].includes(ride?.operator)?'bus':ride?.operator==='subway'?'subway':'rail';
export const official=(path,params={})=>officialData(path,params);
export async function ensureRailFeed(force=false){if(!force&&state.railFeed&&Date.now()-state.railFeedAt<45000)return state.railFeed;try{state.railFeed=await getRailLocation(AbortSignal.timeout(45000));state.railFeedAt=Date.now();return state.railFeed;}catch(e){if(force)toast(e.message);return state.railFeed;}}
export async function ensureSubwayFeed(force=false){if(!force&&state.subwayFeed&&Date.now()-state.subwayFeedAt<180000)return state.subwayFeed;const now=tokyoNow();try{const [nOpt,sOpt]=await Promise.all([official('/timetable/options',{stop:'K15'}),official('/timetable/options',{stop:'K01'})]),nBoard=nOpt.boards.find(b=>b.key==='north')??nOpt.boards[0],sBoard=sOpt.boards.find(b=>b.key==='south')??sOpt.boards[0],[north,south]=await Promise.all([official('/timetable',{stop:'K15',direction:nBoard.key,day:'auto',date:now.date}),official('/timetable',{stop:'K01',direction:sBoard.key,day:'auto',date:now.date})]);state.subwayFeed={north,south,fetchedAt:new Date().toISOString()};state.subwayFeedAt=Date.now();return state.subwayFeed;}catch(e){console.warn('subway feed',e);return state.subwayFeed;}}
export function inferRailDirection(fromId,operator='auto'){const ids=operator==='subway'?subwayIds:operator==='kintetsu'?kintetsuIds:state.network.stops.get(fromId)?.type==='subway'?subwayIds:kintetsuIds,i=ids.indexOf(fromId);if(i<0||state.samples.length<2)return null;const first=state.samples[0],last=state.samples.at(-1),get=id=>state.geo.stops.find(s=>s.id===id),south=get(ids[i+1]),north=get(ids[i-1]),ds=south?distance(first,south)-distance(last,south):-Infinity,dn=north?distance(first,north)-distance(last,north):-Infinity;if(Math.max(ds,dn)<20)return null;return ds>dn?'south':'north';}
export {CAPTURE_API};
