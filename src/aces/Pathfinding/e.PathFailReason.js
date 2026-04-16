export const config = {
  returnType: "string",
  description: "Get the reason the last pathfinding attempt failed. Returns: 'no_start_node', 'no_goal_node', 'max_nodes_reached', 'no_path', or empty string if path succeeded."
};

export const expose = true;

export default function () {
  return this.aceGetPathFailReason();
}
