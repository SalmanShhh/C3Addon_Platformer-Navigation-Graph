export const config = {
  listName: "Set max fall distance",
  displayText: "{my}: Set max fall distance to {0} px",
  description: "Override the maximum fall distance (in pixels) the AI is allowed to drop when pathfinding. Falls beyond this value will not be considered as valid connections. Calling this locks in the value.",
  params: [
    { id: "value", name: "Distance", desc: "The maximum fall distance, in pixels.", type: "number", initialValue: "300" }
  ]
};

export const expose = true;

export default function (value) {
  this.maxFallDistance = value;
  this._jumpParamsOverridden = true;
}
