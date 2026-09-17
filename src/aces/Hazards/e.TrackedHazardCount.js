export const config = {
  returnType: "number",
  description: "The number of active tracked (object-following) hazards."
};

export const expose = true;

export default function () {
  return this.aceGetTrackedHazardCount();
}
