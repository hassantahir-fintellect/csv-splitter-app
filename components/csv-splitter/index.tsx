/* eslint-disable @typescript-eslint/no-explicit-any */
// components/CsvSplitterApp.tsx
'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export default function CsvSplitterComponent() {
  const [file, setFile] = useState<File | null>(null);
  const [agents, setAgents] = useState<string>('2');
  const [status, setStatus] = useState<string>('');
  const [rowsCount, setRowsCount] = useState<number | null>(null);
  const [headerPreview, setHeaderPreview] = useState<string[][] | null>(null);
  const [delimiter, setDelimiter] = useState<string>(',');
  const [includeBOM, setIncludeBOM] = useState<boolean>(true);
  const [shuffleRows, setShuffleRows] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const baseName = useMemo(() => {
    if (!file?.name) return 'split';
    const dot = file.name.lastIndexOf('.');
    return dot === -1 ? file.name : file.name.slice(0, dot);
  }, [file]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setRowsCount(null);
    setHeaderPreview(null);
    setStatus('');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) {
      setFile(f);
      if (inputRef.current) inputRef.current.files = e.dataTransfer.files as any;
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

  const handleSplit = useCallback(async () => {
    try {
      if (!file) throw new Error('Please choose a CSV file.');
      const parts = Number(agents);
      if (!Number.isInteger(parts) || parts <= 0) throw new Error('Agents must be a positive integer.');

      const { header, rows } = await parseCsv();
      setStatus(`Splitting ${rows.length} records into ${parts} part(s)…`);

      const chunks = splitEvenly(rows, parts);
      const zip = new JSZip();
      chunks.forEach((chunk, idx) => {
        const blob = buildCsv(header, chunk);
        zip.file(`${baseName}-part${idx + 1}.csv`, blob);
      });

      setStatus('Packaging ZIP…');
      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
      saveAs(zipBlob, `${baseName}-split-${parts}.zip`);
      setStatus('Done! ZIP downloaded.');
    } catch (err: any) {
      console.error(err);
      setStatus(err.message || String(err));
    }
  }, [file, agents, baseName, parseCsv, includeBOM, delimiter]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">CSV Splitter</h1>
        <p className="text-sm text-gray-600 mb-6">
          Upload a CSV, enter the number of agents, and download a ZIP of evenly split files. All processing is done{' '}
          <span className="font-semibold">in your browser</span>.
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
          <p className="text-xs text-gray-500 mt-2">Tip: You can also drag & drop a file here.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Number of agents</label>
            <input
              type="number"
              min={1}
              value={agents}
              onChange={(e) => setAgents(e.target.value)}
              className="w-full rounded-xl border p-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Options</label>
            <div className="flex flex-col gap-2 text-sm">
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

        <div className="flex gap-3">
          <button
            onClick={handleSplit}
            className="rounded-2xl cursor-pointer px-4 py-2 bg-black transition-all ease-in-out text-white font-medium hover:opacity-40"
            disabled={!file}
            aria-disabled={!file}
          >
            Split & Download ZIP
          </button>
          <button
            onClick={() => {
              setFile(null);
              setRowsCount(null);
              setHeaderPreview(null);
              setStatus('');
              if (inputRef.current) inputRef.current.value = '';
            }}
            className="rounded-2xl cursor-pointer hover:bg-black hover:text-white transition-all ease-in-out px-4 py-2 border"
          >
            Reset
          </button>
        </div>

        {status && <div className="mt-4 text-sm p-3 bg-white border rounded-xl">{status}</div>}

 
      </div>
    </div>
  );
}

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
