export const config = {
  listName: "Find path",
  displayText: "{my}: Find path to ({0}, {1})",
  description: "Calculate a path to a position using sensible defaults: start and target snap to the nearest walkable ground, and if the exact target is unreachable the character paths as close as possible (never fails outright). This is the recommended action for most games. Use 'Find path to position (advanced)' for full control over ground correction, mode, and jump positioning.",
  params: [
    { id: "x", name: "X", desc: "The target X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The target Y co-ordinate, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  this.aceFindPathTo(x, y);
}
