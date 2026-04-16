export const config = {
  returnType: "number",
  description: "Returns the ID of the most recently added portal. Use right after adding a portal to save the ID for later configuration or removal."
};

export const expose = true;

export default function () {
  return this.lastPortalId;
}
