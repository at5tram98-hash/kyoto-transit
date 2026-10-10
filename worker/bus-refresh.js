export const BUS_CHOICE_CACHE_TTL=900;
export const BUS_CHOICE_LIVE_AGE=240000;

export function choiceAge(value,now=Date.now()){
  const at=Date.parse(value?.capturedAt??'');
  return Number.isFinite(at)?Math.max(0,now-at):Infinity;
}

export function oldestChoiceIndexes(cached=[],limit=2,now=Date.now()){
  return cached.map((value,index)=>({index,value,age:choiceAge(value,now)}))
    .sort((a,b)=>Number(Boolean(a.value))-Number(Boolean(b.value))||b.age-a.age||a.index-b.index)
    .slice(0,Math.max(0,limit))
    .map(x=>x.index);
}
