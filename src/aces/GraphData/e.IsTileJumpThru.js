export const config = {
  returnType: "number",
  description: "Returns 1 if the tile at the given grid coordinates is a jump-through tile, 0 otherwise.",
  params: [
    { id: "gx", name: "Grid X", desc: "Tile grid X", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Tile grid Y", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetIsTileJumpThru(gx, gy);
}
