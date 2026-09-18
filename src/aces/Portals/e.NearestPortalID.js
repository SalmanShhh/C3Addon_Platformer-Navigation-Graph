export const config = {
  returnType: "number",
  description: "Returns the ID of the portal whose entry point is nearest to the given (X, Y) position. If Tag is non-empty, only portals with that tag are considered. Returns -1 if no matching portals exist.",
  params: [
    { id: "x", name: "X", desc: "The X co-ordinate to measure from, in pixels.", type: "number" },
    { id: "y", name: "Y", desc: "The Y co-ordinate to measure from, in pixels.", type: "number" },
    { id: "tag", name: "Tag", desc: "Tag filter. Leave empty to consider all portals.", type: "string" }
  ]
};

export const expose = true;

export default function (x, y, tag) {
  return this.aceFindNearestPortalID(x, y, tag);
}
