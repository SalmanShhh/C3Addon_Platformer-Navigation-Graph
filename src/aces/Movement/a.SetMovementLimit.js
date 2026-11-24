export const config = {
  listName: "Set movement setting",
  displayText: "{my}: Set {0} to {1}",
  description: "Change a movement setting. Jump and fall limits override the values read from the Platform behavior and lock in; the navigation graph rebuilds automatically.",
  params: [
    {
      id: "limit",
      name: "Setting",
      desc: "Jump height: the highest reachable jump, in pixels. Jump distance: the widest standstill jump, in pixels. Fall distance: the deepest safe drop, in pixels. Coyote time: how long after walking off a ledge a jump is still allowed, in seconds (0 = off). Ledge leniency: how far past a ledge edge the character may walk before stopping when Ledge Restriction is on, in pixels.",
      type: "combo",
      initialValue: "jump_height",
      items: [
        { jump_height: "Jump height" },
        { jump_distance: "Jump distance" },
        { fall_distance: "Fall distance" },
        // Appended (index-safe): absorbed the old Set coyote time / Set ledge leniency actions
        { coyote_time: "Coyote time" },
        { ledge_leniency: "Ledge leniency" }
      ]
    },
    { id: "value", name: "Value", desc: "The new value, in pixels (seconds for Coyote time).", type: "number", initialValue: "150" }
  ]
};

export const expose = true;

export default function (limit, value) {
  const key = this._combo(limit, ["jump_height", "jump_distance", "fall_distance", "coyote_time", "ledge_leniency"]);
  if (key === "ledge_leniency") {
    this.ledgeLeniency = value; // movement-time only, no graph change
    return;
  }
  if (key === "coyote_time") {
    this.coyoteTime = value;
    this._markMapChanged(); // coyote-jump connections depend on it
    return;
  }
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
  this._markMapChanged(); // jump/fall connections depend on these limits
}
