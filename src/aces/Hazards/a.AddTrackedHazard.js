export const config = {
  listName: "Add tracked hazard (follows object)",
  displayText: "{my}: Add tracked hazard following {0} [Radius: {1}] [Severity: {2}]",
  description: "Add a circular hazard that follows an object's position automatically every tick, for moving dangers like patrolling saws, fireballs, or spreading flames. No per-frame events are needed: path costs update only when the object actually moves, and the hazard removes itself when the object is destroyed. Read the new hazard's ID with LastHazardID; RemoveHazard removes it like any other hazard.",
  params: [
    { id: "target", name: "Object to follow", desc: "The hazard follows this object's position (first picked instance)", type: "object" },
    { id: "radius", name: "Radius", desc: "The radius, in pixels.", type: "number", initialValue: "64" },
    { id: "severity", name: "Severity", desc: "The hazard severity. Higher values are more dangerous.", type: "number", initialValue: "10" }
  ]
};

export const expose = true;

export default function (target, radius, severity) {
  this.aceAddTrackedHazard(target, radius, severity);
}
