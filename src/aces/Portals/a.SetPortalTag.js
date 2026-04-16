export const config = {
  listName: "Set portal tag",
  displayText: "Set portal {0} tag to {1}",
  description: "Assign a string tag to a portal. Tags are used to group portals so they can be removed together with 'Remove portals by tag'. A portal can only have one tag at a time — calling this again replaces the previous tag.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to tag", type: "number", initialValue: "0" },
    { id: "tag", name: "Tag", desc: "Tag string to assign (e.g. \"door\", \"elevator\", \"room_A\")", type: "string", initialValue: '"door"' }
  ]
};

export const expose = true;

export default function (portalId, tag) {
  this.aceSetPortalTag(portalId, tag);
}
