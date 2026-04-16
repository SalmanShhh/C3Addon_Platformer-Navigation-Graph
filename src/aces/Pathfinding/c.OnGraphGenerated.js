export const config = {
  listName: "On navigation graph generated",
  displayText: "On navigation graph generated",
  description: "Triggered when the navigation graph has been successfully generated. Use this to start pathfinding operations after map setup.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
