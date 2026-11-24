export const config = {
  listName: "Add portal",
  displayText: "{my}: Add {0} {1} portal from ({2}, {3}) to ({4}, {5}) [Cost: {6}] [Speed: {7}] [Tag: {8}]",
  description: "Add a portal between two positions. Characters path through it like any other route. Use 'On portal entry' with 'Pause at portal' to play animations first.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "two_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "type", name: "Type", desc: "Instant: teleports the character from entry to exit (doors, warp pads). Gradual: moves the character in a straight line at the given speed with the Platform behavior paused (elevators, ziplines).", type: "combo", initialValue: "instant",
      items: [{ instant: "Instant" }, { gradual: "Gradual" }]
    },
    { id: "entryX", name: "Entry X", desc: "The X co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "entryY", name: "Entry Y", desc: "The Y co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "exitX", name: "Exit X", desc: "The X co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" },
    { id: "exitY", name: "Exit Y", desc: "The Y co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" },
    { id: "cost", name: "Cost", desc: "The movement cost. 1 is the default (for Gradual it is calculated from distance and speed); set it higher to make characters avoid this portal.", type: "number", initialValue: "1" },
    { id: "speed", name: "Speed", desc: "The movement speed for Gradual portals, in pixels per second. Ignored for Instant portals.", type: "number", initialValue: "100" },
    { id: "tag", name: "Tag", desc: "An optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (direction, type, entryX, entryY, exitX, exitY, cost, speed, tag) {
  const dir = this._combo(direction, ["one_way", "two_way"]);
  if (this._combo(type, ["instant", "gradual"]) === "gradual") {
    this.aceAddGradualPortal(dir, entryX, entryY, exitX, exitY, cost, speed, tag);
  } else {
    this.aceAddInstantPortal(dir, entryX, entryY, exitX, exitY, cost, tag);
  }
}
