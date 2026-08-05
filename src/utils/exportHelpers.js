import * as XLSX from 'xlsx'
import { pdf } from '@react-pdf/renderer'

// Returns local YYYY-MM-DD — avoids UTC-shift bugs (mirrors the same helper
// duplicated across Attendance.jsx/Leave.jsx/Payroll.jsx/Settings.jsx).
export function localDateStr(d = new Date()) {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

// Shared empty-data guard for both export paths below — callers should check
// this before doing any (potentially expensive) row-mapping or PDF work.
export function hasExportableData(rows, showToast) {
  if (!rows || rows.length === 0) {
    showToast?.('error', 'No data to export')
    return false
  }
  return true
}

// `data` must already be an array of flat { columnLabel: value } objects —
// callers are responsible for shaping/labeling rows (e.g. resolving joined
// department names) before calling this.
export function exportToExcel(data, filename, sheetName = 'Sheet1', showToast) {
  if (!hasExportableData(data, showToast)) return false
  const worksheet = XLSX.utils.json_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  XLSX.writeFile(workbook, filename)
  return true
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// `doc` is an already-built @react-pdf/renderer <Document> element (e.g.
// <ReportTablePDF .../>) — callers should run hasExportableData() on the
// underlying rows first, since this only knows how to render/download, not
// what "empty" means for a given report shape.
export async function exportToPDF(doc, filename, showToast) {
  try {
    const blob = await pdf(doc).toBlob()
    downloadBlob(blob, filename)
    return true
  } catch (err) {
    console.error('[exportHelpers] exportToPDF failed', err)
    showToast?.('error', 'Something went wrong generating the PDF. Please try again.')
    return false
  }
}
