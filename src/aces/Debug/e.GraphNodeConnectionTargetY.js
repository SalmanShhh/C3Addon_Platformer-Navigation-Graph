export const config = {
  returnType: "number",
  description: "Get the world Y position of the target node for a connection from the given grid node.",
  params: [
    { id: "gx", name: "Grid X", desc: "Source node grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Source node grid Y", type: "number" },
    { id: "index", name: "Index", desc: "Connection index", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy, index) {
  return this.aceGetNodeConnectionTargetY(gx, gy, index);
}
