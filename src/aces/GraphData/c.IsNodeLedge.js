export const config = {
  listName: "Is node a ledge",
  displayText: "{my}: Node at ({0}, {1}) is a ledge",
  description: "True if the node at the given grid coordinates is a ledge node (left or right ledge).",
  isInvertible: true,
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceIsNodeLedge(gx, gy);
}
