export const config = {
  returnType: "number",
  description: "Get the number of pathfinding requests currently waiting in the queue."
};

export const expose = true;

export default function () {
  return this.aceGetPathQueueSize();
}
