// Only raster data URLs may come from profiles. SVG mobs are generated locally.
export function isImageData(value) {
  return typeof value === 'string' && /^data:image\/(?:png|jpeg|jpg|webp|gif|avif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
