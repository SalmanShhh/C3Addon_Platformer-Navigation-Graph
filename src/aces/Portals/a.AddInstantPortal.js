export const config = {
  listName: "Add instant portal",
  displayText: "{my}: Add {0} instant portal from ({1}, {2}) to ({3}, {4}) [Cost: {5}] [Tag: {6}]",
  description: "Add a portal that instantly teleports the AI from the entry to the exit. Use for: teleporters, doors, warp zones, or any portal where the character disappears and reappears at the exit. Use 'On portal entry' with 'Pause at portal' to play animations before the teleport happens.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "one_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryX", name: "Entry X", desc: "The X co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "entryY", name: "Entry Y", desc: "The Y co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "exitX", name: "Exit X", desc: "The X co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" },
    { id: "exitY", name: "Exit Y", desc: "The Y co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "The cost of using this portal. The default of 1 is the same as walking one tile; lower costs are preferred and higher costs avoided.", type: "number", initialValue: "1" },
    { id: "tag", name: "Tag", desc: "An optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (direction, entryX, entryY, exitX, exitY, cost, tag) {
  this.aceAddInstantPortal(this._combo(direction, ["one_way", "two_way"]), entryX, entryY, exitX, exitY, cost, tag);
}
