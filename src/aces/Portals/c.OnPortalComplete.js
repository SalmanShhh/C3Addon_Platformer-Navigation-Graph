export const config = {
  listName: "On portal complete",
  displayText: "On portal complete",
  description: "Triggered when portal execution finishes — after an instant teleport completes, a gradual movement reaches the exit, or 'Complete portal' is called. Use this for post-portal effects like opening doors at the exit, playing arrival animations, etc.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
