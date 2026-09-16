export const config = {
  listName: "Find path to position (advanced)",
  displayText: "{my}: Find path to ({0}, {1}) [Ground correction: {2}] [Mode: {3}] [Jump positioning: {4}]",
  description: "Calculate a path to the target coordinates with full control over ground correction, path mode, and jump positioning. For the common case, the simpler 'Find path' or 'Find path to object' actions are recommended.",
  params: [
    { id: "x", name: "X", desc: "Target X position in pixels", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "Target Y position in pixels", type: "number", initialValue: "0" },
    { id: "correctToGround", name: "Correct to ground", desc: "Snap start/target to nearest walkable ground position", type: "combo", initialValue: "no", items: [{ no: "No" }, { yes: "Yes" }] },
    { id: "mode", name: "Mode", desc: "Path mode: 'reach' finds a complete path or fails. 'nearest' paths as close as possible and never fails.", type: "combo", initialValue: "reach", items: [{ reach: "Reach (default)" }, { nearest: "Nearest (never fails)" }] },
    { id: "strict", name: "Jump Positioning", desc: "Control how carefully the character positions itself before jumps and falls on THIS specific path. 'Default' uses whatever the property or SetStrictJumpPositioning action is set to. 'Strict' forces careful positioning. 'Relaxed' skips positioning checks for maximum speed.", type: "combo", initialValue: "default", items: [{ default: "Default (use property)" }, { strict: "Strict" }, { relaxed: "Relaxed" }] }
  ]
};

export const expose = true;

export default function (x, y, correctToGround, mode, strict) {
  this.aceFindPath(
    x, y,
    this._combo(correctToGround, ["no", "yes"]) === "yes",
    this._combo(mode, ["reach", "nearest"]),
    this._combo(strict, ["default", "strict", "relaxed"])
  );
}
