export const config = {
  listName: "On side of object reached",
  displayText: "{my}: On side of object reached",
  description: "Triggered when a 'Find path to side of object' arrival lands with the character beside the target at the requested distance. A stopped-short arrival fires only 'On arrived'. Read the side with ReachedObjectSide.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
