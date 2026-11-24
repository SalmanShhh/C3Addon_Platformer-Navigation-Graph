export const config = {
  listName: "On patrol dwell finished",
  displayText: "{my}: On patrol dwell finished",
  description: "Triggered when a patrolling character finishes its wait at a patrol end or marker and walks on. PatrolDirection already reports the new walk direction inside this trigger. Not fired when the dwell time is 0; use 'On patrol end reached' there.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
