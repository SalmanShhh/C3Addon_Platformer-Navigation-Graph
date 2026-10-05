export const config = {
  listName: "Find path to object",
  displayText: "{my}: Find path to {0}",
  description: "Calculate a path to another object's position with sensible defaults: positions snap to walkable ground, and an unreachable target paths as close as possible. Uses the first picked instance.",
  params: [
    { id: "target", name: "Target object", desc: "The object to path toward (first picked instance)", type: "object" }
  ]
};

export const expose = true;

export default function (target) {
  this.aceFindPathToObject(target);
}
