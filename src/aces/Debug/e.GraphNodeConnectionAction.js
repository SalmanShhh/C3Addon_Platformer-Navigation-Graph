export const config = {
  returnType: "string",
  description: "Get the action string for a connection from the given grid node (e.g. 'walk', 'jump', 'fall', 'portal').",
  params: [
    { id: "gx", name: "Grid X", desc: "The tile X co-ordinate of the source node.", type: "number" },
    { id: "gy", name: "Grid Y", desc: "The tile Y co-ordinate of the source node.", type: "number" },
    { id: "index", name: "Index", desc: "The zero-based index of the connection.", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy, index) {
  return this.aceGetNodeConnectionAction(gx, gy, index);
}
