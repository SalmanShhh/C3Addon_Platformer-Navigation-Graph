export const config = {
  returnType: "string",
  description: "Returns 'instant' or 'gradual' for the given portal ID.",
  params: [
    { id: "portalId", name: "Portal ID", desc: "The portal ID to check", type: "number" }
  ]
};

export const expose = true;

export default function (portalId) {
  return this.aceGetPortalType(portalId);
}
