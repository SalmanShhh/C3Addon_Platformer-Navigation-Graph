export const config = {
  returnType: "string",
  description: "Get the state of a tile at the specified grid coordinates. Returns 'solid', 'clear', 'jump-thru', 'avoid', 'slope-left', 'slope-right', or empty string if out of bounds.",
  params: [
    { id: "gx", name: "Grid X", desc: "The tile X co-ordinate.", type: "number" },
    { id: "gy", name: "Grid Y", desc: "The tile Y co-ordinate.", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetTileState(gx, gy);
}
