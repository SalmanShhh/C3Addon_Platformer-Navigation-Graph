export const config = {
  returnType: "string",
  description: "Get the slope direction of a tile at the specified grid coordinates. Returns 'left', 'right', or empty string if not a slope.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetSlopeDirection(gx, gy);
}
