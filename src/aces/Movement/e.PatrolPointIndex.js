export const config = {
  returnType: "number",
  description: "During 'Start patrol between objects': the marker the character is at or heading to, counting from 0 in instance order. -1 when no route patrol is active."
};

export const expose = true;

export default function () {
  return this._route ? this._route.index : -1;
}
