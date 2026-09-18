export const config = {
  returnType: "number",
  description: "Returns 1 if the node at the given grid coordinates is an island node (no horizontal neighbors), 0 otherwise.",
  params: [
    { id: "gx", name: "Grid X", desc: "The tile X co-ordinate of the node.", type: "number" },
    { id: "gy", name: "Grid Y", desc: "The tile Y co-ordinate of the node.", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceIsNodeIsland(gx, gy);
}
