export const config = {
  listName: "On Pathfinding map ready",
  displayText: "On Pathfinding map ready",
  description: "Triggered when the Pathfinding behavior's obstacle map is ready for use. Use this to start graph generation after Pathfinding initialization.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
