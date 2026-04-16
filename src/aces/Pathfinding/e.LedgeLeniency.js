export const config = {
  returnType: "number",
  description: "Get the ledge leniency setting in pixels. This is how far past a ledge edge the AI can walk before stopping."
};

export const expose = true;

export default function () {
  return this.aceGetLedgeLeniency();
}
