export const config = {
  listName: "On re-path triggered",
  displayText: "{my}: On re-path triggered",
  description: "Triggered when automatic re-pathing occurs due to the character drifting too far from the path. Use this to monitor navigation accuracy.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
