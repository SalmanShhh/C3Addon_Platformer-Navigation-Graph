export const config = {
  returnType: "number",
  description: "Returns the number of portals that contain the given tag token (checked within each portal's comma-separated tag string).",
  params: [
    { id: "tag", name: "Tag", desc: "The tag token to search for (e.g. \"door\").", type: "string" }
  ]
};

export const expose = true;

export default function (tag) {
  return this.aceGetPortalCountByTag(tag);
}
