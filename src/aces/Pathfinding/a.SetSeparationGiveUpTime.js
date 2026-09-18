export const config = {
  listName: "Set separation give-up time",
  displayText: "{my}: Set separation give-up time to {0} seconds",
  description: "Set how long a character keeps trying to push apart from overlapping neighbors before it gives up and rests for the Separation Cooldown. Default is 1.2 seconds. Larger values shuffle longer before settling; very small values settle almost immediately.",
  params: [
    { id: "seconds", name: "Seconds", desc: "The time to keep trying, in seconds, before giving up.", type: "number", initialValue: "1.2" }
  ]
};

export const expose = true;

export default function (seconds) {
  this.aceSetSeparationGiveUpTime(seconds);
}
