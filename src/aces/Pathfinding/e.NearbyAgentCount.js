export const config = {
  returnType: "number",
  description: "Get the number of nearby agents sharing the same navigation map."
};

export const expose = true;

export default function () {
  return this.aceGetNearbyAgentCount();
}
