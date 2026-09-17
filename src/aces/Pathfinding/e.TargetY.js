export const config = {
  returnType: "number",
  description: "The world Y of the requested path target, as passed to the last Find path action. For where the calculated path actually ends, use PathEndY."
};

export const expose = true;

export default function () {
  return this.aceGetTargetY();
}
