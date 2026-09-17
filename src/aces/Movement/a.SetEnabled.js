export const config = {
  listName: "Set enabled",
  displayText: "{my}: Set {0}",
  description: "Enable or disable this behavior. While disabled, the character stops following paths and Find path actions are ignored; the current path, graph, and settings are kept and everything resumes when re-enabled. Map setup actions (scans, tiles, portals, hazards) still work while disabled.",
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
