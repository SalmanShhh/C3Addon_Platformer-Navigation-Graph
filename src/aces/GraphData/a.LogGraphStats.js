export const config = {
  listName: "Log graph stats",
  displayText: "Log graph stats to console",
  description: "Print navigation graph statistics to the browser console. Useful for debugging — shows node count, connection count, portal count, etc."
};

export const expose = true;

export default function () {
  this.aceLogGraphStats();
}
