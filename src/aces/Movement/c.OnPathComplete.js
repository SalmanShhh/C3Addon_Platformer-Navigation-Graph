export const config = {
  listName: "On arrived",
  displayText: "{my}: On arrived",
  description: "Triggered when the AI arrives at the final destination. Use this to trigger arrival animations, next actions, or goal completion logic.",
  isTrigger: true
};

export const expose = false;

export default function () {
  return true;
}
