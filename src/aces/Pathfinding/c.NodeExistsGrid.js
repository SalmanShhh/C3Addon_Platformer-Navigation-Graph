export const config = {
  listName: "Node exists at grid position",
  displayText: "Node exists at grid ({0}, {1})",
  description: "Check if a navigation node exists at the specified grid coordinates. Use this to validate positions before pathfinding or placing objects.",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceNodeExistsGrid(gx, gy);
}
