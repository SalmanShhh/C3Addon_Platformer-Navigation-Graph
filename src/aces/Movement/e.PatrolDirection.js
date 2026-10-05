export const config = {
  returnType: "number",
  description: "The patrol walk direction: -1 walking left, 1 walking right, 0 when not patrolling or dwelling at an end. Useful for mirroring the sprite."
};

export const expose = true;

export default function () {
  return this.aceGetPatrolDirection();
}
