export const config = {
  returnType: "number",
  description: "The ID of the most recently added hazard (circle or rectangle). Read it right after an Add hazard action and store it in a variable to remove or track that hazard later. Returns 0 if no hazard has been added yet."
};

export const expose = true;

export default function () {
  return this.aceGetLastHazardID();
}
