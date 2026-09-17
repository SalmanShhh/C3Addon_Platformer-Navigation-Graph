export const config = {
  returnType: "number",
  description: "Get the total number of navigation nodes in the generated graph. Returns 0 if no graph exists."
};

export const expose = true;

export default function () {
  return this.aceGetNodeCount();
}
