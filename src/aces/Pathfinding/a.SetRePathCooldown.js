export const config = {
  listName: "Set re-path cooldown",
  displayText: "{my}: Set re-path cooldown to {0} seconds",
  description: "Set the minimum time in seconds between automatic re-path attempts. Lower values = more responsive re-pathing but more CPU usage. Default is 0.5 seconds.",
  params: [
    { id: "seconds", name: "Seconds", desc: "Cooldown in seconds", type: "number", initialValue: "0.5" }
  ]
};

export const expose = true;

export default function (seconds) {
  this.rePathCooldownDuration = Math.max(0, seconds);
}
