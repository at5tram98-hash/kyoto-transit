// Single source of truth for route-search shortcuts; these are user actions,
// not implicit defaults. Existing autocomplete and validated planner own IDs.
export function quickSearchStops(network, ids = ["K01","K07","K08","K09","K11","K15","B24"]) {
  return ids.filter((id)=>network?.stops?.has(id))
    .map(id=>({id,name:network.stops.get(id).name}));
}
export function chooseQuickSearchStop(form,stop,side) {
  if (!["from","to"].includes(side) || !stop?.id || !stop?.name)
    return false;
  const input=form?.elements?.[side],hidden=form?.elements?.[`${side}Id`];
  if (!input || !hidden) return false;
  input.value=stop.name;hidden.value=stop.id;
  input.dispatchEvent(new Event("change",{bubbles:true}));
  return true;
}
