export const config = {
  listName: "Set ledge restriction",
  displayText: "{my}: Set ledge restriction: {0}",
  description: "Prevents AI characters from walking off platform edges when they have no reason to leave. Useful for patrol guards that should stay on their platform, or NPCs that shouldn't wander off rooftops. This only stops characters from casually walking off edges — if the AI's path requires a jump or fall to reach its goal, it will still leave the platform.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable ledge restriction", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
};

export const expose = true;

export default function (enabled) {
  this.ledgeRestriction = this._combo(enabled, ["yes", "no"]) === "yes";
}
