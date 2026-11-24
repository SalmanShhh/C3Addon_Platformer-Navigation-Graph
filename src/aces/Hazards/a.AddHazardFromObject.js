export const config = {
  listName: "Add hazard from object",
  displayText: "{my}: Add hazard from {0} [Severity: {1}]",
  description: "Turn objects into hazards. Every picked instance becomes a hazard matching its collision shape. One that moves covers the whole space it moves through. Removed when the object is destroyed.",
  params: [
    { id: "object", name: "Object", desc: "The objects to avoid. Every picked instance gets its own hazard.", type: "object" },
    { id: "severity", name: "Severity", desc: "The hazard severity. Higher values are more dangerous.", type: "number", initialValue: "10" }
  ]
};

export const expose = true;

export default function (object, severity) {
  this.aceAddHazardFromObject(object, severity);
}
