export const config = {
  returnType: "number",
  description: "Get the current hazard radius setting in tiles. This affects how far hazard influence spreads."
};

export const expose = true;

export default function () {
  return this.aceGetHazardRadius();
}
