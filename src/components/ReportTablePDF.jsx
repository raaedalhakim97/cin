import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer'

// Design system colors (BYOND-Design-System.md) — duplicated locally rather
// than imported from PayslipPDF.jsx, matching this codebase's established
// convention of duplicating small constants/helpers per file (see every page
// in src/pages/ for the same pattern with MONTHS/fmtMoney/STATUS_META etc.).
const MINT      = '#00D4A0'
const TEXT_DARK = '#1A1A1A'
const TEXT_GRAY = '#666666'
const TEXT_MUTED = '#AAAAAA'
const BORDER    = '#E8E8E8'
const BG_LIGHT  = '#F5F5F0'

// react-pdf's built-in Helvetica is used (no Font.register) — see PayslipPDF.jsx
// for why: @fontsource/inter only ships woff/woff2, which react-pdf's fontkit
// embedding engine doesn't reliably parse.
const styles = StyleSheet.create({
  page: {
    padding: 32,
    fontSize: 8,
    color: TEXT_DARK,
    fontFamily: 'Helvetica',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  companyName: {
    fontSize: 14,
    fontWeight: 700,
    color: TEXT_DARK,
  },
  titleBlock: {
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: MINT,
  },
  subtitle: {
    fontSize: 8,
    color: TEXT_GRAY,
    marginTop: 2,
  },
  divider: {
    height: 2,
    backgroundColor: MINT,
    marginTop: 10,
    marginBottom: 14,
    borderRadius: 1,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: BG_LIGHT,
    paddingVertical: 6,
    paddingHorizontal: 5,
  },
  tableHeaderCell: {
    fontSize: 7,
    fontWeight: 700,
    color: TEXT_GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 5,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tableRowAlt: {
    backgroundColor: '#FAFAF8',
  },
  cell: {
    fontSize: 8,
    color: TEXT_DARK,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 32,
    right: 32,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  footerText: {
    fontSize: 7,
    color: TEXT_MUTED,
  },
})

// Generic tabular report — used for the Employee export today, written to be
// reusable for any future "export this list as a formatted PDF table" need.
// `columns`: [{ key, label, width }] — width is a percentage number (0-100),
// should sum to ~100 across all columns. `rows`: array of plain objects keyed
// by each column's `key`.
export default function ReportTablePDF({ companyName, title, subtitle, columns, rows }) {
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>

        {/* Header */}
        <View style={styles.headerRow}>
          <Text style={styles.companyName}>{companyName || 'BYOND BY SERVA'}</Text>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>{title}</Text>
            {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
          </View>
        </View>
        <View style={styles.divider} />

        {/* Table header — repeats on every page via `fixed` */}
        <View style={styles.tableHeaderRow} fixed>
          {columns.map(col => (
            <Text key={col.key} style={[styles.tableHeaderCell, { width: `${col.width}%` }]}>
              {col.label}
            </Text>
          ))}
        </View>

        {/* Rows — wrap={false} keeps a single row from splitting across a page break */}
        {rows.map((row, i) => (
          <View
            key={i}
            style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : null]}
            wrap={false}
          >
            {columns.map(col => (
              <Text key={col.key} style={[styles.cell, { width: `${col.width}%` }]}>
                {row[col.key] ?? '—'}
              </Text>
            ))}
          </View>
        ))}

        {/* Footer — page numbers via react-pdf's render-prop Text */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Generated on {generatedOn}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
