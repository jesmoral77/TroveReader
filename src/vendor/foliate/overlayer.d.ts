export class Overlayer {
  static highlight: (rects: DOMRectList | DOMRect[], options?: { color?: string }) => SVGElement
  static underline: (rects: DOMRectList | DOMRect[], options?: { color?: string; width?: number }) => SVGElement
  static outline: (rects: DOMRectList | DOMRect[], options?: { color?: string; width?: number }) => SVGElement
}
