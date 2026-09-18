export const config = {
  listName: "Set crowd arrivals",
  displayText: "{my}: Set crowd arrivals: {0}",
  description: "Enable or disable crowd arrivals. When enabled, characters pathing to the same position each claim a landing spot so the others automatically target neighboring spots instead of stacking. Per map tag. Combine with 'Set idle separation' to also push overlapping idle characters apart.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Whether to enable or disable crowd arrivals.", type: "combo", initialValue: "yes",
      // Item order is immutable (combo values stored by index).
      items: [{ yes: "Enabled" }, { no: "Disabled" }]
    }
  ]
};

export const expose = true;

export default function (enabled) {
  this.aceSetCrowdArrivals(this._combo(enabled, ["yes", "no"]) === "yes");
}
