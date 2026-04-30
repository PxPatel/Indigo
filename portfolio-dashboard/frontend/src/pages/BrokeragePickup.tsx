import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, DownloadCloud, Loader2, PlugZap, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  api,
  type BrokerageIntegration,
  type BrokerageIntegrationId,
  type BrokeragePickupPreviewResponse,
  type BrokerageRequestPreview,
  type WebullUniformFillRow,
} from '../api/client';
import { Card } from '../components/Card';
import { MetricCard } from '../components/MetricCard';
import { usePortfolioStore } from '../stores/portfolioStore';
import { formatCurrency } from '../utils/format';

function tradeKey(row: WebullUniformFillRow): string {
  return [
    row.row_index,
    row.symbol,
    row.side,
    row.quantity,
    row.price,
    row.filled_at_utc,
    row.client_order_id || '',
    row.order_id || '',
  ].join('|');
}

function FillDetail({ row }: { row: WebullUniformFillRow }) {
  return (
    <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.45 }}>
      <div>
        <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>{row.symbol}</span>
        {' '}
        <span style={{ color: row.side === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)' }}>{row.side}</span>
        {' '}
        {row.quantity} @ {row.price} → {formatCurrency(row.total_amount)}
      </div>
      <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>{row.filled_at_est}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{row.filled_at_utc}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', marginTop: 3 }}>
        {row.instrument_type}
        {row.combo_type ? ` · ${row.combo_type}` : ''}
      </div>
    </div>
  );
}

function RequestPreview({ preview }: { preview: BrokerageRequestPreview }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 10,
      padding: 14,
      background: 'var(--bg-tertiary)',
      border: '1px solid var(--border)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: '#fff',
          background: 'var(--accent-blue)',
          borderRadius: 5,
          padding: '3px 7px',
        }}>
          {preview.method}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', wordBreak: 'break-all' }}>
          {preview.url}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        {Object.entries(preview.query).map(([key, value]) => (
          <div key={key} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{key}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {value}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
        <ShieldCheck size={15} color="var(--accent-green)" />
        Headers, cookies, tokens, signatures, and env var values stay hidden. Hidden fields: {preview.hidden.join(', ')}.
      </div>
    </div>
  );
}

function IntegrationCard({
  integration,
  selected,
  onSelect,
}: {
  integration: BrokerageIntegration;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: 'left',
        background: selected ? 'rgba(59, 130, 246, 0.10)' : 'var(--bg-secondary)',
        border: selected ? '1px solid var(--accent-blue)' : '1px solid var(--border)',
        borderRadius: 10,
        padding: 16,
        cursor: 'pointer',
        color: 'var(--text-primary)',
        transition: 'border-color 0.15s ease, background 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, fontWeight: 700 }}>{integration.label}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
            {integration.description}
          </div>
        </div>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: integration.configured ? 'var(--accent-green)' : 'var(--accent-amber)',
          border: `1px solid ${integration.configured ? 'var(--accent-green)' : 'var(--accent-amber)'}`,
          borderRadius: 999,
          padding: '3px 7px',
          whiteSpace: 'nowrap',
        }}>
          {integration.configured ? 'READY' : 'SETUP'}
        </span>
      </div>
      {integration.unavailable_reason && (
        <div style={{ color: 'var(--accent-amber)', fontSize: 12, marginTop: 10 }}>{integration.unavailable_reason}</div>
      )}
    </button>
  );
}

export default function BrokeragePickup() {
  const queryClient = useQueryClient();
  const setManualEntryCount = usePortfolioStore((s) => s.setManualEntryCount);
  const setManualEntryModalOpen = usePortfolioStore((s) => s.setManualEntryModalOpen);
  const [selectedId, setSelectedId] = useState<BrokerageIntegrationId>('webull');
  const [accountId, setAccountId] = useState('');
  const [selectedTradeKeys, setSelectedTradeKeys] = useState<Set<string>>(new Set());
  const [resultEpoch, setResultEpoch] = useState(0);

  const integrationsQuery = useQuery({
    queryKey: ['brokerage-integrations'],
    queryFn: api.getBrokerageIntegrations,
  });

  const selectedIntegration = integrationsQuery.data?.integrations.find((i) => i.id === selectedId);

  const previewMutation = useMutation({
    mutationFn: () => api.previewBrokeragePickup(selectedId, { account_id: accountId.trim() || undefined }),
    onSuccess: (data) => {
      setSelectedTradeKeys(new Set(data.unmatched_api_rows.map(tradeKey)));
      setResultEpoch((n) => n + 1);
    },
  });

  const importMutation = useMutation({
    mutationFn: (trades: WebullUniformFillRow[]) => api.importBrokeragePickupTrades(selectedId, { trades }),
    onSuccess: (data) => {
      setManualEntryCount(data.manual_entries.count);
      queryClient.invalidateQueries();
    },
  });

  const preview = previewMutation.data as BrokeragePickupPreviewResponse | undefined;
  const selectedTrades = useMemo(() => {
    if (!preview) return [];
    return preview.unmatched_api_rows.filter((row) => selectedTradeKeys.has(tradeKey(row)));
  }, [preview, selectedTradeKeys]);
  const selectedTotal = selectedTrades.reduce((sum, row) => sum + row.total_amount, 0);
  const allSelected = Boolean(preview?.unmatched_api_rows.length) && selectedTrades.length === preview?.unmatched_api_rows.length;

  const toggleTrade = (row: WebullUniformFillRow) => {
    const key = tradeKey(row);
    setSelectedTradeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (!preview) return;
    setSelectedTradeKeys(allSelected ? new Set() : new Set(preview.unmatched_api_rows.map(tradeKey)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PlugZap size={22} color="var(--accent-blue)" />
        <div>
          <h1 style={{
            fontFamily: 'var(--font-heading)',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-primary)',
            margin: 0,
          }}>
            Brokerage Pickup
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, maxWidth: 760, margin: '4px 0 0' }}>
            Pull new fills after your CSV export, compare them against uploaded rows, then choose exactly which trades
            become manual entries.
          </p>
        </div>
      </div>

      <Card title="1. Choose integration" index={0}>
        {integrationsQuery.isLoading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading supported brokerages…</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {(integrationsQuery.data?.integrations || []).map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                selected={integration.id === selectedId}
                onSelect={() => setSelectedId(integration.id)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="2. Confirm request" index={1}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) minmax(0, 1fr)', gap: 14 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Account ID override
              </span>
              <input
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="Use WEBULL_ACCOUNT_ID"
                style={{
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: 'var(--text-primary)',
                  padding: '9px 11px',
                  fontSize: 13,
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </label>
            <div style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55 }}>
              Webull can only look back about two years. Pickup starts on the last available CSV date, inclusively, so
              fills on that boundary can still be matched and filtered out.
            </div>
          </div>

          {selectedIntegration?.request_preview ? (
            <RequestPreview preview={selectedIntegration.request_preview} />
          ) : (
            <div style={{
              padding: 14,
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              fontSize: 13,
              lineHeight: 1.5,
            }}>
              The backend will build the Webull order-history request after confirmation. Secret headers, signatures,
              access tokens, cookies, and env var values will not be shown or returned.
            </div>
          )}

          <button
            type="button"
            disabled={previewMutation.isPending || !selectedIntegration}
            onClick={() => previewMutation.mutate()}
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              background: previewMutation.isPending ? 'var(--bg-tertiary)' : 'var(--accent-blue)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: previewMutation.isPending ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {previewMutation.isPending ? <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> : <DownloadCloud size={16} />}
            {previewMutation.isPending ? 'Fetching trades…' : 'Confirm and fetch trades'}
          </button>
          {previewMutation.isError && (
            <div style={{ color: 'var(--accent-red)', fontSize: 13 }}>
              {previewMutation.error instanceof Error ? previewMutation.error.message : 'Pickup failed.'}
            </div>
          )}
        </div>
      </Card>

      <AnimatePresence>
        {preview && (
          <motion.div
            key={resultEpoch}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <MetricCard index={0} label="API fills" value={preview.api_rows.length.toString()} />
              <MetricCard index={1} label="Already in CSV" value={preview.matches.length.toString()} />
              <MetricCard index={2} label="New candidates" value={preview.unmatched_api_rows.length.toString()} />
              <MetricCard index={3} label="Selected value" value={formatCurrency(selectedTotal)} />
            </div>

            {preview.fetch_warnings.length > 0 && (
              <div style={{
                border: '1px solid var(--accent-amber)',
                background: 'rgba(245, 158, 11, 0.08)',
                borderRadius: 8,
                padding: 12,
                color: 'var(--text-secondary)',
                fontSize: 12,
              }}>
                {preview.fetch_warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}

            <Card title="3. Review and import" index={2}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                  {preview.unmatched_api_rows.length === 0
                    ? 'No new Webull trades were found outside the uploaded CSV.'
                    : `${selectedTrades.length} of ${preview.unmatched_api_rows.length} new trades selected.`}
                </div>
                {preview.unmatched_api_rows.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    style={{
                      background: 'var(--bg-tertiary)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      borderRadius: 6,
                      padding: '7px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {allSelected ? 'Clear all' : 'Select all'}
                  </button>
                )}
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid var(--border)',
                borderRadius: 8,
                overflow: 'hidden',
                background: 'var(--bg-tertiary)',
              }}>
                {preview.unmatched_api_rows.map((row, index) => {
                  const selected = selectedTradeKeys.has(tradeKey(row));
                  return (
                    <button
                      key={tradeKey(row)}
                      type="button"
                      onClick={() => toggleTrade(row)}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'center',
                        textAlign: 'left',
                        width: '100%',
                        background: selected ? 'rgba(0, 220, 130, 0.08)' : 'transparent',
                        border: 'none',
                        borderBottom: index === preview.unmatched_api_rows.length - 1 ? 'none' : '1px solid var(--border)',
                        padding: '11px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        border: selected ? '1px solid var(--accent-green)' : '1px solid var(--border-active)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: 2,
                      }}>
                        {selected ? <CheckCircle2 size={14} color="var(--accent-green)" /> : null}
                      </span>
                      <FillDetail row={row} />
                    </button>
                  );
                })}
              </div>

              {preview.unmatched_api_rows.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
                  <button
                    type="button"
                    disabled={importMutation.isPending || selectedTrades.length === 0}
                    onClick={() => importMutation.mutate(selectedTrades)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 18px',
                      background: importMutation.isPending || selectedTrades.length === 0 ? 'var(--bg-tertiary)' : 'var(--accent-green)',
                      color: importMutation.isPending || selectedTrades.length === 0 ? 'var(--text-muted)' : '#04130b',
                      border: 'none',
                      borderRadius: 6,
                      cursor: importMutation.isPending || selectedTrades.length === 0 ? 'not-allowed' : 'pointer',
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    {importMutation.isPending ? <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> : null}
                    {importMutation.isPending ? 'Importing…' : `Import ${selectedTrades.length} selected`}
                  </button>
                  {importMutation.isSuccess && (
                    <div style={{ color: 'var(--accent-green)', fontSize: 13 }}>
                      Imported {importMutation.data.imported_ids.length} trades
                      {importMutation.data.skipped_count ? `, skipped ${importMutation.data.skipped_count} duplicates` : ''}.
                      {' '}
                      <button
                        type="button"
                        onClick={() => setManualEntryModalOpen(true)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-blue)', cursor: 'pointer', padding: 0 }}
                      >
                        View Manual Entries
                      </button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
