export const config = {
  returnType: "string",
  description: "Get the current path strategy preset (balanced, shortest, safest, simplest, no_drop, walk_only). Note: 'simplest' is the Ground-Hugging strategy and 'no_drop' is No Falling; keys keep their internal names for save compatibility."
};

export const expose = true;

export default function () {
  return this.aceGetPathStrategy();
}
