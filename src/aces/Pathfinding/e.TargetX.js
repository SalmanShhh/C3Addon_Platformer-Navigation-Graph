export const config = {
  returnType: "number",
  description: "The world X of the requested path target, as passed to the last Find path action. For where the calculated path actually ends, use PathEndX."
};

export const expose = true;

export default function () {
  return this.aceGetTargetX();
}
