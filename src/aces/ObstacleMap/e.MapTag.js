export const config = {
  returnType: "string",
  description: "The map tag this instance navigates with (from the Map Tag property). Instances with the same tag on a layout share one navigation map. Returns an empty string for the default shared map."
};

export const expose = true;

export default function () {
  return this.aceGetMapTag();
}
