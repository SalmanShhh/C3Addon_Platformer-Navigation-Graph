export const config = {
  returnType: "number",
  description: "Which side of the target the character reached: -1 left, 1 right. Valid after 'On side of object reached' fires, 0 otherwise."
};

export const expose = true;

export default function () {
  return this._reachedObjectSide || 0;
}
