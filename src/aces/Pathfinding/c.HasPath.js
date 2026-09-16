export const config = {
  listName: "Has active path",
  displayText: "{my}: Has active path",
  description: "Check if the character currently has an active pathfinding path. Returns true while navigating, false when idle or path is complete.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.hasPath;
}
