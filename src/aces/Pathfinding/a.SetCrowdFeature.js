export const config = {
  listName: "Set crowd feature",
  displayText: "{my}: Set {0}: {1}",
  description: "Enable or disable one of the features that help groups of characters share a map.",
  params: [
    { id: "feature", name: "Feature", desc: "Crowd arrivals: characters pathing to the same position each claim their own landing spot instead of stacking (per map tag). Multi-agent avoidance: characters sharing a map try not to choose overlapping paths.", type: "combo", initialValue: "crowd_arrivals",
      // Item order is immutable (combo values stored by index).
      items: [{ crowd_arrivals: "Crowd arrivals" }, { avoidance: "Multi-agent avoidance" }]
    },
    { id: "state", name: "State", desc: "Whether to enable or disable the feature.", type: "combo", initialValue: "enabled",
      items: [{ enabled: "Enabled" }, { disabled: "Disabled" }]
    }
  ]
};

export const expose = true;

export default function (feature, state) {
  const on = this._combo(state, ["enabled", "disabled"]) === "enabled";
  if (this._combo(feature, ["crowd_arrivals", "avoidance"]) === "crowd_arrivals") {
    this.aceSetCrowdArrivals(on);
  } else {
    this.multiAgentAvoidance = on;
  }
}
