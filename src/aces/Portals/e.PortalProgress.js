export const config = {
  returnType: "number",
  description: "Get the 0-1 traversal progress for gradual portals. Returns 0 if not traversing."
};

export const expose = true;

export default function () {
  return this.aceGetPortalProgress();
}
