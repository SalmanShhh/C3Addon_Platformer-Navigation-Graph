export const config = {
  listName: "Set strict jump positioning",
  displayText: "{my}: Set strict jump positioning: {0}",
  description: "Toggle whether the character slows down and centers itself before jumps and falls. Does not affect walking off edges (use 'Set ledge restriction' for that).",
  params: [
    { id: "enabled", name: "Enabled", desc: "Whether to enable or disable strict jump positioning.", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
};

export const expose = true;

export default function (enabled) {
  this.strictPositioning = this._combo(enabled, ["yes", "no"]) === "yes";
}
