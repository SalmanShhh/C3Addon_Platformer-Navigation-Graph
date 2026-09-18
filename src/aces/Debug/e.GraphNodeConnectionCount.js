export const config = {
  returnType: "number",
  description: "Get the number of outgoing connections from the node at the given grid coordinates.",
  params: [
    { id: "gx", name: "Grid X", desc: "The tile X co-ordinate of the node.", type: "number" },
    { id: "gy", name: "Grid Y", desc: "The tile Y co-ordinate of the node.", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetNodeConnectionCount(gx, gy);
}
