export const config = {
  listName: "On path failed",
  displayText: "On path failed",
  description: "Triggered when pathfinding fails to find a valid path to the target. Use this to handle unreachable destinations or implement fallback behaviors.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
