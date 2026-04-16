export const config = {
  returnType: "number",
  description: "Returns 1 if the node at the given grid coordinates is a left ledge, 0 otherwise.",
  params: [
    { id: "gx", name: "Grid X", desc: "Node grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Node grid Y", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetIsNodeLeftLedge(gx, gy);
}
