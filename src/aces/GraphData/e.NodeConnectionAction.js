export const config = {
  returnType: "string",
  description: "Get the action string for a connection from the given grid node (e.g. 'walk', 'jump', 'fall', 'portal').",
  params: [
    { id: "gx", name: "Grid X", desc: "Source node grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Source node grid Y", type: "number" },
    { id: "index", name: "Index", desc: "Connection index", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy, index) {
  return this.aceGetNodeConnectionAction(gx, gy, index);
}
