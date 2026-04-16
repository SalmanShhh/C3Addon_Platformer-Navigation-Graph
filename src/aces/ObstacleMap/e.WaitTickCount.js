export const config = {
  returnType: "number",
  description: "Get the number of ticks spent waiting for the Pathfinding obstacle map to initialize. Used for debugging timeout issues."
};

export const expose = true;

export default function () {
  return this.aceGetWaitTickCount();
}
