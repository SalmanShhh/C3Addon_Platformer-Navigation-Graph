export const config = {
  returnType: "number",
  description: "Get the world X position of the target node for a connection from the given grid node.",
  params: [
    { id: "gx", name: "Grid X", desc: "The tile X co-ordinate of the source node.", type: "number" },
    { id: "gy", name: "Grid Y", desc: "The tile Y co-ordinate of the source node.", type: "number" },
    { id: "index", name: "Index", desc: "The zero-based index of the connection.", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy, index) {
  return this.aceGetNodeConnectionTargetX(gx, gy, index);
}
