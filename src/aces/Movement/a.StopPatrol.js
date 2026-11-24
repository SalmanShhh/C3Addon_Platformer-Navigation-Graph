export const config = {
  listName: "Stop patrol",
  displayText: "{my}: Stop patrol",
  description: "End the current patrol (platform or route). The character simply stands where it is."
};

export const expose = true;

export default function () {
  this.aceStopPatrol();
}
