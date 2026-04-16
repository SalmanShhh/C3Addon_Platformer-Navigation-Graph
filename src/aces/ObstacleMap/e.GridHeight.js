export const config = {
  returnType: "number",
  description: "Get the height of the obstacle map in tiles. Returns 0 if no map exists."
};

export const expose = true;

export default function () {
  return this.aceGetGridHeight();
}
