export const config = {
  listName: "Set max jump distance",
  displayText: "Set max jump distance to {0} px",
  description: "Override the maximum horizontal jump distance (in pixels) used to build navigation graph connections. Use this if the auto-detected value from the platform behavior is wrong for your setup. Calling this locks in the value — it won't be overridden by platform behavior properties.",
  params: [
    { id: "value", name: "Distance", desc: "Maximum jump distance in pixels", type: "number", initialValue: "200" }
  ]
};

export const expose = true;

export default function (value) {
  this.maxJumpDistance = value;
  this.singleJumpDistance = value;
  this._jumpParamsOverridden = true;
}
