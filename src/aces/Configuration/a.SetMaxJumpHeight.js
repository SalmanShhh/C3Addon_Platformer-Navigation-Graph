export const config = {
  listName: "Set max jump height",
  displayText: "Set max jump height to {0} px",
  description: "Override the maximum jump height (in pixels) used to build navigation graph connections. Use this if the auto-detected value from the platform behavior is wrong for your setup. Calling this locks in the value — it won't be overridden by platform behavior properties.",
  params: [
    { id: "value", name: "Height", desc: "Maximum jump height in pixels", type: "number", initialValue: "150" }
  ]
};

export const expose = true;

export default function (value) {
  this.maxJumpHeight = value;
  this.singleJumpHeight = value;
  this._jumpParamsOverridden = true;
}
