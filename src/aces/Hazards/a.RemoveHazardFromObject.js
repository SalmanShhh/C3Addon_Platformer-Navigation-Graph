export const config = {
  listName: "Remove hazard from object",
  displayText: "{my}: Remove hazard from {0}",
  description: "Remove the hazards of the picked objects without destroying them, for example spikes that retract. 'Add hazard from object' brings them back.",
  params: [
    { id: "object", name: "Object", desc: "The objects whose hazards to remove. Every picked instance is cleared.", type: "object" }
  ]
};

export const expose = true;

export default function (object) {
  this.aceRemoveHazardFromObject(object);
}
