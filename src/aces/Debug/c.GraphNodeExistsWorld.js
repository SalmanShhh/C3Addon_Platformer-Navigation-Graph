export const config = {
  listName: "Graph node exists at world position",
  displayText: "{my}: Graph node exists at world ({0}, {1})",
  description: "Check if a navigation node exists at the specified world coordinates. Use this to validate world positions before pathfinding.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The Y co-ordinate, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  return this.aceNodeExistsWorld(x, y);
}
