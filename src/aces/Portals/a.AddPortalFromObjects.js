export const config = {
  listName: "Add portal from objects",
  displayText: "{my}: Add {0} {1} portal from {2} to {3} [Cost: {4}] [Speed: {5}] [Tag: {6}]",
  description: "Add a portal between two objects. The portal follows the objects as they move and is removed if either object is destroyed.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "two_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "type", name: "Type", desc: "Instant: teleports the character from entry to exit (doors, warp pads). Gradual: moves the character in a straight line at the given speed with the Platform behavior paused (elevators, ziplines).", type: "combo", initialValue: "instant",
      items: [{ instant: "Instant" }, { gradual: "Gradual" }]
    },
    { id: "entryObject", name: "Entry object", desc: "The object to use as the portal entry.", type: "object" },
    { id: "exitObject", name: "Exit object", desc: "The object to use as the portal exit.", type: "object" },
    { id: "cost", name: "Cost", desc: "The movement cost. 1 is the default (for Gradual it is calculated from distance and speed); set it higher to make characters avoid this portal.", type: "number", initialValue: "1" },
    { id: "speed", name: "Speed", desc: "The movement speed for Gradual portals, in pixels per second. Ignored for Instant portals.", type: "number", initialValue: "100" },
    { id: "tag", name: "Tag", desc: "An optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (direction, type, entryObject, exitObject, cost, speed, tag) {
  const dir = this._combo(direction, ["one_way", "two_way"]);
  if (this._combo(type, ["instant", "gradual"]) === "gradual") {
    this.aceAddGradualPortalFromObjects(dir, entryObject, exitObject, cost, speed, tag);
  } else {
    this.aceAddInstantPortalFromObjects(dir, entryObject, exitObject, cost, tag);
  }
}
