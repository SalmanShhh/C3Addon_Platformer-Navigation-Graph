export const config = {
  returnType: "number",
  description: "The separation cooldown in seconds (rest time after giving up on idle separation; 0 = never rest)."
};

export const expose = true;

export default function () {
  return this.aceGetSeparationCooldown();
}
