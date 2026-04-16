export const config = {
  returnType: "string",
  description: "Get the current obstacle map as a JSON string. Use this to save the map to local storage or export to files."
};

export const expose = true;

export default function () {
  return this.aceGetObstacleMapJSON();
}
