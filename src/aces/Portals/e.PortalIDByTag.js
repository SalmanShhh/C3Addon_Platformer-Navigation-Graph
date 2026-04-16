export const config = {
  returnType: "number",
  description: "Returns the portal ID at the given index within the set of portals that contain the given tag. Returns -1 if the index is out of range. Use PortalCountByTag to get the total count.",
  params: [
    { id: "tag", name: "Tag", desc: "The tag token to search for (e.g. \"door\").", type: "string" },
    { id: "index", name: "Index", desc: "Zero-based index within the matched portals.", type: "number" }
  ]
};

export const expose = true;

export default function (tag, index) {
  return this.aceGetPortalIDByTag(tag, index);
}
