export const config = {
  returnType: "number",
  description: "Get the platform behavior's max speed value. Useful for debugging jump parameter detection."
};

export const expose = true;

export default function () {
  return this.aceGetPlatformMaxSpeed();
}
