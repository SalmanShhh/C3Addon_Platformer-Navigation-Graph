export const config = {
  listName: "Add gradual portal from objects",
  displayText: "Add {0} gradual portal from {1} to {2} [Cost: {3}] [Speed: {4}] [Tag: {5}]",
  description: "Add a gradual portal using two objects. Character moves from entry object to exit object at the given speed. Use for: linking elevator sprites, rope endpoints, etc.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "two_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryObject", name: "Entry object", desc: "The object to use as the portal entry point", type: "object" },
    { id: "exitObject", name: "Exit object", desc: "The object to use as the portal exit point", type: "object" },
    { id: "cost", name: "Cost", desc: "Movement cost (default 1 = auto-calculated)", type: "number", initialValue: "1" },
    { id: "speed", name: "Speed", desc: "Movement speed in pixels per second", type: "number", initialValue: "100" },
    { id: "tag", name: "Tag", desc: "Optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (direction, entryObject, exitObject, cost, speed, tag) {
  this.aceAddGradualPortalFromObjects(this._combo(direction, ["one_way", "two_way"]), entryObject, exitObject, cost, speed, tag);
}
