export const config = {
  listName: "Set portal position from objects",
  displayText: "{my}: Move portal {0} to {1} -> {2}",
  description: "Move an existing portal to two objects' current positions (first picked instances), preserving its ID, type, cost, speed, and tags. Combine with an Every X seconds event to make a portal follow moving objects, such as a teleporter drone.",
  params: [
    { id: "id", name: "Portal ID", desc: "The portal to move", type: "number", initialValue: "0" },
    { id: "entryObject", name: "Entry object", desc: "The portal entry moves to this object's position", type: "object" },
    { id: "exitObject", name: "Exit object", desc: "The portal exit moves to this object's position", type: "object" }
  ]
};

export const expose = true;

export default function (id, entryObject, exitObject) {
  this.aceSetPortalPositionFromObjects(id, entryObject, exitObject);
}
