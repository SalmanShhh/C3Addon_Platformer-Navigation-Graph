export const config = {
  listName: "Is calculating path",
  displayText: "{my}: Is calculating path",
  description: "True when a pathfinding request has been submitted but not yet resolved (queued behind the per-tick path budget). Use to show a 'thinking' state or delay actions until the path arrives.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.pathPending;
}
