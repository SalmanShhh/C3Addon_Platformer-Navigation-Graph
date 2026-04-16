export const config = {
  returnType: "number",
  description: "Get the exit X position of the current portal. Valid inside OnPortalEntry/OnPortalComplete triggers."
};

export const expose = true;

export default function () {
  return this.aceGetPortalExitX();
}
