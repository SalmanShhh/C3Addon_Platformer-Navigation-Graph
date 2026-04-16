export const config = {
  returnType: "number",
  description: "Get the total calculated cost of the current path. Returns 0 if no path is active."
};

export const expose = true;

export default function () {
  return this.aceGetPathCost();
}
