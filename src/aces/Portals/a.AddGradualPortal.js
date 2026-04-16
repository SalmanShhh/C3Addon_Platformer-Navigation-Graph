export const config = {
  listName: "Add gradual portal",
  displayText: "Add {0} gradual portal from ({1}, {2}) to ({3}, {4}) [Cost: {5}] [Speed: {6}] [Tag: {7}]",
  description: "Add a portal that gradually moves the AI from entry to exit at the given speed. The character moves in a straight line (any direction — vertical, horizontal, or diagonal). Platform behavior is disabled during movement. Use for: elevators, lifts, moving platforms, ziplines.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "two_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryX", name: "Entry X", desc: "Entry world X position in pixels", type: "number", initialValue: "0" },
    { id: "entryY", name: "Entry Y", desc: "Entry world Y position in pixels", type: "number", initialValue: "0" },
    { id: "exitX", name: "Exit X", desc: "Exit world X position in pixels", type: "number", initialValue: "0" },
    { id: "exitY", name: "Exit Y", desc: "Exit world Y position in pixels", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "Movement cost. Default 1 = auto-calculated from distance and speed. Set higher to make AI avoid this portal.", type: "number", initialValue: "1" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" },
    { id: "tag", name: "Tag", desc: "Optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (direction, entryX, entryY, exitX, exitY, cost, speed, tag) {
  this.aceAddGradualPortal(this._combo(direction, ["one_way", "two_way"]), entryX, entryY, exitX, exitY, cost, speed, tag);
}
