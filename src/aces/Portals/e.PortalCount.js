export const config = {
  returnType: "number",
  description: "Get the total number of portals."
};

export const expose = true;

export default function () {
  return this.aceGetPortalCount();
}
