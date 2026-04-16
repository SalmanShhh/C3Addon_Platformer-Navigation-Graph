export const config = {
  returnType: "number",
  description: "Get whether ledge restriction is enabled. Returns 1 if enabled, 0 if disabled."
};

export const expose = true;

export default function () {
  return this.aceGetLedgeRestriction();
}
