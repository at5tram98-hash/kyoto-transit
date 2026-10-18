// Desktop sidebar implements the common vertical-navigation keyboard model.
// Return null for unhandled keys so form inputs and normal shortcuts are not stolen.
export function nextSidebarTabIndex(key, current, count) {
  if (!Number.isInteger(current) || !Number.isInteger(count) ||
      count < 1 || current < 0 || current >= count) return null;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current + count - 1) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
