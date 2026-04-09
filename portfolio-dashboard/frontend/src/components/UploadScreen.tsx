import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Upload, FileSpreadsheet, X, Database } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../api/client';
import { usePortfolioStore } from '../stores/portfolioStore';
import { getCachedFiles, saveFilesToCache } from '../utils/fileCache';

export function UploadScreen() {
  const navigate = useNavigate();
  const { setUploaded, setLoading, setError } = usePortfolioStore();
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [cachedNames, setCachedNames] = useState<Set<string>>(new Set());

  // Load cached files on mount and pre-populate the staged list
  useEffect(() => {
    getCachedFiles().then((files) => {
      if (files.length > 0) {
        setStagedFiles(files);
        setCachedNames(new Set(files.map((f) => f.name)));
      }
    }).catch(() => {
      // IndexedDB unavailable — silently skip, user can upload manually
    });
  }, []);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles).filter((f) => f.name.endsWith('.csv'));
    setStagedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      return [...prev, ...arr.filter((f) => !existing.has(f.name))];
    });
  }, []);

  const removeFile = useCallback((name: string) => {
    setStagedFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const handleUpload = useCallback(async () => {
    if (stagedFiles.length === 0) return;
    setUploading(true);
    setUploadError(null);
    setLoading(true);
    try {
      const result = await api.upload(stagedFiles);
      // Save the current file set as the new cache before navigating away
      await saveFilesToCache(stagedFiles);
      setUploaded(result.symbols);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(msg);
      setError(msg);
    } finally {
      setUploading(false);
      setLoading(false);
    }
  }, [stagedFiles, setUploaded, setLoading, setError, navigate]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  }, [addFiles]);

  const hasCached = cachedNames.size > 0;

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-primary)',
    }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        style={{ textAlign: 'center', maxWidth: 520 }}
      >
        <div style={{
          fontFamily: 'var(--font-heading)',
          fontWeight: 700,
          fontSize: 28,
          color: 'var(--text-primary)',
          marginBottom: 8,
          letterSpacing: '-0.5px',
        }}>
          INDIGO
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--text-secondary)',
          marginBottom: 32,
        }}>
          Portfolio Command Center
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          style={{
            border: `2px dashed ${dragging ? 'var(--accent-blue)' : 'var(--border-active)'}`,
            borderRadius: 8,
            padding: '36px 32px',
            background: dragging ? 'rgba(59,130,246,0.05)' : 'var(--bg-secondary)',
            transition: 'all 0.2s ease',
            cursor: 'pointer',
          }}
          onClick={() => document.getElementById('csv-input')?.click()}
        >
          <input
            id="csv-input"
            type="file"
            accept=".csv"
            multiple
            onChange={onFileSelect}
            style={{ display: 'none' }}
          />

          {uploading ? (
            <div>
              <div style={{
                width: 40,
                height: 40,
                border: '3px solid var(--border-active)',
                borderTopColor: 'var(--accent-blue)',
                borderRadius: '50%',
                margin: '0 auto 16px',
                animation: 'spin 1s linear infinite',
              }} />
              <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                Processing {stagedFiles.length} file{stagedFiles.length > 1 ? 's' : ''}...
              </div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 16, color: 'var(--text-muted)' }}>
                <FileSpreadsheet size={48} strokeWidth={1.2} />
              </div>
              <div style={{
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                fontSize: 16,
                color: 'var(--text-primary)',
                marginBottom: 8,
              }}>
                {hasCached ? 'Add or remove files' : 'Upload your Webull CSVs'}
              </div>
              <div style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                marginBottom: 16,
              }}>
                {hasCached
                  ? 'Cached files loaded — drop a new file to add it'
                  : 'Drop one or more yearly transaction exports here'}
              </div>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                color: 'var(--text-secondary)',
                fontSize: 13,
              }}>
                <Upload size={14} />
                Browse files
              </div>
            </>
          )}
        </div>

        {/* Staged file list */}
        {stagedFiles.length > 0 && !uploading && (
          <div style={{ marginTop: 16, textAlign: 'left' }}>
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 8,
              fontFamily: 'var(--font-body)',
            }}>
              {stagedFiles.length} file{stagedFiles.length > 1 ? 's' : ''} queued
            </div>
            {stagedFiles.map((f) => {
              const isCached = cachedNames.has(f.name);
              return (
                <div
                  key={f.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    marginBottom: 4,
                    fontSize: 12,
                    fontFamily: 'var(--font-mono)',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {isCached && (
                      <Database size={11} color="var(--text-muted)" style={{ flexShrink: 0 }} />
                    )}
                    <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {isCached && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: 'var(--text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        fontFamily: 'var(--font-body)',
                      }}>
                        cached
                      </span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(f.name); }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: 2,
                        display: 'flex',
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}

            <button
              onClick={(e) => { e.stopPropagation(); handleUpload(); }}
              style={{
                marginTop: 12,
                width: '100%',
                padding: '10px 16px',
                background: 'var(--accent-blue)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontFamily: 'var(--font-heading)',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'opacity 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              Process {stagedFiles.length} file{stagedFiles.length > 1 ? 's' : ''}
            </button>
          </div>
        )}

        {uploadError && (
          <div style={{
            marginTop: 16,
            padding: '8px 16px',
            background: 'rgba(255,71,87,0.1)',
            border: '1px solid rgba(255,71,87,0.3)',
            borderRadius: 6,
            color: 'var(--accent-red)',
            fontSize: 13,
          }}>
            {uploadError}
          </div>
        )}
      </motion.div>
    </div>
  );
}
