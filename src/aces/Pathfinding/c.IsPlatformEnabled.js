export const config = {
  listName: "Is platform enabled",
  displayText: "Platform behavior is enabled",
  description: "Check if the associated Platform behavior is currently enabled. Returns false if Platform behavior is disabled or not found.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsPlatformEnabled();
}
