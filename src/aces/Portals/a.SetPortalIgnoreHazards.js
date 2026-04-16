export const config = {
  listName: "Set portal ignore hazards",
  displayText: "Set portal {0} ignore hazards: {1}",
  description: "Set whether a portal ignores nearby hazards when calculating its pathfinding cost.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to configure", type: "number", initialValue: "0" },
    { id: "ignoreHazards", name: "Ignore hazards", desc: "Whether this portal should ignore hazards", type: "combo", initialValue: "no",
      items: [{ yes: "Yes" }, { no: "No" }]
    }
  ]
};

export const expose = true;

export default function (portalId, ignoreHazards) {
  this.aceSetPortalIgnoreHazards(portalId, this._combo(ignoreHazards, ["yes", "no"]) === "yes");
}
