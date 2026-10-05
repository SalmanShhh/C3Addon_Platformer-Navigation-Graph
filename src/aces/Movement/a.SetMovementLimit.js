export const config = {
  listName: "Set movement limit",
  displayText: "{my}: Set {0} limit to {1} px",
  description: "Override an auto-detected movement limit used to build graph connections. The value locks in and is no longer read from the Platform behavior; regenerate the graph afterwards.",
  params: [
    {
      id: "limit",
      name: "Limit",
      desc: "Jump height: the highest reachable jump. Jump distance: the widest standstill jump. Fall distance: the deepest safe drop.",
      type: "combo",
      initialValue: "jump_height",
      items: [
        { jump_height: "Jump height" },
        { jump_distance: "Jump distance" },
        { fall_distance: "Fall distance" }
      ]
    },
    { id: "value", name: "Value", desc: "The limit, in pixels.", type: "number", initialValue: "150" }
  ]
};

export const expose = true;

export default function (limit, value) {
  const key = this._combo(limit, ["jump_height", "jump_distance", "fall_distance"]);
  if (key === "jump_height") {
    this.maxJumpHeight = value;
    this.singleJumpHeight = value;
  } else if (key === "jump_distance") {
    this.maxJumpDistance = value;
    this.singleJumpDistance = value;
  } else {
    this.maxFallDistance = value;
  }
  this._jumpParamsOverridden = true;
}
