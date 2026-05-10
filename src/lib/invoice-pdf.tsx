import React from "react";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export type InvoicePayload = {
  invoiceNumber: string;
  studioName: string;
  studioEmail?: string | null;
  customerName: string;
  customerEmail: string | null;
  currency: string;
  amount: number;
  issueDate: string;
  referenceCode: string | null;
  lineItem: string;
};

const TEAL = "#0d9488";
const TEAL_LIGHT = "#f0fdfa";
const GREY_DARK = "#111827";
const GREY_MID = "#6b7280";
const GREY_LIGHT = "#f9fafb";
const BORDER = "#e5e7eb";

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: GREY_DARK,
    backgroundColor: "#ffffff",
  },

  /* ── Header band ── */
  headerBand: {
    backgroundColor: TEAL,
    borderRadius: 4,
    paddingVertical: 18,
    paddingHorizontal: 24,
    marginBottom: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: { flex: 1 },
  studioName: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    marginBottom: 3,
  },
  studioEmail: { fontSize: 8, color: "rgba(255,255,255,0.75)" },
  invoiceLabel: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: "rgba(255,255,255,0.9)",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    textAlign: "right",
  },
  invoiceNumber: {
    fontSize: 10,
    color: "rgba(255,255,255,0.75)",
    textAlign: "right",
    marginTop: 3,
  },

  /* ── Meta row ── */
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 16,
  },
  metaBlock: { flex: 1 },
  metaTitle: {
    fontSize: 7,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: TEAL_LIGHT,
    paddingBottom: 3,
  },
  metaLine: { fontSize: 9, color: GREY_DARK, marginBottom: 2 },
  metaMuted: { fontSize: 8, color: GREY_MID, marginBottom: 2 },

  /* ── Line items table ── */
  table: { marginBottom: 20 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: TEAL,
    borderRadius: 3,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 9,
    paddingHorizontal: 10,
    backgroundColor: GREY_LIGHT,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  colItem: { flex: 5 },
  colQty: { flex: 1, textAlign: "center" },
  colAmount: { flex: 2, textAlign: "right" },
  cellText: { fontSize: 9, color: GREY_DARK },

  /* ── Totals ── */
  totalsBlock: {
    marginLeft: "auto",
    width: 210,
    marginBottom: 24,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  totalDivider: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginVertical: 4,
  },
  totalBandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: TEAL,
    borderRadius: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginTop: 4,
  },
  totalLabel: { fontSize: 8, color: GREY_MID },
  totalValue: { fontSize: 9, color: GREY_DARK },
  totalBandLabel: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },
  totalBandValue: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#ffffff",
  },

  /* ── Reference pill ── */
  refPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: TEAL_LIGHT,
    borderRadius: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 24,
    gap: 6,
  },
  refLabel: { fontSize: 8, color: TEAL, fontFamily: "Helvetica-Bold" },
  refValue: { fontSize: 8, color: GREY_DARK },

  /* ── Footer ── */
  footer: {
    borderTopWidth: 1,
    borderTopColor: BORDER,
    paddingTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerLeft: { flex: 1 },
  thankYou: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: TEAL,
    marginBottom: 2,
  },
  footerNote: { fontSize: 7, color: GREY_MID },
  footerRight: { fontSize: 7, color: GREY_MID, textAlign: "right" },
});

function InvoicePdf({ payload }: { payload: InvoicePayload }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* ── Header band ── */}
        <View style={styles.headerBand}>
          <View style={styles.headerLeft}>
            <Text style={styles.studioName}>{payload.studioName}</Text>
            {payload.studioEmail ? (
              <Text style={styles.studioEmail}>{payload.studioEmail}</Text>
            ) : null}
          </View>
          <View>
            <Text style={styles.invoiceLabel}>Invoice</Text>
            <Text style={styles.invoiceNumber}>{payload.invoiceNumber}</Text>
          </View>
        </View>

        {/* ── Bill to / Invoice details ── */}
        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaTitle}>Bill To</Text>
            <Text style={styles.metaLine}>{payload.customerName}</Text>
            {payload.customerEmail ? (
              <Text style={styles.metaMuted}>{payload.customerEmail}</Text>
            ) : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaTitle}>Invoice Details</Text>
            <Text style={styles.metaLine}>Invoice No: {payload.invoiceNumber}</Text>
            <Text style={styles.metaMuted}>Issue Date: {payload.issueDate}</Text>
          </View>
        </View>

        {/* ── Line items table ── */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.colItem]}>Description</Text>
            <Text style={[styles.tableHeaderCell, styles.colQty]}>Qty</Text>
            <Text style={[styles.tableHeaderCell, styles.colAmount]}>Amount</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={[styles.cellText, styles.colItem]}>{payload.lineItem}</Text>
            <Text style={[styles.cellText, styles.colQty]}>1</Text>
            <Text style={[styles.cellText, styles.colAmount]}>
              {payload.currency} {payload.amount.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* ── Totals ── */}
        <View style={styles.totalsBlock}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal</Text>
            <Text style={styles.totalValue}>
              {payload.currency} {payload.amount.toFixed(2)}
            </Text>
          </View>
          <View style={styles.totalDivider} />
          <View style={styles.totalBandRow}>
            <Text style={styles.totalBandLabel}>Total Due</Text>
            <Text style={styles.totalBandValue}>
              {payload.currency} {payload.amount.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* ── Reference ── */}
        {payload.referenceCode ? (
          <View style={styles.refPill}>
            <Text style={styles.refLabel}>Payment Reference</Text>
            <Text style={styles.refValue}>{payload.referenceCode}</Text>
          </View>
        ) : null}

        {/* ── Footer ── */}
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Text style={styles.thankYou}>Thank you for your business.</Text>
            <Text style={styles.footerNote}>
              Questions? Contact us at {payload.studioEmail ?? "your studio"}
            </Text>
          </View>
          <Text style={styles.footerRight}>
            This invoice was issued by {payload.studioName} via Studio platform.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(payload: InvoicePayload) {
  return renderToBuffer(<InvoicePdf payload={payload} />);
}
