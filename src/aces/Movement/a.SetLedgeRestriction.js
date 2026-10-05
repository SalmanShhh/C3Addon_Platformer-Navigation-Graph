export const config = {
  listName: "Set ledge restriction",
  displayText: "{my}: Set ledge restriction: {0}",
  description: "Toggle whether the character stops at platform edges instead of casually walking off. Paths that require a jump or fall still leave the platform.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Whether to enable or disable ledge restriction.", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
};

export const expose = true;

export default function (enabled) {
  this.ledgeRestriction = this._combo(enabled, ["yes", "no"]) === "yes";
}
