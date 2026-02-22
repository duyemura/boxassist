'use client'

import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: {
    backgroundColor: '#FFFFFF',
    padding: 48,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 32,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: '#0063FF',
  },
  logo: {
    width: 20,
    height: 20,
    backgroundColor: '#0063FF',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandName: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  brandSub: {
    fontSize: 9,
    color: '#9CA3AF',
    marginTop: 1,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  reportTitle: {
    fontSize: 9,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  reportDate: {
    fontSize: 11,
    color: '#374151',
    marginTop: 2,
    fontFamily: 'Helvetica-Bold',
  },
  gymName: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginBottom: 4,
  },
  gymSub: {
    fontSize: 10,
    color: '#6B7280',
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#F8F9FB',
    padding: 14,
    borderLeftWidth: 2,
    borderLeftColor: '#0063FF',
  },
  statLabel: {
    fontSize: 8,
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
  },
  statSub: {
    fontSize: 9,
    color: '#6B7280',
    marginTop: 2,
  },
  statValueGreen: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: '#16A34A',
  },
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 20,
  },
  table: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tableRowLast: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  thText: {
    fontSize: 8,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tdText: {
    fontSize: 9,
    color: '#111827',
  },
  tdTextMuted: {
    fontSize: 9,
    color: '#6B7280',
  },
  tdTextGreen: {
    fontSize: 9,
    color: '#16A34A',
    fontFamily: 'Helvetica-Bold',
  },
  col1: { flex: 2 },
  col2: { flex: 2 },
  col3: { flex: 1.5 },
  col4: { flex: 1 },
  footer: {
    position: 'absolute',
    bottom: 32,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: '#D1D5DB',
  },
})

interface ReportProps {
  gymName: string
  month: string
  stats: {
    agentRuns: number
    membersFlagged: number
    messagesSent: number
    membersRetained: number
    totalValue: number
    agentCost: number
    roiMultiplier: number
  }
  actions: Array<{
    memberName: string
    playbook: string
    outcome: string
    value: string
    date: string
  }>
}

export function RetentionReportPDF({ gymName, month, stats, actions }: ReportProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.logo} />
            <View>
              <Text style={styles.brandName}>GymAgents</Text>
              <Text style={styles.brandSub}>Powered by PushPress</Text>
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.reportTitle}>Monthly Retention Report</Text>
            <Text style={styles.reportDate}>{month}</Text>
          </View>
        </View>

        {/* Gym name */}
        <Text style={styles.gymName}>{gymName}</Text>
        <Text style={styles.gymSub}>AI-powered member retention summary</Text>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Members Retained</Text>
            <Text style={styles.statValueGreen}>{stats.membersRetained}</Text>
            <Text style={styles.statSub}>of {stats.membersFlagged} flagged</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Value</Text>
            <Text style={styles.statValueGreen}>${stats.totalValue.toLocaleString()}</Text>
            <Text style={styles.statSub}>revenue protected</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>ROI</Text>
            <Text style={styles.statValueGreen}>{stats.roiMultiplier}x</Text>
            <Text style={styles.statSub}>${stats.agentCost.toFixed(2)} agent cost</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Agent Runs</Text>
            <Text style={styles.statValue}>{stats.agentRuns}</Text>
            <Text style={styles.statSub}>{stats.messagesSent} messages sent</Text>
          </View>
        </View>

        {/* Actions table */}
        <Text style={styles.sectionTitle}>Member Actions This Month</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.thText, styles.col1]}>Member</Text>
            <Text style={[styles.thText, styles.col2]}>Playbook</Text>
            <Text style={[styles.thText, styles.col3]}>Outcome</Text>
            <Text style={[styles.thText, styles.col4]}>Value</Text>
          </View>
          {actions.map((a, i) => (
            <View key={i} style={i === actions.length - 1 ? styles.tableRowLast : styles.tableRow}>
              <Text style={[styles.tdText, styles.col1]}>{a.memberName}</Text>
              <Text style={[styles.tdTextMuted, styles.col2]}>{a.playbook}</Text>
              <Text style={[styles.tdTextMuted, styles.col3]}>{a.outcome}</Text>
              <Text style={[styles.tdTextGreen, styles.col4]}>{a.value}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>GymAgents — Powered by PushPress</Text>
          <Text style={styles.footerText}>{gymName} · {month}</Text>
        </View>
      </Page>
    </Document>
  )
}
