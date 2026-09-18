export const config = {
  listName: "Add elevator stop",
  displayText: "{my}: Add elevator stop to group {0} at ({1}, {2}) [Speed: {3}] [Tag: {4}]",
  description: "Add a stop to an elevator group. Automatically creates two-way gradual portals between this stop and all other stops in the same group. Cost is auto-calculated from distance and speed. Use a unique group name (e.g. 'elevator_A') for each elevator. Use PortalExitX/PortalExitY in 'On portal entry' to determine which floor the AI is heading to.",
  params: [
    { id: "groupId", name: "Group", desc: "The elevator group name, e.g. 'elevator_A'.", type: "string", initialValue: '"elevator_A"' },
    { id: "x", name: "X", desc: "The X co-ordinate of this stop, in pixels.", type: "number", initialValue: "0" },
    { id: "y", name: "Y", desc: "The Y co-ordinate of this stop, in pixels.", type: "number", initialValue: "0" },
    { id: "speed", name: "Speed", desc: "The movement speed, in pixels per second.", type: "number", initialValue: "100" },
    { id: "tag", name: "Tag", desc: "An optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (groupId, x, y, speed, tag) {
  this.aceAddElevatorStop(groupId, x, y, speed, tag);
}
