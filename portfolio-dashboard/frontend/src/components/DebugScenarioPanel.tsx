import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, Clipboard, Play, RotateCcw, X } from 'lucide-react';
import { api } from '../api/client';
import type { DebugScenario } from '../api/client';
import { useToastStore } from './Toaster';

const DEBUG_UI_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_INDIGO_DEBUG_SCENARIOS === '1';

const EMPTY_SCENARIO: DebugScenario = {
  name: 'Local debug scenario',
  notes: '',
  valuation_date: null,
  transaction_overlays: [],
  holding_overrides: [],
  price_overrides: { current: {}, historical: {} },
};

const DEBUG_DISABLED_MESSAGE =
  'Debug backend routes are disabled. Set INDIGO_DEBUG_SCENARIOS=1 in backend/.env.local, then restart the backend.';

const disabledStatus = () => ({
  enabled: false,
  active: false,
  scenario: null,
  effective_today: new Date().toISOString().slice(0, 10),
});

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes('not found');
}

function parseJson<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed) as T;
}

function fieldStyle(multiline = false): CSSProperties {
  return {
    width: '100%',
    minHeight: multiline ? 84 : undefined,
    resize: multiline ? 'vertical' : undefined,
    padding: '8px 10px',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text-primary)',
    fontFamily: multiline ? 'var(--font-mono)' : 'var(--font-body)',
    fontSize: 12,
    outline: 'none',
  };
}

function labelStyle(): CSSProperties {
  return {
    display: 'block',
    marginBottom: 6,
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-body)',
    fontSize: 11,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  };
}

function buttonStyle(active = false): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 10px',
    borderRadius: 6,
    border: `1px solid ${active ? 'var(--accent-purple)' : 'var(--border-active)'}`,
    background: active ? 'rgba(139,92,246,0.16)' : 'var(--bg-tertiary)',
    color: active ? 'var(--accent-purple)' : 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'var(--font-body)',
    fontWeight: 600,
  };
}

export function DebugScenarioPanel() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(EMPTY_SCENARIO.name);
  const [notes, setNotes] = useState('');
  const [valuationDate, setValuationDate] = useState('');
  const [currentPrices, setCurrentPrices] = useState('{}');
  const [historicalPrices, setHistoricalPrices] = useState('{}');
  const [holdings, setHoldings] = useState('[]');
  const [transactions, setTransactions] = useState('[]');
  const [importPayload, setImportPayload] = useState('');
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const { data: status, refetch } = useQuery({
    queryKey: ['debug-status'],
    queryFn: async () => {
      try {
        return await api.debugStatus();
      } catch (error) {
        if (isNotFound(error)) return disabledStatus();
        throw error;
      }
    },
    enabled: DEBUG_UI_ENABLED && open,
    retry: false,
    staleTime: 0,
  });

  if (!DEBUG_UI_ENABLED) return null;

  const invalidateDashboard = async () => {
    await queryClient.invalidateQueries();
    await refetch();
  };

  const ensureDebugEnabled = async () => {
    const current = status ?? (await refetch()).data;
    if (current?.enabled === false) {
      addToast({ type: 'error', message: DEBUG_DISABLED_MESSAGE });
      return false;
    }
    return true;
  };

  const applyScenario = async (scenario: DebugScenario) => {
    setBusy(true);
    try {
      if (!(await ensureDebugEnabled())) return;
      await api.importDebugScenario(scenario);
      await invalidateDashboard();
      addToast({ type: 'success', message: 'Debug scenario applied.' });
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to apply debug scenario.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    try {
      await applyScenario({
        name,
        notes,
        valuation_date: valuationDate || null,
        transaction_overlays: parseJson(transactions, []),
        holding_overrides: parseJson(holdings, []),
        price_overrides: {
          current: parseJson(currentPrices, {}),
          historical: parseJson(historicalPrices, {}),
        },
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Invalid scenario JSON.',
      });
    }
  };

  const handleImport = async () => {
    try {
      const scenario = parseJson<DebugScenario>(importPayload, EMPTY_SCENARIO);
      await applyScenario({
        ...EMPTY_SCENARIO,
        ...scenario,
        transaction_overlays: scenario.transaction_overlays ?? [],
        holding_overrides: scenario.holding_overrides ?? [],
        price_overrides: scenario.price_overrides ?? { current: {}, historical: {} },
      });
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Invalid import payload.',
      });
    }
  };

  const handleClear = async () => {
    setBusy(true);
    try {
      if (!(await ensureDebugEnabled())) return;
      await api.clearDebugScenario();
      await invalidateDashboard();
      addToast({ type: 'success', message: 'Debug scenario cleared.' });
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to clear debug scenario.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    try {
      if (!(await ensureDebugEnabled())) return;
      const scenario = await api.exportDebugScenario();
      const payload = JSON.stringify(scenario, null, 2);
      setImportPayload(payload);
      await navigator.clipboard?.writeText(payload);
      addToast({ type: 'success', message: 'Debug scenario copied to clipboard.' });
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'No active scenario to export.',
      });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          ...buttonStyle(status?.active),
          position: 'fixed',
          right: 18,
          bottom: 18,
          zIndex: 9000,
          boxShadow: '0 10px 28px rgba(0,0,0,0.35)',
        }}
      >
        <Bug size={14} />
        Debug
        {status?.active ? `: ${status.effective_today}` : ''}
      </button>

      {open && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 8999,
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: 18,
              bottom: 62,
              width: 'min(560px, calc(100vw - 36px))',
              maxHeight: 'calc(100vh - 86px)',
              overflow: 'auto',
              padding: 16,
              borderRadius: 8,
              border: '1px solid var(--border-active)',
              background: 'var(--bg-secondary)',
              boxShadow: '0 18px 50px rgba(0,0,0,0.55)',
              pointerEvents: 'all',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Bug size={16} color="var(--accent-purple)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 14 }}>
                  Debug Scenario
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {status?.enabled === false
                    ? 'Backend routes disabled'
                    : status?.active
                      ? `Active as of ${status.effective_today}`
                      : 'Inactive'}
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={buttonStyle()}>
                <X size={13} />
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: 10, marginBottom: 12 }}>
              <label>
                <span style={labelStyle()}>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle()} />
              </label>
              <label>
                <span style={labelStyle()}>Valuation Date</span>
                <input
                  type="date"
                  value={valuationDate}
                  onChange={(e) => setValuationDate(e.target.value)}
                  style={fieldStyle()}
                />
              </label>
            </div>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={labelStyle()}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={fieldStyle(true)} />
            </label>

            {status?.enabled === false && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '9px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,71,87,0.35)',
                  background: 'rgba(255,71,87,0.10)',
                  color: 'var(--text-secondary)',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {DEBUG_DISABLED_MESSAGE}
              </div>
            )}

            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={labelStyle()}>Current Price Overrides JSON</span>
              <textarea
                value={currentPrices}
                onChange={(e) => setCurrentPrices(e.target.value)}
                placeholder='{"AAPL": 190.12}'
                style={fieldStyle(true)}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={labelStyle()}>Historical Price Overrides JSON</span>
              <textarea
                value={historicalPrices}
                onChange={(e) => setHistoricalPrices(e.target.value)}
                placeholder='{"AAPL": {"2024-01-02": 185.64}}'
                style={fieldStyle(true)}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={labelStyle()}>Holding Replacement JSON</span>
              <textarea
                value={holdings}
                onChange={(e) => setHoldings(e.target.value)}
                placeholder='[{"symbol":"AAPL","shares":10,"avg_cost":150}]'
                style={fieldStyle(true)}
              />
            </label>

            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={labelStyle()}>Transaction Overlay JSON</span>
              <textarea
                value={transactions}
                onChange={(e) => setTransactions(e.target.value)}
                placeholder='[{"date":"2024-01-02","symbol":"MSFT","side":"BUY","quantity":3,"price":350}]'
                style={fieldStyle(true)}
              />
            </label>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <button type="button" disabled={busy} onClick={handleApply} style={buttonStyle(true)}>
                <Play size={13} />
                Apply
              </button>
              <button type="button" disabled={busy} onClick={handleClear} style={buttonStyle()}>
                <RotateCcw size={13} />
                Clear
              </button>
              <button type="button" disabled={busy} onClick={handleExport} style={buttonStyle()}>
                <Clipboard size={13} />
                Export Active
              </button>
            </div>

            <label style={{ display: 'block' }}>
              <span style={labelStyle()}>Import / Export Payload</span>
              <textarea
                value={importPayload}
                onChange={(e) => setImportPayload(e.target.value)}
                placeholder="Paste exported scenario JSON here."
                style={{ ...fieldStyle(true), minHeight: 130 }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" disabled={busy} onClick={handleImport} style={buttonStyle()}>
                Import Payload
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
