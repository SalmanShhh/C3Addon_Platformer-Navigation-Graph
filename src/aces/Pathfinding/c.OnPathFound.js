export const config = {
  listName: "On path found",
  displayText: "On path found",
  description: "Triggered when a path has been successfully calculated. Use this to start custom actions when pathfinding succeeds.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
