export const config = {
  listName: "Is patrolling",
  displayText: "{my}: Is patrolling",
  description: "True while a ledge-to-ledge patrol is active.",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsPatrolling();
}
