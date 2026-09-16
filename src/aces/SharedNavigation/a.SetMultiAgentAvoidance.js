export const config = {
  listName: "Set multi-agent avoidance",
  displayText: "{my}: Set multi-agent avoidance: {0}",
  description: "Enable or disable path-level multi-agent avoidance. When enabled, agents try to avoid choosing overlapping paths when multiple agents share the same navigation map.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable multi-agent avoidance", type: "combo", initialValue: "yes",
      items: [{ yes: "Yes" }, { no: "No" }]
    }
  ]
};

export const expose = true;

export default function (enabled) {
  this.multiAgentAvoidance = this._combo(enabled, ["yes", "no"]) === "yes";
}
