export const config = {
  listName: "Add gradual portal",
  displayText: "{my}: Add {0} gradual portal from ({1}, {2}) to ({3}, {4}) [Cost: {5}] [Speed: {6}] [Tag: {7}]",
  description: "Add a portal that gradually moves the AI from entry to exit at the given speed. The character moves in a straight line (any direction: vertical, horizontal, or diagonal). Platform behavior is disabled during movement. Use for: elevators, lifts, moving platforms, ziplines.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "two_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryX", name: "Entry X", desc: "The X co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "entryY", name: "Entry Y", desc: "The Y co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "exitX", name: "Exit X", desc: "The X co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" },
    { id: "exitY", name: "Exit Y", desc: "The Y co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "The movement cost. The default of 1 is calculated automatically from distance and speed; set it higher to make the AI avoid this portal.", type: "number", initialValue: "1" },
    { id: "speed", name: "Speed", desc: "The movement speed, in pixels per second.", type: "number", initialValue: "100" },
    { id: "tag", name: "Tag", desc: "An optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (direction, entryX, entryY, exitX, exitY, cost, speed, tag) {
  this.aceAddGradualPortal(this._combo(direction, ["one_way", "two_way"]), entryX, entryY, exitX, exitY, cost, speed, tag);
}
