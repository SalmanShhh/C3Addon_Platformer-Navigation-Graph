export const config = {
  listName: "Is enabled",
  displayText: "{my}: Is enabled",
  description: "True while this behavior is enabled (see the Enabled property and the 'Set enabled' action).",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsBehaviorEnabled();
}
