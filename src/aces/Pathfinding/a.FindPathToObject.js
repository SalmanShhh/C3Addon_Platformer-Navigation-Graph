export const config = {
  listName: "Find path to object",
  displayText: "{my}: Find path to {0}",
  description: "Calculate a path to another object's position (e.g. the player) using sensible defaults: start and target snap to the nearest walkable ground, and if the exact target is unreachable the character paths as close as possible (never fails outright). Uses the first picked instance of the object.",
  params: [
    { id: "target", name: "Target object", desc: "The object to path toward (first picked instance)", type: "object" }
  ]
};

export const expose = true;

export default function (target) {
  this.aceFindPathToObject(target);
}
