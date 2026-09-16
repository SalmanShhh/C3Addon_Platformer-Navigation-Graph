export const config = {
  listName: "Add circle hazard",
  displayText: "{my}: Add circle hazard at ({0}, {1}) [Radius: {2}] [Severity: {3}]",
  description: "Add a circular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for dynamic danger zones like explosions or enemy AOE.",
  params: [
    { id: "x", name: "X", desc: "World X position (center)", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "World Y position (center)", type: "number", initialValue: "0" },
    { id: "radius", name: "Radius", desc: "Radius in pixels", type: "number", initialValue: "32" },
    { id: "severity", name: "Severity", desc: "Hazard severity (higher = more dangerous)", type: "number", initialValue: "10" }
  ]
};

export const expose = true;

export default function (x, y, radius, severity) {
  this.aceAddCircleHazard(x, y, radius, severity);
}
