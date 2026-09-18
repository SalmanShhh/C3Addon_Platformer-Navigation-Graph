export const config = {
  listName: "Remove portal at object",
  displayText: "{my}: Remove portal at {0}",
  description: "Remove the portal closest to this object. Works with both entry and exit positions; for two-way portals, either endpoint object can be used.",
  params: [
    { id: "object", name: "Object", desc: "The object whose position to match against portal positions", type: "object" }
  ]
};

export const expose = true;

export default function (object) {
  this.aceRemovePortalAtObject(object);
}
