export const config = {
  returnType: "number",
  description: "The X co-ordinate of the nearest ledge to the right of the character, in pixels. Returns 0 if none exists."
};

export const expose = true;

export default function () {
  return this.aceGetNearestLedgeX(1);
}
