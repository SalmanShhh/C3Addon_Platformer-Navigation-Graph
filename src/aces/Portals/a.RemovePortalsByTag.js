export const config = {
  listName: "Remove portals by tag",
  displayText: "{my}: Remove all portals tagged {0}",
  description: "Remove every portal whose tag matches the given string. Connections are removed from the navigation graph immediately. Use this to deactivate a group of related portals: for example, removing all 'door' portals when a room is sealed, or clearing 'floor_2' portals when a floor is destroyed.",
  params: [
    { id: "tag", name: "Tag", desc: "The tag string to match against (e.g. \"door\", \"elevator\", \"room_A\")", type: "string", initialValue: '"door"' }
  ]
};

export const expose = true;

export default function (tag) {
  this.aceRemovePortalsByTag(tag);
}
