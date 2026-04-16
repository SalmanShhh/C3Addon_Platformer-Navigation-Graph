export const config = {
  listName: "Set coyote time",
  displayText: "Set coyote time to {0} seconds",
  description: "Set the coyote time window in seconds. The AI can jump within this window after walking off a ledge. Set to 0 to disable coyote time.",
  params: [
    { id: "seconds", name: "Seconds", desc: "Coyote time window in seconds", type: "number", initialValue: "0.1" }
  ]
};

export const expose = true;

export default function (seconds) {
  this.coyoteTime = seconds;
}
