export const config = {
  returnType: "string",
  description: "Get the current path strategy preset (balanced, shortest, safest, simplest)."
};

export const expose = true;

export default function () {
  return this.aceGetPathStrategy();
}
