export const config = {
  listName: "Set tile hazard severity",
  displayText: "{my}: Set tile hazard at ({0}, {1}) to {2}",
  description: "Set the hazard severity for a specific tile. Higher values make the AI avoid this tile more strongly. 0 = no hazard. Hazard avoidance is automatically enabled when any hazard is added. Use this to mark dangerous areas like spikes or lava.",
  params: [
    { id: "gx", name: "Grid X", desc: "Grid X coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "gy", name: "Grid Y", desc: "Grid Y coordinate (tile number)", type: "number", initialValue: "0" },
    { id: "severity", name: "Severity", desc: "Hazard severity (0 = none, higher = more dangerous)", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (gx, gy, severity) {
  this.aceSetTileHazard(gx, gy, severity);
}
