export const config = {
  returnType: "number",
  description: "The UID of the instance found by 'Find object on same platform', for the System 'Pick by unique ID' condition. -1 if none was on the platform."
};

export const expose = true;

export default function () {
  return typeof this._platformObjectUid === "number" ? this._platformObjectUid : -1;
}
