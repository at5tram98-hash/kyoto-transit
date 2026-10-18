// Do not infer a rider's alighting stop from a service terminus or candidate's next stop.
export function selectedAlightingStop(ride, stops = ride?.officialStops ?? []) {
  const id = ride?.userDestination?.id ?? ride?.userDestinationId;
  if (typeof id !== "string" || !id) return null;
  return stops.find((stop) => stop.id === id) ?? null;
}
