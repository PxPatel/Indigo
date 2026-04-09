import { useState, useEffect, useCallback } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { usePortfolioStore } from '../stores/portfolioStore';
import { formatCurrency } from '../utils/format';
import type { ManualEntryRecord, FundTransferRecord, CashAnchorRequest } from '../api/client';

type Tab = 'transactions' | 'transfers' | 'anchor';

const EMPTY_TXN = { date: '', symbol: '', side: 'BUY' as const, quantity: '', price: '', note: '' };
const EMPTY_FT = { date: '', type: 'DEPOSIT' as const, amount: '', note: '' };
const EMPTY_ANCHOR = { date: '', balance: '' };

export function ManualEntryModal() {
  const { manualEntryModalOpen, setManualEntryModalOpen, setManualEntryCount, setFundTransferCount, setHasCashAnchor } = usePortfolioStore();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('transactions');
  const [entries, setEntries] = useState<ManualEntryRecord[]>([]);
  const [transfers, setTransfers] = useState<FundTransferRecord[]>([]);
  const [anchor, setAnchor] = useState<CashAnchorRequest | null>(null);
  const [anchorForm, setAnchorForm] = useState(EMPTY_ANCHOR);
  const [txnForm, setTxnForm] = useState(EMPTY_TXN);
  const [ftForm, setFtForm] = useState(EMPTY_FT);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidateAll = useCallback(() => { queryClient.invalidateQueries(); }, [queryClient]);

  const loadData = useCallback(async () => {
    try {
      const [e, t, a] = await Promise.all([api.getManualEntries(), api.getFundTransfers(), api.getCashAnchor()]);
      setEntries(e.entries);
      setManualEntryCount(e.count);
      setTransfers(t.transfers);
      setFundTransferCount(t.count);
      setAnchor(a.anchor);
      setHasCashAnchor(a.anchor !== null);
    } catch { /* silently fail */ }
  }, [setManualEntryCount, setFundTransferCount, setHasCashAnchor]);

  useEffect(() => {
    if (manualEntryModalOpen) loadData();
  }, [manualEntryModalOpen, loadData]);

  const handleAddTxn = useCallback(async () => {
    setError(null);
    if (!txnForm.date || !txnForm.symbol || !txnForm.quantity || !txnForm.price) {
      setError('Date, symbol, quantity, and price are required.');
      return;
    }
    const qty = parseFloat(txnForm.quantity);
    const price = parseFloat(txnForm.price);
    if (isNaN(qty) || qty <= 0) { setError('Quantity must be a positive number.'); return; }
    if (isNaN(price) || price <= 0) { setError('Price must be a positive number.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(txnForm.date)) { setError('Date must be YYYY-MM-DD.'); return; }

    setSubmitting(true);
    try {
      const res = await api.addManualEntry({
        date: txnForm.date, symbol: txnForm.symbol.toUpperCase().trim(),
        side: txnForm.side, quantity: qty, price, note: txnForm.note,
      });
      setEntries(res.entries);
      setManualEntryCount(res.count);
      setTxnForm(EMPTY_TXN);
      invalidateAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add entry.');
    } finally { setSubmitting(false); }
  }, [txnForm, setManualEntryCount, invalidateAll]);

  const handleDeleteTxn = useCallback(async (id: number) => {
    try {
      const res = await api.deleteManualEntry(id);
      setEntries(res.entries);
      setManualEntryCount(res.count);
      invalidateAll();
    } catch { /* silently fail */ }
  }, [setManualEntryCount, invalidateAll]);

  const handleAddFt = useCallback(async () => {
    setError(null);
    if (!ftForm.date || !ftForm.amount) {
      setError('Date and amount are required.');
      return;
    }
    const amount = parseFloat(ftForm.amount);
    if (isNaN(amount) || amount <= 0) { setError('Amount must be a positive number.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ftForm.date)) { setError('Date must be YYYY-MM-DD.'); return; }

    setSubmitting(true);
    try {
      const res = await api.addFundTransfer({
        date: ftForm.date, type: ftForm.type, amount, note: ftForm.note,
      });
      setTransfers(res.transfers);
      setFundTransferCount(res.count);
      setFtForm(EMPTY_FT);
      invalidateAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add transfer.');
    } finally { setSubmitting(false); }
  }, [ftForm, setFundTransferCount, invalidateAll]);

  const handleDeleteFt = useCallback(async (id: number) => {
    try {
      const res = await api.deleteFundTransfer(id);
      setTransfers(res.transfers);
      setFundTransferCount(res.count);
      invalidateAll();
    } catch { /* silently fail */ }
  }, [setFundTransferCount, invalidateAll]);

  const handleSetAnchor = useCallback(async () => {
    setError(null);
    if (!anchorForm.date || !anchorForm.balance) {
      setError('Date and balance are required.');
      return;
    }
    const balance = parseFloat(anchorForm.balance);
    if (isNaN(balance) || balance < 0) { setError('Balance must be zero or positive.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorForm.date)) { setError('Date must be YYYY-MM-DD.'); return; }

    setSubmitting(true);
    try {
      const res = await api.setCashAnchor({ date: anchorForm.date, balance });
      setAnchor(res.anchor);
      setHasCashAnchor(res.anchor !== null);
      setAnchorForm(EMPTY_ANCHOR);
      invalidateAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to set anchor.');
    } finally { setSubmitting(false); }
  }, [anchorForm, setHasCashAnchor, invalidateAll]);

  const handleDeleteAnchor = useCallback(async () => {
    try {
      const res = await api.deleteCashAnchor();
      setAnchor(res.anchor);
      setHasCashAnchor(false);
      invalidateAll();
    } catch { /* silently fail */ }
  }, [setHasCashAnchor, invalidateAll]);

  if (!manualEntryModalOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={() => setManualEntryModalOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 8, width: 580, maxHeight: '80vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 20px', borderBottom: '1px solid var(--border)',
          }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
              Manual Entries
            </div>
            <button onClick={() => setManualEntryModalOpen(false)}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4, display: 'flex' }}>
              <X size={16} />
            </button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            {([
              { key: 'transactions' as Tab, label: 'Transactions', count: entries.length },
              { key: 'transfers' as Tab, label: 'Fund Transfers', count: transfers.length },
              { key: 'anchor' as Tab, label: 'Cash Balance', count: anchor ? 1 : 0 },
            ]).map((t) => (
              <button key={t.key} onClick={() => { setTab(t.key); setError(null); }}
                style={{
                  flex: 1, padding: '10px 16px', fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 500,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: tab === t.key ? '2px solid var(--accent-blue)' : '2px solid transparent',
                  transition: 'all 0.15s ease',
                }}>
                {t.label}
                {t.count > 0 && (
                  <span style={{
                    marginLeft: 6, background: 'var(--accent-blue)', color: '#fff',
                    fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                    padding: '1px 5px', borderRadius: 8, lineHeight: '14px',
                  }}>{t.count}</span>
                )}
              </button>
            ))}
          </div>

          <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
            {tab === 'transactions' ? (
              <TransactionTab
                form={txnForm} setForm={setTxnForm} entries={entries}
                onAdd={handleAddTxn} onDelete={handleDeleteTxn}
                submitting={submitting} error={error}
              />
            ) : tab === 'transfers' ? (
              <FundTransferTab
                form={ftForm} setForm={setFtForm} transfers={transfers}
                onAdd={handleAddFt} onDelete={handleDeleteFt}
                submitting={submitting} error={error}
              />
            ) : (
              <CashAnchorTab
                form={anchorForm} setForm={setAnchorForm}
                anchor={anchor} onSet={handleSetAnchor} onDelete={handleDeleteAnchor}
                submitting={submitting} error={error}
              />
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// --- Transaction Tab ---

function TransactionTab({ form, setForm, entries, onAdd, onDelete, submitting, error }: {
  form: typeof EMPTY_TXN;
  setForm: (f: typeof EMPTY_TXN) => void;
  entries: ManualEntryRecord[];
  onAdd: () => void;
  onDelete: (id: number) => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
        Add missing transactions not in your CSV — broker transfers, position adjustments, or unrecorded trades.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <FormField label="Date" type="date" value={form.date}
          onChange={(v) => setForm({ ...form, date: v })} placeholder="YYYY-MM-DD" />
        <FormField label="Symbol" value={form.symbol}
          onChange={(v) => setForm({ ...form, symbol: v })} placeholder="e.g. AAPL"
          style={{ textTransform: 'uppercase' }} />
        <div>
          <div style={labelStyle}>Side</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['BUY', 'SELL'] as const).map((s) => (
              <button key={s} onClick={() => setForm({ ...form, side: s })} style={{
                flex: 1, padding: '7px 0', fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600,
                background: form.side === s ? (s === 'BUY' ? 'rgba(0,220,130,0.15)' : 'rgba(255,71,87,0.15)') : 'var(--bg-tertiary)',
                color: form.side === s ? (s === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)',
                border: `1px solid ${form.side === s ? (s === 'BUY' ? 'rgba(0,220,130,0.3)' : 'rgba(255,71,87,0.3)') : 'var(--border)'}`,
                borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s ease',
              }}>{s}</button>
            ))}
          </div>
        </div>
        <FormField label="Quantity" value={form.quantity}
          onChange={(v) => setForm({ ...form, quantity: v })} placeholder="0.00" type="number" />
        <FormField label="Price per share" value={form.price}
          onChange={(v) => setForm({ ...form, price: v })} placeholder="0.00" type="number" />
        <FormField label="Note (optional)" value={form.note}
          onChange={(v) => setForm({ ...form, note: v })} placeholder="e.g. Broker transfer" />
      </div>

      <ErrorMessage error={error} />
      <SubmitButton onClick={onAdd} submitting={submitting} label="Add Transaction" />

      {entries.length > 0 && (
        <EntryList count={entries.length} label="entry" labelPlural="entries">
          {entries.map((e) => (
            <div key={e.id} style={entryRowStyle}>
              <span style={{ color: 'var(--text-muted)', width: 75, flexShrink: 0 }}>{e.date}</span>
              <span style={{ fontWeight: 600, width: 50, flexShrink: 0 }}>{e.symbol}</span>
              <SideBadge side={e.side} />
              <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{e.quantity} @ ${e.price.toFixed(2)}</span>
              <span style={{ color: 'var(--text-primary)', flexShrink: 0 }}>{formatCurrency(e.total_amount)}</span>
              {e.note && <NoteText note={e.note} />}
              <DeleteButton onClick={() => onDelete(e.id)} />
            </div>
          ))}
        </EntryList>
      )}
    </>
  );
}

// --- Fund Transfer Tab ---

function FundTransferTab({ form, setForm, transfers, onAdd, onDelete, submitting, error }: {
  form: typeof EMPTY_FT;
  setForm: (f: typeof EMPTY_FT) => void;
  transfers: FundTransferRecord[];
  onAdd: () => void;
  onDelete: (id: number) => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
        Record deposits into or withdrawals from your brokerage account. These are used to track your cash balance and net invested capital.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <FormField label="Date" type="date" value={form.date}
          onChange={(v) => setForm({ ...form, date: v })} placeholder="YYYY-MM-DD" />
        <div>
          <div style={labelStyle}>Type</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['DEPOSIT', 'WITHDRAWAL'] as const).map((t) => (
              <button key={t} onClick={() => setForm({ ...form, type: t })} style={{
                flex: 1, padding: '7px 0', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
                background: form.type === t ? (t === 'DEPOSIT' ? 'rgba(0,220,130,0.15)' : 'rgba(255,71,87,0.15)') : 'var(--bg-tertiary)',
                color: form.type === t ? (t === 'DEPOSIT' ? 'var(--accent-green)' : 'var(--accent-red)') : 'var(--text-muted)',
                border: `1px solid ${form.type === t ? (t === 'DEPOSIT' ? 'rgba(0,220,130,0.3)' : 'rgba(255,71,87,0.3)') : 'var(--border)'}`,
                borderRadius: 4, cursor: 'pointer', transition: 'all 0.15s ease',
              }}>{t}</button>
            ))}
          </div>
        </div>
        <FormField label="Amount" value={form.amount}
          onChange={(v) => setForm({ ...form, amount: v })} placeholder="0.00" type="number" />
        <FormField label="Note (optional)" value={form.note}
          onChange={(v) => setForm({ ...form, note: v })} placeholder="e.g. ACH transfer" />
      </div>

      <ErrorMessage error={error} />
      <SubmitButton onClick={onAdd} submitting={submitting} label="Add Transfer" />

      {transfers.length > 0 && (
        <EntryList count={transfers.length} label="transfer" labelPlural="transfers">
          {transfers.map((t) => (
            <div key={t.id} style={entryRowStyle}>
              <span style={{ color: 'var(--text-muted)', width: 75, flexShrink: 0 }}>{t.date}</span>
              <span style={{
                padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, flexShrink: 0,
                background: t.type === 'DEPOSIT' ? 'rgba(0,220,130,0.15)' : 'rgba(255,71,87,0.15)',
                color: t.type === 'DEPOSIT' ? 'var(--accent-green)' : 'var(--accent-red)',
              }}>{t.type}</span>
              <span style={{
                fontWeight: 600, flexShrink: 0,
                color: t.type === 'DEPOSIT' ? 'var(--accent-green)' : 'var(--accent-red)',
              }}>{formatCurrency(t.amount)}</span>
              {t.note && <NoteText note={t.note} />}
              <DeleteButton onClick={() => onDelete(t.id)} />
            </div>
          ))}
        </EntryList>
      )}
    </>
  );
}

// --- Cash Anchor Tab ---

function CashAnchorTab({ form, setForm, anchor, onSet, onDelete, submitting, error }: {
  form: typeof EMPTY_ANCHOR;
  setForm: (f: typeof EMPTY_ANCHOR) => void;
  anchor: CashAnchorRequest | null;
  onSet: () => void;
  onDelete: () => void;
  submitting: boolean;
  error: string | null;
}) {
  return (
    <>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
        Set a known cash balance from your account statement on a specific date. This anchor point is used to derive your cash balance across the entire timeline by working backwards and forwards from transaction data.
      </div>

      {anchor ? (
        <>
          <div style={{
            padding: '14px 16px', background: 'var(--bg-tertiary)', borderRadius: 6,
            border: '1px solid var(--border)', marginBottom: 16,
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
              Current Anchor
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontFamily: 'var(--font-mono)', fontSize: 13 }}>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Date: </span>
                <span style={{ fontWeight: 600 }}>{anchor.date}</span>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Balance: </span>
                <span style={{ fontWeight: 600, color: 'var(--accent-green)' }}>{formatCurrency(anchor.balance)}</span>
              </div>
              <button onClick={onDelete} style={{
                marginLeft: 'auto', background: 'none', border: '1px solid rgba(255,71,87,0.3)',
                borderRadius: 4, color: 'var(--accent-red)', cursor: 'pointer', padding: '4px 10px',
                fontSize: 11, fontFamily: 'var(--font-body)', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <Trash2 size={12} /> Remove
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
            To update, remove the current anchor and set a new one.
          </div>
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <FormField label="Date" type="date" value={form.date}
              onChange={(v) => setForm({ ...form, date: v })} placeholder="YYYY-MM-DD" />
            <FormField label="Closing Cash Balance" value={form.balance}
              onChange={(v) => setForm({ ...form, balance: v })} placeholder="0.00" type="number" />
          </div>

          <ErrorMessage error={error} />
          <SubmitButton onClick={onSet} submitting={submitting} label="Set Cash Anchor" />
        </>
      )}
    </>
  );
}

// --- Shared small components ---

const labelStyle: React.CSSProperties = {
  fontSize: 10, fontFamily: 'var(--font-body)', color: 'var(--text-muted)',
  textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', background: 'var(--bg-tertiary)',
  border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none',
};
const entryRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
  background: 'var(--bg-tertiary)', borderRadius: 4, fontSize: 12, fontFamily: 'var(--font-mono)',
};

function FormField({ label, value, onChange, placeholder, type = 'text', style }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; style?: React.CSSProperties;
}) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} style={{ ...inputStyle, ...style }}
        step={type === 'number' ? 'any' : undefined} />
    </div>
  );
}

function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div style={{
      padding: '6px 12px', background: 'rgba(255,71,87,0.1)', border: '1px solid rgba(255,71,87,0.3)',
      borderRadius: 4, color: 'var(--accent-red)', fontSize: 12, marginBottom: 12,
    }}>{error}</div>
  );
}

function SubmitButton({ onClick, submitting, label }: { onClick: () => void; submitting: boolean; label: string }) {
  return (
    <button onClick={onClick} disabled={submitting} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      width: '100%', padding: '9px 16px', background: 'var(--accent-blue)', color: '#fff',
      border: 'none', borderRadius: 6, fontSize: 13, fontFamily: 'var(--font-heading)',
      fontWeight: 600, cursor: submitting ? 'wait' : 'pointer',
      opacity: submitting ? 0.7 : 1, transition: 'opacity 0.15s ease', marginBottom: 20,
    }}>
      <Plus size={14} />
      {submitting ? 'Adding...' : label}
    </button>
  );
}

function SideBadge({ side }: { side: string }) {
  return (
    <span style={{
      padding: '1px 5px', borderRadius: 3, fontSize: 10, fontWeight: 600, flexShrink: 0,
      background: side === 'BUY' ? 'rgba(0,220,130,0.15)' : 'rgba(255,71,87,0.15)',
      color: side === 'BUY' ? 'var(--accent-green)' : 'var(--accent-red)',
    }}>{side}</span>
  );
}

function NoteText({ note }: { note: string }) {
  return (
    <span style={{
      color: 'var(--text-muted)', fontSize: 10, flex: 1, overflow: 'hidden',
      textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-body)',
    }}>{note}</span>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
      padding: 2, display: 'flex', marginLeft: 'auto', flexShrink: 0,
    }} title="Remove">
      <Trash2 size={13} />
    </button>
  );
}

function EntryList({ count, label, labelPlural, children }: {
  count: number; label: string; labelPlural: string; children: React.ReactNode;
}) {
  return (
    <>
      <div style={{
        fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase',
        letterSpacing: '0.5px', marginBottom: 8,
      }}>
        {count} manual {count === 1 ? label : labelPlural}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </>
  );
}
