/**
 * PDF-Werkbank im Web Worker: bekommt die fertig gezeichneten Bogen-Seiten als
 * ImageBitmap (Transfer aus dem Hauptthread, keine Kopie), kodiert sie hier zu
 * PNG und setzt das jsPDF-Dokument zusammen — die beiden Schritte, die beim
 * Export die Sekunden kosten (~8,7 Mio. Pixel je Seite). Der Hauptthread bleibt
 * frei, der „Wird erstellt …"-Dialog lebendig. Antwort: das fertige PDF als
 * ArrayBuffer (wieder per Transfer).
 */

// Minimal worker-scope typing (avoids pulling in the WebWorker lib, which clashes
// with the DOM lib used by the rest of the app).
interface WorkerCtx {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
}
const ctx = self as unknown as WorkerCtx

ctx.onmessage = (e: MessageEvent) => {
  void (async () => {
    try {
      const { pages } = e.data as { pages: ImageBitmap[] }
      const pngs: Uint8Array[] = []
      for (const bmp of pages) {
        const canvas = new OffscreenCanvas(bmp.width, bmp.height)
        canvas.getContext('2d')!.drawImage(bmp, 0, 0)
        bmp.close()
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        pngs.push(new Uint8Array(await blob.arrayBuffer()))
      }
      // jsPDF wie im Hauptpfad dynamisch — der Chunk lädt erst beim ersten Export
      // (in der App aus den lokalen Assets, funktioniert also auch offline).
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
      pngs.forEach((png, i) => {
        if (i > 0) doc.addPage('a4', 'landscape')
        doc.addImage(png, 'PNG', 0, 0, 297, 210)
      })
      const pdf = doc.output('arraybuffer')
      ctx.postMessage({ ok: true, pdf }, [pdf])
    } catch (err) {
      ctx.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })()
}
