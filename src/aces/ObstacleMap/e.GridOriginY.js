export const config = {
  returnType: "number",
  description: "The world Y co-ordinate of grid tile 0, in pixels. 0 unless the obstacle map covers content above the layout or grew to include it. World Y = GridOriginY + tile Y * GridTileSize.",
  params: []
};

export const expose = true;

export default function () {
  return this.gridOriginY || 0;
}
