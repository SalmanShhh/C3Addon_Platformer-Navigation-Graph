export const config = {
  listName: "Node exists at world position",
  displayText: "{my}: Node exists at world ({0}, {1})",
  description: "Check if a navigation node exists at the specified world coordinates. Use this to validate world positions before pathfinding.",
  isInvertible: true,
  params: [
    { id: "x", name: "X", desc: "World X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position in pixels", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (x, y) {
  return this.aceNodeExistsWorld(x, y);
}
