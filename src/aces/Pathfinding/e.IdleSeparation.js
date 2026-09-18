export const config = {
  returnType: "number",
  description: "The idle separation distance in pixels (0 = off)."
};

export const expose = true;

export default function () {
  return this.aceGetIdleSeparation();
}
