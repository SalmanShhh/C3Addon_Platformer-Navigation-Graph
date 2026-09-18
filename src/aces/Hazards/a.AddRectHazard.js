export const config = {
  listName: "Add rectangle hazard",
  displayText: "{my}: Add rectangle hazard at ({0}, {1}) [Size: {2} x {3}] [Severity: {4}]",
  description: "Add a rectangular hazard area. The AI will avoid this area based on severity. Hazard avoidance is automatically enabled. Returns a hazard ID for later removal. Use for static danger zones like spike pits.",
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate of the center, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The Y co-ordinate of the center, in pixels.", type: "number", initialValue: "0" },
    { id: "width", name: "Width", desc: "The width, in pixels.", type: "number", initialValue: "32" },
    { id: "height", name: "Height", desc: "The height, in pixels.", type: "number", initialValue: "32" },
    { id: "severity", name: "Severity", desc: "The hazard severity. Higher values are more dangerous.", type: "number", initialValue: "10" }
  ]
};

export const expose = true;

export default function (x, y, width, height, severity) {
  this.aceAddRectHazard(x, y, width, height, severity);
}
