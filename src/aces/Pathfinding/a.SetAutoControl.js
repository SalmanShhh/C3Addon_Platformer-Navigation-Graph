export const config = {
  listName: "Set auto-control",
  displayText: "{my}: Set auto-control: {0}",
  description: "Toggle auto-movement on/off. When enabled, the behavior automatically controls the Platform behavior to follow paths. When disabled, you control movement yourself using path data expressions.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable auto-control", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
};

export const expose = true;

export default function (enabled) {
  this.autoControl = this._combo(enabled, ["yes", "no"]) === "yes";
}
