export const config = {
  listName: "Is crowd feature enabled",
  displayText: "{my}: {0} is enabled",
  description: "True if the chosen crowd feature is currently enabled.",
  isInvertible: true,
  params: [
    { id: "feature", name: "Feature", desc: "Crowd arrivals: characters claim their own landing spot at a shared destination. Multi-agent avoidance: characters avoid choosing overlapping paths.", type: "combo", initialValue: "crowd_arrivals",
      items: [{ crowd_arrivals: "Crowd arrivals" }, { avoidance: "Multi-agent avoidance" }]
    }
  ]
};

export const expose = true;

export default function (feature) {
  if (this._combo(feature, ["crowd_arrivals", "avoidance"]) === "crowd_arrivals") {
    return this.aceIsCrowdArrivalsEnabled() === 1;
  }
  return !!this.aceIsMultiAgentAvoidanceEnabled();
}
