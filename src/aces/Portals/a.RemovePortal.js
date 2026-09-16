export const config = {
  listName: "Remove portal by ID",
  displayText: "{my}: Remove portal with ID {0}",
  description: "Remove a portal by its ID. The portal connection is removed from the navigation graph immediately.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to remove", type: "number", initialValue: "0" }
  ]
};

export const expose = true;

export default function (portalId) {
  this.aceRemovePortal(portalId);
}
