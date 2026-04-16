export const config = {
  returnType: "string",
  description: "Get the source of the current obstacle map. Returns 'custom', 'pathfinding', or 'none'."
};

export const expose = true;

export default function () {
  return this.aceGetObstacleMapSource();
}
