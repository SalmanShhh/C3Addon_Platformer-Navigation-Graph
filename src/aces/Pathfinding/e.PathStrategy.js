export const config = {
  returnType: "string",
  description: "Get the current path strategy preset (balanced, shortest, safest, simplest). Note: 'simplest' is the Ground-Hugging strategy — the key kept its original name for save compatibility."
};

export const expose = true;

export default function () {
  return this.aceGetPathStrategy();
}
