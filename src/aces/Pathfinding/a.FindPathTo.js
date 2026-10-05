export const config = {
  listName: "Find path",
  displayText: "{my}: Find path to ({0}, {1})",
  description: "Calculate a path to a position with sensible defaults: positions snap to walkable ground, and an unreachable target paths as close as possible. Use 'Find path to position (advanced)' for full control.",
  params: [
    { id: "x", name: "X", desc: "The target X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The target Y co-ordinate, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  this.aceFindPathTo(x, y);
}
