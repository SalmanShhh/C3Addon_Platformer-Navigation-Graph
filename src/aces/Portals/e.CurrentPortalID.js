export const config = {
  returnType: "number",
  description: "Returns the portal ID during OnPortalEntry/OnPortalComplete triggers. Use to identify which portal was reached."
};

export const expose = true;

export default function () {
  return this.currentPortalId;
}
