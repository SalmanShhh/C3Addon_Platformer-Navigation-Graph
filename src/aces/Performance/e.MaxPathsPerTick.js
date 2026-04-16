export const config = {
  returnType: "number",
  description: "Get the current maximum paths per tick setting."
};

export const expose = true;

export default function () {
  return this.aceGetMaxPathsPerTick();
}
