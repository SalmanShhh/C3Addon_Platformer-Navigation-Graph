export const config = {
  listName: "Is moving along path",
  displayText: "{my}: Is moving along path",
  description: "Check if the character currently has an active pathfinding path. Returns true while navigating, false when idle or path is complete. Matches the built-in Pathfinding behavior's 'Is moving along path'.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.hasPath;
}
