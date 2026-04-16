export const config = {
  returnType: "number",
  description: "Get the number of outgoing connections from the node at the given grid coordinates.",
  params: [
    { id: "gx", name: "Grid X", desc: "Node grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Node grid Y coordinate", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetNodeConnectionCount(gx, gy);
}
