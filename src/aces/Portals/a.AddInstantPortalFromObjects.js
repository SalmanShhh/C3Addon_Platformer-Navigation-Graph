export const config = {
  listName: "Add instant portal from objects",
  displayText: "{my}: Add {0} instant portal from {1} to {2} [Cost: {3}] [Tag: {4}]",
  description: "Add an instant portal using two objects as entry and exit positions. The objects' current X/Y positions are used. Use for: linking door sprites, warp pad objects, etc.",
  params: [
    { id: "direction", name: "Direction", desc: "One-way: entry to exit only. Two-way: works in both directions.", type: "combo", initialValue: "one_way",
      items: [{ one_way: "One-way" }, { two_way: "Two-way" }]
    },
    { id: "entryObject", name: "Entry object", desc: "The object to use as the portal entry point", type: "object" },
    { id: "exitObject", name: "Exit object", desc: "The object to use as the portal exit point", type: "object" },
    { id: "cost", name: "Cost", desc: "The movement cost. Lower costs are preferred; the default is 1.", type: "number", initialValue: "1" },
    { id: "tag", name: "Tag", desc: "An optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (direction, entryObject, exitObject, cost, tag) {
  this.aceAddInstantPortalFromObjects(this._combo(direction, ["one_way", "two_way"]), entryObject, exitObject, cost, tag);
}
