/* eslint-disable @typescript-eslint/no-explicit-any */
// components/CsvSplitterComponent.tsx
'use client';

import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import toast from 'react-hot-toast';

type SplitPart = {
  name: string;
  blob: Blob;
  url: string;        // object URL for individual download/preview
  rowCount: number;   // excluding header
  email?: string;     // input field model
  sending?: boolean;  // send state
  sentOk?: boolean;   // sent result
  error?: string | null;
};

export default function CsvSplitterComponent() {
  // inputs / options
  const [file, setFile] = useState<File | null>(null);
  const [agents, setAgents] = useState<string>('2');
  const [status, setStatus] = useState<string>('');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [includeBOM, setIncludeBOM] = useState<boolean>(true);
  const [shuffleRows, setShuffleRows] = useState<boolean>(false);

  // info
  const [rowsCount, setRowsCount] = useState<number | null>(null);
  const [headerPreview, setHeaderPreview] = useState<string[][] | null>(null);

  // NEW: hold split parts for per-file view/download/email
  const [parts, setParts] = useState<SplitPart[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const baseName = useMemo(() => {
    if (!file?.name) return 'split';
    const dot = file.name.lastIndexOf('.');
    return dot === -1 ? file.name : file.name.slice(0, dot);
  }, [file]);

  // cleanup object URLs on unmount/reset
  useEffect(() => {
    return () => {
      parts.forEach(p => URL.revokeObjectURL(p.url));
    };
  }, [parts]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setRowsCount(null);
    setHeaderPreview(null);
    setStatus('');
    // clear old parts + URLs
    setParts(prev => {
      prev.forEach(p => URL.revokeObjectURL(p.url));
      return [];
    });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setFile(f);
      if (inputRef.current) inputRef.current.files = e.dataTransfer.files as any;
      // clear old parts + URLs
      setParts(prev => {
        prev.forEach(p => URL.revokeObjectURL(p.url));
        return [];
      });
      setRowsCount(null);
      setHeaderPreview(null);
      setStatus('');
    }
  }, []);
  const prevent = (e: React.DragEvent) => e.preventDefault();

  const parseCsv = useCallback(async () => {
    if (!file) throw new Error('Please choose a CSV file.');
    setStatus('Parsing CSV…');
    const delimiterGuess = await guessDelimiter(file);
    setDelimiter(delimiterGuess);

    return new Promise<{ header: string[]; rows: string[][] }>((resolve, reject) => {
      Papa.parse<string[]>(file, {
        delimiter: delimiterGuess,
        skipEmptyLines: 'greedy',
        encoding: 'UTF-8',
        complete: (result) => {
          try {
            const data = result.data as string[][];
            if (!data || data.length === 0) throw new Error('CSV appears empty.');
            const header = data[0];
            const rows = data.slice(1);
            setRowsCount(rows.length);
            setHeaderPreview([header, rows[0] ?? []]);
            resolve({ header, rows });
          } catch (err) {
            reject(err);
          }
        },
        error: (err) => reject(err),
      });
    });
  }, [file]);

  const splitEvenly = (rows: string[][], parts: number) => {
    if (shuffleRows) {
      const copy = [...rows];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      rows = copy;
    }
    const size = Math.floor(rows.length / parts);
    const remainder = rows.length % parts;
    const chunks: string[][][] = [];
    let start = 0;
    for (let p = 0; p < parts; p++) {
      const extra = p < remainder ? 1 : 0;
      const end = start + size + extra;
      chunks.push(rows.slice(start, end));
      start = end;
    }
    return chunks;
  };

  const buildCsv = (header: string[], rows: string[][]) => {
    const csv = Papa.unparse([header, ...rows], { delimiter });
    return includeBOM
      ? new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
      : new Blob([csv], { type: 'text/csv;charset=utf-8' });
  };

  // UPDATED: split but DON'T immediately zip; show parts first
  const handleSplit = useCallback(async () => {
    try {
      if (!file) throw new Error('Please choose a CSV file.');
      const partsCount = Number(agents);
      if (!Number.isInteger(partsCount) || partsCount <= 0) throw new Error('Agents must be a positive integer.');

      const { header, rows } = await parseCsv();
      setStatus(`Splitting ${rows.length} records into ${partsCount} part(s)…`);

      const chunks = splitEvenly(rows, partsCount);
      const newParts: SplitPart[] = chunks.map((chunk, idx) => {
        const blob = buildCsv(header, chunk);
        const name = `${baseName}-part${idx + 1}.csv`;
        const url = URL.createObjectURL(blob);
        return { name, blob, url, rowCount: chunk.length, email: '' };
      });

      // cleanup old URLs then set
      setParts(prev => {
        prev.forEach(p => URL.revokeObjectURL(p.url));
        return newParts;
      });

      setStatus('Done! Files are ready below. You can download individually, send via email, or download all as ZIP.');
    } catch (err: any) {
      console.error(err);
      setStatus(err.message || String(err));
    }
  }, [file, agents, baseName, parseCsv, includeBOM, delimiter]);

  // NEW: Download all as ZIP (same as before)
  const handleDownloadAll = useCallback(async () => {
    if (parts.length === 0) return;
    setStatus('Packaging ZIP…');
    const zip = new JSZip();
    parts.forEach(p => zip.file(p.name, p.blob));
    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    saveAs(zipBlob, `${baseName}-split-${parts.length}.zip`);
    setStatus('ZIP downloaded.');
  }, [parts, baseName]);

  // NEW: send a single split file via backend (Brevo) API route
  const sendPart = useCallback(
    async (index: number) => {
      const part = parts[index];
      if (!part) return;

      const email = (part.email || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setParts(ps => ps.map((p, i) => (i === index ? { ...p, error: 'Enter a valid email address.' } : p)));
        return;
      }

      setParts(ps => ps.map((p, i) => (i === index ? { ...p, sending: true, sentOk: false, error: null } : p)));

      try {
        const fd = new FormData();
        fd.append('email', email);
        fd.append('filename', part.name);
        fd.append('file', part.blob, part.name);

        // NOTE: implement a Next.js route at /api/send-split that uses Brevo to email the attachment.
        const res = await fetch('/api/send-split', { method: 'POST', body: fd });
        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || 'Failed to send email');
        }
        else{
          toast.success(`File ${part.name} sent to ${email}`);
        }

        setParts(ps => ps.map((p, i) => (i === index ? { ...p, sending: false, sentOk: true } : p)));
      } catch (e: any) {
        setParts(ps =>
          ps.map((p, i) => (i === index ? { ...p, sending: false, sentOk: false, error: e?.message || 'Error' } : p)),
        );
      }
    },
    [parts],
  );

  const resetAll = () => {
    setFile(null);
    setRowsCount(null);
    setHeaderPreview(null);
    setStatus('');
    setParts(prev => {
      prev.forEach(p => URL.revokeObjectURL(p.url));
      return [];
    });
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">CSV Splitter</h1>
        <p className="text-sm text-gray-600 mb-6">
          Upload a CSV, enter the number of agents, and split it. You can download each file separately, download a ZIP,
          or email a file to an agent. All parsing is done <span className="font-semibold">in your browser</span>.
        </p>

        <div
          onDrop={handleDrop}
          onDragOver={prevent}
          onDragEnter={prevent}
          className="border-2 border-dashed rounded-2xl p-6 mb-4 bg-white shadow-sm hover:shadow transition"
        >
          <label htmlFor="csv" className="block text-sm font-medium mb-2">
            CSV file
          </label>
          <input ref={inputRef} id="csv" type="file" accept=".csv,text/csv" onChange={onFileChange} className="w-full" />
          <p className="text-xs text-gray-500 mt-2">Tip: Drag & drop works too.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="sm:col-span-1">
            <label className="block text-sm font-medium mb-2">Number of agents</label>
            <input
              type="number"
              min={1}
              value={agents}
              onChange={(e) => setAgents(e.target.value)}
              className="w-full rounded-xl border p-2"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium mb-2">Options</label>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={includeBOM} onChange={(e) => setIncludeBOM(e.target.checked)} />
                Add UTF-8 BOM (Excel-friendly)
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={shuffleRows} onChange={(e) => setShuffleRows(e.target.checked)} />
                Shuffle rows before splitting
              </label>
            </div>
          </div>
        </div>

        {rowsCount !== null && (
          <div className="mb-4 text-sm bg-white rounded-xl border p-3">
            <div>
              <span className="font-semibold">Detected delimiter:</span> <code>{delimiter}</code>
            </div>
            <div>
              <span className="font-semibold">Records (excluding header):</span> {rowsCount}
            </div>
            {headerPreview && (
              <details className="mt-2">
                <summary className="cursor-pointer">Preview header & first row</summary>
                <div className="overflow-auto mt-2">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        {headerPreview[0].map((h, i) => (
                          <th key={i} className="border px-2 py-1 bg-gray-50 text-left">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {headerPreview[1].map((c, i) => (
                          <td key={i} className="border px-2 py-1">
                            {c}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>
        )}

        <div className="flex gap-3 mb-4">
          <button
            onClick={handleSplit}
            className="rounded-2xl cursor-pointer px-4 py-2 bg-black transition text-white font-medium hover:opacity-90"
            disabled={!file}
            aria-disabled={!file}
          >
            Split
          </button>

          <button
            onClick={handleDownloadAll}
            className="rounded-2xl cursor-pointer px-4 py-2 border hover:bg-gray-100 disabled:opacity-50"
            disabled={parts.length === 0}
          >
            Download All (ZIP)
          </button>

          <button
            onClick={resetAll}
            className="rounded-2xl cursor-pointer px-4 py-2 border hover:bg-black hover:text-white transition"
          >
            Reset
          </button>
        </div>

        {/* NEW: parts table/list with per-file download & email */}
        {parts.length > 0 && (
          <div className="bg-white border rounded-2xl p-4">
            <h2 className="font-semibold mb-3">Split Files</h2>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left px-3 py-2 border">File</th>
                    <th className="text-left px-3 py-2 border">Rows</th>
                    <th className="text-left px-3 py-2 border">Download</th>
                    <th className="text-left px-3 py-2 border">Email to</th>
                    <th className="text-left px-3 py-2 border">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p, idx) => (
                    <tr key={p.name}>
                      <td className="px-3 py-2 border">{p.name}</td>
                      <td className="px-3 py-2 border">{p.rowCount}</td>
                      <td className="px-3 py-2 border">
                        <a
                          href={p.url}
                          download={p.name}
                          className="inline-block px-2 py-1 rounded-lg border hover:bg-black hover:text-white transition-all ease-in-out"
                        >
                          Download
                        </a>
                      </td>
                      <td className="px-3 py-2 border">
                        <input
                          type="email"
                          placeholder="agent@example.com"
                          value={p.email ?? ''}
                          onChange={(e) =>
                            setParts(ps => ps.map((x, i) => (i === idx ? { ...x, email: e.target.value, error: null } : x)))
                          }
                          className="rounded-lg border p-2 w-64 max-w-full"
                        />
                        {p.error && <div className="text-xs text-red-600 mt-1">{p.error}</div>}
                        {p.sentOk && <div className="text-md text-green-700 font-medium mt-1">File has been Sent!</div>}
                      </td>
                      <td className="px-3 py-2 border">
                        <button
                          onClick={() => sendPart(idx)}
                          disabled={p.sending}
                          className="px-3 py-1 w-[6rem] cursor-pointer rounded-lg bg-black text-white hover:opacity-50 ease-in-out transition-all disabled:opacity-50"
                        >
                          {p.sending ? 'Sending…' : 'Send'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {status && <div className="mt-4 text-sm p-3 bg-white border rounded-xl">{status}</div>}
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */
async function guessDelimiter(file: File): Promise<string> {
  const sample = await file.slice(0, 64 * 1024).text();
  const candidates = [',', '\t', ';', '|'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const count = (sample.match(new RegExp(escapeRegex(d), 'g')) || []).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|\[\]\\]/g, '\\$&');
}
