// The Settings hierarchy is an explicit information architecture, not
// positional string placeholders. All legacy destinations remain reachable.
export const settingsGroups = Object.freeze([
  Object.freeze({id:"transit", rows:["pass","distance","auto","routes"]}),
  Object.freeze({id:"experience", rows:["notifications","location","display"]}),
  Object.freeze({id:"saved", rows:["saved-places","saved-routes"]}),
  Object.freeze({id:"about", rows:["info","privacy","terms","advanced","permissions"]}),
]);
export function groupSettingsRows(entries) {
  const rows=new Map(entries.map(([key,html])=>[key,html]));
  return settingsGroups.map(group=>({
    id:group.id, rows:group.rows.map(key=>({key,html:rows.get(key)??""}))
      .filter(item=>item.html),
  }));
}
