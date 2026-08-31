import React from 'react';
import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';

import { fromCents, toCents } from '@/lib/pricing/money';

/**
 * The branded proposal document, rendered server-side with
 * @react-pdf/renderer and stored in the 'proposals' bucket. Layout only —
 * every number arrives already computed by the pricing engine.
 *
 * All amounts are dollars (floats at the display boundary only).
 */

export interface ProposalPdfLine {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
}

export interface ProposalPdfData {
  proposalId: string;
  createdAt: string;
  lead: {
    fullName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
  };
  property: {
    hoaInvolved: boolean;
    permitLikely: boolean;
    accessNotes: string | null;
  };
  narrative: {
    scopeOverview: string;
    timelineSentence: string;
    included: string[];
    exclusions: string[];
  };
  lines: ProposalPdfLine[];
  optionalAddOns: Array<{ description: string; quantity: number; unit: string }>;
  totals: {
    subtotal: number;
    mobilizationFee: number;
    contingency: number;
    tax: number;
    total: number;
  };
}

/** 50% of the total, computed in integer cents like every money value. */
export function depositForTotal(totalDollars: number): number {
  return fromCents(Math.round(toCents(totalDollars) / 2));
}

const usd = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const styles = StyleSheet.create({
  page: { padding: 42, fontSize: 10, fontFamily: 'Helvetica', color: '#1c2430' },
  brand: {
    backgroundColor: '#1e4d3b',
    color: '#ffffff',
    padding: 14,
    borderRadius: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandName: { fontSize: 17, fontFamily: 'Helvetica-Bold', letterSpacing: 1.5 },
  brandTag: { fontSize: 8, marginTop: 2, color: '#cfe3d8' },
  brandRight: { textAlign: 'right' },
  brandRightLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  brandRightMeta: { fontSize: 8, color: '#cfe3d8', marginTop: 2 },
  section: { marginTop: 16 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#1e4d3b',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  detailsRow: { flexDirection: 'row', gap: 24 },
  detailCol: { flex: 1 },
  detailLabel: { fontSize: 8, color: '#6b7280', marginBottom: 1 },
  detailValue: { fontSize: 10, marginBottom: 3 },
  narrative: { fontSize: 10.5, lineHeight: 1.55 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#eef3f0',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 3,
    fontSize: 8.5,
    fontFamily: 'Helvetica-Bold',
    color: '#1e4d3b',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 0.75,
    borderBottomColor: '#e5e7eb',
  },
  colDescription: { width: '48%' },
  colQty: { width: '13%', textAlign: 'right' },
  colUnit: { width: '13%', textAlign: 'right' },
  colPrice: { width: '13%', textAlign: 'right' },
  colTotal: { width: '13%', textAlign: 'right', fontFamily: 'Helvetica-Bold' },
  totalsBox: { marginTop: 10, alignSelf: 'flex-end', width: '55%' },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    fontSize: 10,
  },
  totalsRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    borderTopWidth: 0.75,
    borderTopColor: '#1e4d3b',
    marginTop: 3,
  },
  addOns: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#c9b458',
    borderRadius: 6,
    padding: 10,
    backgroundColor: '#fdfaf0',
  },
  addOnsTitle: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#8a6d1a', marginBottom: 4 },
  addOnsNote: { fontSize: 8, color: '#6b7280' },
  deposit: {
    marginTop: 16,
    backgroundColor: '#1e4d3b',
    color: '#ffffff',
    borderRadius: 6,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  depositLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  depositAmount: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  terms: { fontSize: 8, color: '#4b5563', lineHeight: 1.5 },
  signatureRow: { flexDirection: 'row', gap: 32, marginTop: 28 },
  signatureCol: { flex: 1 },
  signatureLine: { borderBottomWidth: 0.75, borderBottomColor: '#374151', height: 26 },
  signatureLabel: { fontSize: 8, color: '#6b7280', marginTop: 3 },
  footer: { position: 'absolute', bottom: 28, left: 42, right: 42, textAlign: 'center', fontSize: 7.5, color: '#9ca3af' },
});

function bulletList(items: string[]): string {
  return items.map((item) => `•  ${item}`).join('\n');
}

export function ProposalPdfDocument({ data }: { data: ProposalPdfData }): React.JSX.Element {
  const deposit = depositForTotal(data.totals.total);

  return (
    <Document
      title={`Greenscape Pro proposal ${data.proposalId.slice(0, 8)}`}
      author="Greenscape Pro"
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.brand} fixed>
          <View>
            <Text style={styles.brandName}>GREENSCAPE PRO</Text>
            <Text style={styles.brandTag}>HARDSCAPE DESIGN-BUILD · PHOENIX, AZ</Text>
          </View>
          <View style={styles.brandRight}>
            <Text style={styles.brandRightLabel}>LANDSCAPE PROPOSAL</Text>
            <Text style={styles.brandRightMeta}>#{data.proposalId.slice(0, 8)}</Text>
            <Text style={styles.brandRightMeta}>
              {new Date(data.createdAt).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PREPARED FOR</Text>
          <View style={styles.detailsRow}>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>CLIENT</Text>
              <Text style={styles.detailValue}>{data.lead.fullName}</Text>
              {data.lead.phone && <Text style={styles.detailValue}>{data.lead.phone}</Text>}
              {data.lead.email && <Text style={styles.detailValue}>{data.lead.email}</Text>}
            </View>
            <View style={styles.detailCol}>
              <Text style={styles.detailLabel}>PROPERTY</Text>
              <Text style={styles.detailValue}>
                {[data.lead.address, data.lead.city].filter(Boolean).join(', ') || '—'}
              </Text>
              {data.property.hoaInvolved && (
                <Text style={styles.detailValue}>HOA approval required</Text>
              )}
              {data.property.permitLikely && (
                <Text style={styles.detailValue}>Permitting expected</Text>
              )}
              {data.property.accessNotes && (
                <Text style={styles.detailValue}>Access: {data.property.accessNotes}</Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SCOPE OF WORK</Text>
          <Text style={styles.narrative}>{data.narrative.scopeOverview}</Text>
          {data.narrative.included.length > 0 && (
            <Text style={{ ...styles.narrative, marginTop: 8 }}>{bulletList(data.narrative.included)}</Text>
          )}
          <Text style={{ ...styles.narrative, marginTop: 8 }}>{data.narrative.timelineSentence}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>INVESTMENT</Text>
          <View style={styles.tableHeader}>
            <Text style={styles.colDescription}>ITEM</Text>
            <Text style={styles.colQty}>QTY</Text>
            <Text style={styles.colUnit}>UNIT</Text>
            <Text style={styles.colPrice}>UNIT PRICE</Text>
            <Text style={styles.colTotal}>TOTAL</Text>
          </View>
          {data.lines.map((line, index) => (
            <View key={index} style={styles.tableRow} wrap={false}>
              <Text style={styles.colDescription}>{line.description}</Text>
              <Text style={styles.colQty}>{line.quantity}</Text>
              <Text style={styles.colUnit}>{line.unit}</Text>
              <Text style={styles.colPrice}>{usd(line.unitPrice)}</Text>
              <Text style={styles.colTotal}>{usd(line.lineTotal)}</Text>
            </View>
          ))}
          <View style={styles.totalsBox}>
            <View style={styles.totalsRow}>
              <Text>Subtotal</Text>
              <Text style={styles.colTotal}>{usd(data.totals.subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text>Contingency (5%)</Text>
              <Text style={styles.colTotal}>{usd(data.totals.contingency)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text>Sales tax (materials)</Text>
              <Text style={styles.colTotal}>{usd(data.totals.tax)}</Text>
            </View>
            <View style={styles.totalsRowBold}>
              <Text>Total</Text>
              <Text>{usd(data.totals.total)}</Text>
            </View>
          </View>
        </View>

        {data.optionalAddOns.length > 0 && (
          <View style={styles.addOns}>
            <Text style={styles.addOnsTitle}>OPTIONAL ADD-ONS</Text>
            {data.optionalAddOns.map((addOn, index) => (
              <Text key={index} style={{ fontSize: 9.5, marginBottom: 2 }}>
                •  {addOn.description} ({addOn.quantity} {addOn.unit}) — priced separately on request
              </Text>
            ))}
            <Text style={styles.addOnsNote}>
              Not included in the total above. Ask your project lead to add any of these.
            </Text>
          </View>
        )}

        <View style={styles.deposit}>
          <Text style={styles.depositLabel}>50% deposit begins your project</Text>
          <Text style={styles.depositAmount}>{usd(deposit)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TERMS</Text>
          <Text style={styles.terms}>
            {data.narrative.exclusions.length > 0 &&
              `Exclusions: ${data.narrative.exclusions.join('; ')}. `}
            Proposal valid for 30 days. 50% deposit is due at contract signing with the balance due
            at completion. Change orders are billed separately and require written approval. Work
            warranty: 2 years on hardscape workmanship. Greenscape Pro is licensed, bonded and
            insured in the state of Arizona.
          </Text>
        </View>

        <View style={styles.signatureRow}>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>CLIENT SIGNATURE / DATE</Text>
          </View>
          <View style={styles.signatureCol}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>GREENSCAPE PRO / DATE</Text>
          </View>
        </View>

        <Text style={styles.footer} fixed>
          Greenscape Pro · Phoenix, AZ · Thank you for the opportunity to build your outdoor space.
        </Text>
      </Page>
    </Document>
  );
}
