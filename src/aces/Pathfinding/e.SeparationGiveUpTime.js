export const config = {
  returnType: "number",
  description: "How long a character keeps trying to separate before giving up and resting, in seconds."
};

export const expose = true;

export default function () {
  return this.aceGetSeparationGiveUpTime();
}
