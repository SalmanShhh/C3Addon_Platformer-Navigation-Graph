export const config = {
  listName: "Set strict jump positioning",
  displayText: "{my}: Set strict jump positioning: {0}",
  description: "Toggle whether this AI character slows down and carefully positions itself before jumping or falling during pathfinding. This does NOT affect walking off edges (use 'Set ledge restriction' for that). Use this to change behavior at runtime — for example, disable when a boss enters 'rage mode' for reckless movement, or enable when an NPC needs to carefully cross a narrow bridge.",
  params: [
    { id: "enabled", name: "Enabled", desc: "Enable or disable strict jump positioning", type: "combo", initialValue: "yes", items: [{ yes: "Enabled" }, { no: "Disabled" }] }
  ]
};

export const expose = true;

export default function (enabled) {
  this.strictPositioning = this._combo(enabled, ["yes", "no"]) === "yes";
}
