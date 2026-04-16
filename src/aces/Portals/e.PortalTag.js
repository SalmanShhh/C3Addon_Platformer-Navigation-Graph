export const config = {
  returnType: "string",
  description: "Get the tag of a portal by its ID. Returns an empty string if the portal has no tag or doesn't exist.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The ID of the portal to query", type: "number" }
  ]
};

export const expose = true;

export default function (portalId) {
  return this.aceGetPortalTag(portalId);
}
