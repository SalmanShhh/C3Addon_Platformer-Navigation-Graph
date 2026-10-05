export const config = {
  listName: "Set enabled",
  displayText: "{my}: Set {0}",
  description: "Enable or disable this behavior. Disabled freezes navigation with all state kept for a seamless resume; Find path is ignored, map setup actions still work.",
  params: [
    { id: "state", name: "State", desc: "Whether the behavior is active", type: "combo", initialValue: "enabled",
      items: [
        { enabled: "Enabled" },
        { disabled: "Disabled" }
      ]
    }
  ]
};

export const expose = true;

export default function (state) {
  this.aceSetBehaviorEnabled(this._combo(state, ["enabled", "disabled"]) === "enabled");
}
