export const config = {
  listName: "Add elevator stop from object",
  displayText: "{my}: Add elevator stop to group {0} at {1} [Speed: {2}] [Tag: {3}]",
  description: "Add an elevator stop using an object's position. Same as 'Add elevator stop' but uses the object's current X/Y. The object serves as a floor marker.",
  params: [
    { id: "groupId", name: "Group", desc: "The elevator group name.", type: "string", initialValue: '"elevator_A"' },
    { id: "object", name: "Object", desc: "The object to use as the elevator stop position", type: "object" },
    { id: "speed", name: "Speed", desc: "The movement speed, in pixels per second.", type: "number", initialValue: "100" },
    { id: "tag", name: "Tag", desc: "An optional tag for grouping portals. Use commas for multiple tags (e.g. \"door,room_A\"). Leave empty for no tag.", type: "string", initialValue: '""' }
  ]
};

export const expose = true;

export default function (groupId, object, speed, tag) {
  this.aceAddElevatorStopFromObject(groupId, object, speed, tag);
}
