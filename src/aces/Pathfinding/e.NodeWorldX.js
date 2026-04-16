export const config = {
  returnType: "number",
  description: "Get the world X position of a node at the specified grid coordinates. The node position is centred within the tile. Returns 0 if node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetNodeWorldX(gx, gy);
}
