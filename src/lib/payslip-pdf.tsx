import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { PDF_FONT_BOLD, PDF_FONT_FAMILY, registerPdfFonts } from "./pdf-fonts";
import type { PayslipModel } from "@/lib/payslip-model";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: PDF_FONT_FAMILY, color: "#111827" },
  title: { fontSize: 16, ...PDF_FONT_BOLD, marginBottom: 4, color: "#0f766e" },
  muted: { fontSize: 8, color: "#6b7280", marginBottom: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { color: "#6b7280" },
  section: { marginTop: 14, marginBottom: 6, ...PDF_FONT_BOLD, fontSize: 11 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  net: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", ...PDF_FONT_BOLD, fontSize: 12 },
});

function PayslipPdf({ model }: { model: PayslipModel }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Itemised payslip</Text>
        <Text style={styles.muted}>{model.payslipNumber} · MOM Employment Act itemised pay slip</Text>
        <View style={styles.row}><Text style={styles.label}>Employer</Text><Text>{model.employerName}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Employee</Text><Text>{model.employeeName}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Payment date</Text><Text>{model.paymentDate}</Text></View>
        <View style={styles.row}><Text style={styles.label}>Salary period</Text><Text>{model.periodStart} to {model.periodEnd}</Text></View>
        <View style={styles.row}><Text style={styles.label}>{model.basicSalaryLabel}</Text><Text>{model.basicRate ?? "—"}</Text></View>
        {model.hoursOrDaysWorked ? <View style={styles.row}><Text style={styles.label}>Hours / days worked</Text><Text>{model.hoursOrDaysWorked}</Text></View> : null}
        {model.overtimeHours ? <View style={styles.row}><Text style={styles.label}>Overtime hours</Text><Text>{model.overtimeHours}</Text></View> : null}
        {model.overtimePay ? <View style={styles.row}><Text style={styles.label}>Overtime period</Text><Text>{model.overtimePeriodStart} to {model.overtimePeriodEnd}</Text></View> : null}
        <Text style={styles.section}>Earnings</Text>
        {model.earnings.map((line) => (
          <View key={line.code} style={styles.line}><Text>{line.label}</Text><Text>SGD {line.amountSgd}</Text></View>
        ))}
        <Text style={styles.section}>Deductions</Text>
        {model.deductions.length ? model.deductions.map((line) => (
          <View key={line.code} style={styles.line}><Text>{line.label}</Text><Text>SGD {line.amountSgd}</Text></View>
        )) : <Text style={styles.muted}>None</Text>}
        <Text style={styles.section}>Employer contributions</Text>
        {model.employerContributions.map((line) => (
          <View key={line.code} style={styles.line}><Text>{line.label}</Text><Text>SGD {line.amountSgd}</Text></View>
        ))}
        <View style={styles.net}><Text>Net salary</Text><Text>SGD {model.netSalary}</Text></View>
      </Page>
    </Document>
  );
}

export async function renderPayslipPdf(model: PayslipModel) {
  registerPdfFonts();
  return renderToBuffer(<PayslipPdf model={model} />);
}
