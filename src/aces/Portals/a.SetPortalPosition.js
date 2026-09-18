export const config = {
  listName: "Set portal position",
  displayText: "{my}: Move portal {0} to entry ({1}, {2}) exit ({3}, {4})",
  description: "Move an existing portal to new entry and exit positions, preserving its ID, type, cost, speed, and tags. Graph connections re-wire immediately (cheap enough to call on a timer for moving teleporters). A character already traversing the portal keeps its original destination; the move never teleports anyone.",
  params: [
    { id: "id", name: "Portal ID", desc: "The portal to move", type: "number", initialValue: "0" },
    { id: "entryX", name: "Entry X", desc: "The new X co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "entryY", name: "Entry Y", desc: "The new Y co-ordinate of the portal entry, in pixels.", type: "number", initialValue: "0" },
    { id: "exitX", name: "Exit X", desc: "The new X co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" },
    { id: "exitY", name: "Exit Y", desc: "The new Y co-ordinate of the portal exit, in pixels.", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (id, entryX, entryY, exitX, exitY) {
  this.aceSetPortalPosition(id, entryX, entryY, exitX, exitY);
}
