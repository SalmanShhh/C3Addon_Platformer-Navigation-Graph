export const config = {
  returnType: "number",
  description: "Returns the ID of the portal whose entry point is furthest from the given (X, Y) position. If Tag is non-empty, only portals with that tag are considered. Returns -1 if no matching portals exist.",
  params: [
    { id: "x", name: "X", desc: "World X position to measure from.", type: "number" },
    { id: "y", name: "Y", desc: "World Y position to measure from.", type: "number" },
    { id: "tag", name: "Tag", desc: "Tag filter. Leave empty to consider all portals.", type: "string" }
  ]
};

export const expose = true;

export default function (x, y, tag) {
  return this.aceFindFurthestPortalID(x, y, tag);
}
