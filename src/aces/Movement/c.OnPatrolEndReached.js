export const config = {
  listName: "On patrol end reached",
  displayText: "{my}: On patrol end reached",
  description: "Triggered each time a patrolling character reaches an end of its patrol (or a marker, with 'Start patrol between objects') and is about to turn or move on. Use it for look-around animations during the dwell.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
