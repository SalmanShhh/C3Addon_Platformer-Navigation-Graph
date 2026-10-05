export const config = {
  listName: "Remove portals by tag",
  displayText: "{my}: Remove all portals tagged {0}",
  description: "Remove every portal whose tag matches the given string, or ALL portals when the tag is empty. Graph connections are removed immediately.",
  params: [
    { id: "tag", name: "Tag", desc: "The tag string to match against (e.g. \"door\", \"elevator\", \"room_A\")", type: "string", initialValue: '"door"' }
  ]
};

export const expose = true;

export default function (tag) {
  this.aceRemovePortalsByTag(tag);
}
