export const config = {
  returnType: "number",
  description: "The Y co-ordinate of the nearest ledge to the left of the character, in pixels. Returns 0 if none exists."
};

export const expose = true;

export default function () {
  return this.aceGetNearestLedgeY(-1);
}
