export const config = {
  listName: "Is patrolling",
  displayText: "{my}: Is patrolling",
  description: "True while a patrol is active (Start patrol or Start patrol between objects).",
  isInvertible: true
};

export const expose = true;

export default function () {
  return this.aceIsPatrolling();
}
