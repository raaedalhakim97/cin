import { Document, Page, View, Text, StyleSheet, Svg, Path, Rect } from '@react-pdf/renderer'

// Design system colors (BYOND-Design-System.md) — react-pdf has no dark mode
// concept, this document is always rendered against a white page.
const MINT       = '#00D4A0'
const TEXT_DARK  = '#1A1A1A'
const TEXT_GRAY  = '#666666'
const TEXT_MUTED = '#AAAAAA'
const BORDER     = '#E8E8E8'
const BG_LIGHT   = '#F5F5F0'
const DANGER     = '#FF4D4D'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function periodLabel(year, month) {
  return `${MONTHS[month - 1]} ${year}`
}

function fmtMoney(n) {
  return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function computeGross(run) {
  return (
    Number(run.basic_salary || 0) +
    Number(run.housing_allowance || 0) +
    Number(run.transport_allowance || 0) +
    Number(run.other_allowance || 0) +
    Number(run.overtime_pay || 0) +
    Number(run.performance_bonus || 0)
  )
}

function computeNet(gross, deductions) {
  return gross - Number(deductions || 0)
}

// react-pdf's built-in Helvetica renders everywhere with no font registration
// needed — @fontsource/inter only ships woff/woff2, which fontkit (react-pdf's
// embedding engine) doesn't reliably parse, so Inter is not used in this PDF.
const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    color: TEXT_DARK,
    fontFamily: 'Helvetica',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandMark: {
    marginRight: 8,
  },
  companyName: {
    fontSize: 18,
    fontWeight: 700,
    color: TEXT_DARK,
  },
  companyMeta: {
    fontSize: 9,
    color: TEXT_GRAY,
    marginTop: 2,
  },
  payslipTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: MINT,
    textAlign: 'right',
  },
  periodLabel: {
    fontSize: 11,
    color: TEXT_GRAY,
    textAlign: 'right',
    marginTop: 2,
  },
  divider: {
    height: 3,
    backgroundColor: MINT,
    marginTop: 14,
    marginBottom: 20,
    borderRadius: 2,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: TEXT_DARK,
    marginBottom: 10,
  },
  employeeBox: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 14,
    backgroundColor: BG_LIGHT,
    borderRadius: 8,
    marginBottom: 22,
  },
  employeeField: {
    width: '50%',
    marginBottom: 10,
  },
  fieldLabel: {
    fontSize: 8,
    color: TEXT_GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: 11,
    fontWeight: 700,
    color: TEXT_DARK,
  },
  table: {
    marginBottom: 18,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 6,
    marginBottom: 6,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontWeight: 700,
    color: TEXT_GRAY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
  },
  tableCellLabel: {
    flex: 1,
    fontSize: 10,
    color: TEXT_GRAY,
  },
  tableCellValue: {
    fontSize: 10,
    fontWeight: 700,
    color: TEXT_DARK,
    textAlign: 'right',
    width: 110,
  },
  totalRow: {
    flexDirection: 'row',
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  totalLabel: {
    flex: 1,
    fontSize: 11,
    fontWeight: 700,
    color: TEXT_DARK,
  },
  totalValue: {
    fontSize: 11,
    fontWeight: 700,
    color: TEXT_DARK,
    textAlign: 'right',
    width: 110,
  },
  deductionValue: {
    fontSize: 10,
    fontWeight: 700,
    color: DANGER,
    textAlign: 'right',
    width: 110,
  },
  netBox: {
    marginTop: 6,
    marginBottom: 26,
    padding: 18,
    borderRadius: 8,
    backgroundColor: MINT,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  netLabel: {
    fontSize: 12,
    fontWeight: 700,
    color: '#FFFFFF',
  },
  netValue: {
    fontSize: 20,
    fontWeight: 700,
    color: '#FFFFFF',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: TEXT_MUTED,
    marginBottom: 2,
  },
})

function Row({ label, value, danger }) {
  return (
    <View style={styles.tableRow}>
      <Text style={styles.tableCellLabel}>{label}</Text>
      <Text style={danger ? styles.deductionValue : styles.tableCellValue}>
        {danger ? '- ' : ''}{fmtMoney(value)} {' '}
      </Text>
    </View>
  )
}

export default function PayslipPDF({ run, employee, company }) {
  const gross = computeGross(run)
  const net   = computeNet(gross, run.deductions)
  const currency = company?.currency || 'AED'
  const generatedOn = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  const earnings = [
    { label: 'Basic Salary',        value: run.basic_salary },
    { label: 'Housing Allowance',   value: run.housing_allowance },
    { label: 'Transport Allowance', value: run.transport_allowance },
    { label: 'Other Allowance',     value: run.other_allowance },
    { label: 'Overtime Pay',        value: run.overtime_pay },
    { label: 'Performance Bonus',   value: run.performance_bonus },
  ]

  return (
    <Document>
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandRow}>
            <Svg width={22} height={26} viewBox="0 0 100 116" style={styles.brandMark}>
              <Rect x={6} y={26} width={88} height={88} rx={24} fill="#1E1E1E" />
              <Path d="M50 100 L50 22" stroke={MINT} strokeWidth={13} strokeLinecap="round" />
              <Path
                d="M27 42 L50 15 L73 42"
                stroke={MINT}
                strokeWidth={13}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </Svg>
            <View>
              <Text style={styles.companyName}>{company?.name || 'BYOND BY SERVA'}</Text>
              {company?.country && <Text style={styles.companyMeta}>{company.country}</Text>}
            </View>
          </View>
          <View>
            <Text style={styles.payslipTitle}>PAYSLIP</Text>
            <Text style={styles.periodLabel}>{periodLabel(run.period_year, run.period_month)}</Text>
          </View>
        </View>
        <View style={styles.divider} />

        {/* Employee section */}
        <Text style={styles.sectionTitle}>Employee Details</Text>
        <View style={styles.employeeBox}>
          <View style={styles.employeeField}>
            <Text style={styles.fieldLabel}>Full Name</Text>
            <Text style={styles.fieldValue}>{employee.full_name}</Text>
          </View>
          <View style={styles.employeeField}>
            <Text style={styles.fieldLabel}>Job Title</Text>
            <Text style={styles.fieldValue}>{employee.job_title || '—'}</Text>
          </View>
          <View style={styles.employeeField}>
            <Text style={styles.fieldLabel}>Department</Text>
            <Text style={styles.fieldValue}>{employee.departments?.name || '—'}</Text>
          </View>
          <View style={styles.employeeField}>
            <Text style={styles.fieldLabel}>Employee ID</Text>
            <Text style={styles.fieldValue}>{employee.emp_code || employee.id}</Text>
          </View>
        </View>

        {/* Earnings */}
        <View style={styles.table}>
          <Text style={styles.sectionTitle}>Earnings</Text>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Description</Text>
            <Text style={[styles.tableHeaderCell, { width: 110, textAlign: 'right' }]}>
              Amount ({currency})
            </Text>
          </View>
          {earnings.map(e => (
            <Row key={e.label} label={e.label} value={e.value} />
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Gross Salary</Text>
            <Text style={styles.totalValue}>{fmtMoney(gross)}</Text>
          </View>
        </View>

        {/* Deductions */}
        <View style={styles.table}>
          <Text style={styles.sectionTitle}>Deductions</Text>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, { flex: 1 }]}>Description</Text>
            <Text style={[styles.tableHeaderCell, { width: 110, textAlign: 'right' }]}>
              Amount ({currency})
            </Text>
          </View>
          <Row label="Statutory & Other Deductions" value={run.deductions} danger />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Deductions</Text>
            <Text style={[styles.totalValue, { color: DANGER }]}>- {fmtMoney(run.deductions)}</Text>
          </View>
        </View>

        {/* Net Salary */}
        <View style={styles.netBox}>
          <Text style={styles.netLabel}>Net Salary</Text>
          <Text style={styles.netValue}>{fmtMoney(net)} {currency}</Text>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>Generated on {generatedOn}</Text>
          <Text style={styles.footerText}>This is a computer-generated payslip and does not require a signature.</Text>
        </View>
      </Page>
    </Document>
  )
}
