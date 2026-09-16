export const config = {
  listName: "Is path pending",
  displayText: "{my}: Is path pending",
  description: "True when a pathfinding request has been submitted but not yet resolved. Use to show a 'thinking' state or delay actions until the path arrives.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.pathPending;
}
