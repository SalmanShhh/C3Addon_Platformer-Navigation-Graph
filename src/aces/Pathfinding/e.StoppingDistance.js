export const config = {
  returnType: "number",
  description: "Get the calculated stopping distance in pixels based on the Platform behavior's current speed. Used for waypoint arrival detection."
};

export const expose = true;

export default function () {
  return this.aceGetStoppingDistance();
}
