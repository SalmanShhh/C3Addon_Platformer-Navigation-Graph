export const config = {
  listName: "Is multi-agent avoidance enabled",
  displayText: "{my}: Is multi-agent avoidance enabled",
  description: "True if multi-agent avoidance is currently active.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsMultiAgentAvoidanceEnabled();
}
