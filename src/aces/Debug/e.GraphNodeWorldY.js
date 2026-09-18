export const config = {
  returnType: "number",
  description: "Get the world Y position of a node at the specified grid coordinates. The node position is centred within the tile. Returns 0 if node doesn't exist.",
  params: [
    { id: "gx", name: "Grid X", desc: "The tile X co-ordinate.", type: "number" },
    { id: "gy", name: "Grid Y", desc: "The tile Y co-ordinate.", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetNodeWorldY(gx, gy);
}
