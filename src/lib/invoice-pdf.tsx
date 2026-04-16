import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export type InvoicePayload = {
  invoiceNumber: string;
  studioName: string;
  customerName: string;
  customerEmail: string | null;
  currency: string;
  amount: number;
  issueDate: string;
  referenceCode: string | null;
  lineItem: string;
};

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 20, fontWeight: "bold", marginBottom: 10 },
  block: { marginBottom: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  label: { color: "#374151" },
  table: { borderWidth: 1, borderColor: "#d1d5db" },
  header: { flexDirection: "row", backgroundColor: "#f3f4f6", borderBottomWidth: 1, borderBottomColor: "#d1d5db" },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  cell: { padding: 8, flex: 1 },
  right: { textAlign: "right" },
  total: { marginTop: 14, alignSelf: "flex-end", width: 220 },
});

function InvoicePdf({ payload }: { payload: InvoicePayload }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Invoice</Text>
        <View style={styles.block}>
          <Text>{payload.studioName}</Text>
          <Text>Invoice No: {payload.invoiceNumber}</Text>
          <Text>Issue date: {payload.issueDate}</Text>
        </View>
        <View style={styles.block}>
          <Text>Bill to: {payload.customerName}</Text>
          <Text>{payload.customerEmail ?? "-"}</Text>
        </View>
        <View style={styles.table}>
          <View style={styles.header}>
            <Text style={styles.cell}>Item</Text>
            <Text style={[styles.cell, styles.right]}>Qty</Text>
            <Text style={[styles.cell, styles.right]}>Amount</Text>
          </View>
          <View style={styles.tr}>
            <Text style={styles.cell}>{payload.lineItem}</Text>
            <Text style={[styles.cell, styles.right]}>1</Text>
            <Text style={[styles.cell, styles.right]}>
              {payload.currency} {payload.amount.toFixed(2)}
            </Text>
          </View>
        </View>
        <View style={styles.total}>
          <View style={styles.row}>
            <Text style={styles.label}>Subtotal</Text>
            <Text>
              {payload.currency} {payload.amount.toFixed(2)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Total</Text>
            <Text>
              {payload.currency} {payload.amount.toFixed(2)}
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Reference</Text>
            <Text>{payload.referenceCode ?? "-"}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(payload: InvoicePayload) {
  return renderToBuffer(<InvoicePdf payload={payload} />);
}

