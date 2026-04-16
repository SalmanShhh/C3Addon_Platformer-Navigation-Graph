export const config = {
  returnType: "number",
  description: "Get the hazard severity of a specific tile. Returns 0 if no hazard. Only checks tile-based hazards, not circles/rects.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate", type: "number" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate", type: "number" }
  ]
};

export const expose = true;

export default function (gx, gy) {
  return this.aceGetTileHazardSeverity(gx, gy);
}
