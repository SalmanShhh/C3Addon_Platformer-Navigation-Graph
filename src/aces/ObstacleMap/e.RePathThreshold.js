export const config = {
  returnType: "number",
  description: "Get the current re-path threshold in tiles. This is how far the character can drift before automatic re-pathing triggers."
};

export const expose = true;

export default function () {
  return this.aceGetRePathThreshold();
}
