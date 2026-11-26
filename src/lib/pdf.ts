import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }

export type PdfDoc = pdfjs.PDFDocumentProxy & { close(): Promise<void> }

/** Opens a PDF. Call `close()` on the result to free the worker-side document. */
export async function openPdf(data: ArrayBuffer): Promise<PdfDoc> {
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
    iccUrl: '/pdfjs/iccs/',
  })
  const doc = await task.promise
  return Object.assign(doc, { close: () => task.destroy() })
}
