export const config = {
  listName: "On patrol dwell started",
  displayText: "{my}: On patrol dwell started",
  description: "Triggered when a patrolling character begins its wait at a patrol end, right after 'On patrol end reached'. Use it to start idle or look-around animations. Not fired when the dwell time is 0.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
