"use client";

import { validityStatus } from "@/lib/pbg/validity";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatAmount, formatDate } from "@/lib/pbg/format";
import type { ColumnDef, ColumnKey } from "@/lib/pbg/pbg-columns";
import type { PbgFile, PbgRecord } from "@/lib/pbg/pbg-data";
import { toEditValue } from "@/lib/pbg/pbg-cell";
import {
  isFilterActive,
  type ColumnFilter,
  type FilterState,
} from "@/lib/pbg/pbg-filter";
import { ColumnFilterPopover } from "@/components/pbg/column-filter";
import { SupplyHistoryInline } from "@/components/pbg/supply-history-inline";
import { Popover } from "@/components/pbg/popover";
import { ChevronDownIcon, FunnelIcon } from "@/components/pbg/icons";

const ROW_NUM_WIDTH = 44;
const HEADER_ROW_HEIGHT = 44;
const CELL_PAD_Y = 14;
const MIN_COL_WIDTH = 90;

type Pos = { r: number; c: number };
type MoveDir = "up" | "down" | "left" | "right" | null;
type SortState = { key: ColumnKey; dir: "asc" | "desc" } | null;

function StatusBadge({ status }: { status: string | null }) {
  const value = (status ?? "").trim();
  const key = value.toLowerCase();

  let classes = "bg-amber-100 text-amber-700 ring-amber-200";
  if (key === "running") classes = "bg-emerald-100 text-emerald-700 ring-emerald-200";
  else if (key === "expired") classes = "bg-rose-100 text-rose-700 ring-rose-200";
  else if (key === "closed") classes = "bg-slate-100 text-slate-600 ring-slate-200";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${classes}`}
    >
      {value || "—"}
    </span>
  );
}

function MailTriggerBadge({ value }: { value: string | null }) {
  const current = (value ?? "HOLD").trim().toUpperCase();
  const isContinue = current === "CONTINUE";

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        isContinue
          ? "bg-emerald-100 text-emerald-700 ring-emerald-200"
          : "bg-slate-100 text-slate-600 ring-slate-200"
      }`}
    >
      {current || "HOLD"}
    </span>
  );
}

function renderCell(
  def: ColumnDef,
  record: PbgRecord,
  historyExpanded: boolean,
  onToggleHistory: (id: string) => void,
) {
  switch (def.key) {
    case "poDate":
      return formatDate(record.poDate);
    case "bgDate":
      return formatDate(record.bgDate);
    case "expiryDate":
      return formatDate(record.expiryDate);
    case "claimDate":
      return formatDate(record.claimDate);
    case "lastSupplyDate":
      return formatDate(record.lastSupplyDate);
    case "extendedValidity":
      return formatDate(record.extendedValidity);
    case "bgAmtFc":
      return formatAmount(record.bgAmtFc);
    case "marginAmount":
      return formatAmount(record.marginAmount);
    case "marginPct":
      return record.marginPct ?? "—";
    case "status":
      return <StatusBadge status={record.status} />;
    case "mailTrigger":
      return <MailTriggerBadge value={record.mailTrigger} />;
    case "poNumber": {
      const value = record.poNumber;
      if (!value) return "—";
      return (
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate">{value}</span>
          <button
            type="button"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onToggleHistory(record.id);
            }}
            title={historyExpanded ? "Hide supply history" : "Show supply history"}
            aria-label={
              historyExpanded ? "Hide supply history" : "Show supply history"
            }
            aria-expanded={historyExpanded}
            className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border shadow-sm transition ${
              historyExpanded
                ? "border-indigo-300 bg-indigo-100 text-indigo-600"
                : "border-slate-300 bg-white text-slate-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
            }`}
          >
            <ChevronDownIcon
              className={`h-4 w-4 transition-transform duration-200 ${
                historyExpanded ? "rotate-180" : ""
              }`}
            />
          </button>
        </span>
      );
    }
    default: {
      const value = record[def.key];
      return value === null || value === undefined || value === ""
        ? "—"
        : String(value);
    }
  }
}

function editorKind(def: ColumnDef): "status" | "date" | "number" | "text" {
  if (def.key === "status" || def.key === "mailTrigger") return "status";
  if (def.type === "date") return "date";
  if (def.type === "number" || def.key === "marginPct") return "number";
  return "text";
}

function CellEditor({
  def,
  initial,
  statusOptions,
  onCommit,
  onCancel,
}: {
  def: ColumnDef;
  initial: string;
  statusOptions: string[];
  onCommit: (value: string, dir: MoveDir) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = inputRef.current ?? selectRef.current;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) {
      try {
        el.select();
      } catch {
        /* date inputs may not support select */
      }
    }
  }, []);

  function finish(dir: MoveDir) {
    if (done.current) return;
    done.current = true;
    onCommit(value, dir);
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finish("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      finish(event.shiftKey ? "left" : "right");
    } else if (event.key === "Escape") {
      event.preventDefault();
      done.current = true;
      onCancel();
    }
  }

  const kind = editorKind(def);
  const baseClass =
    "absolute inset-0 z-30 h-full w-full border-2 border-indigo-500 bg-white px-2 text-sm text-black outline-none";

  if (kind === "status") {
    const options =
      def.options && def.options.length > 0 ? def.options : statusOptions;
    return (
      <select
        ref={selectRef}
        value={options.includes(value) ? value : options[0]}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => finish(null)}
        className={baseClass}
      >
        {value && !options.includes(value) && (
          <option value={value}>{value}</option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (kind === "text" && def.options && def.options.length > 0) {
    const listId = `${def.key}-options`;
    return (
      <>
        <input
          ref={inputRef}
          type="text"
          value={value}
          list={listId}
          autoComplete="off"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => finish(null)}
          className={baseClass}
        />
        <datalist id={listId}>
          {def.options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      </>
    );
  }

  return (
    <input
      ref={inputRef}
      type={kind === "date" ? "date" : kind === "number" ? "number" : "text"}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => finish(null)}
      className={baseClass}
    />
  );
}

function BankGuaranteeCell({
  id,
  files,
  onUpload,
  onRemove,
}: {
  id: string;
  files: PbgFile[] | null;
  onUpload: (id: string, files: File[]) => Promise<void>;
  onRemove: (id: string, url: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const list = files ?? [];

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await onUpload(id, selected);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-col gap-1.5"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {list.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {list.map((file) => (
            <span
              key={file.url}
              className="inline-flex max-w-full items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[11px]"
            >
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                title={file.name}
                className="max-w-[9rem] truncate font-medium text-indigo-600 hover:underline"
              >
                {file.name}
              </a>
              <button
                type="button"
                onClick={() => void onRemove(id, file.url)}
                aria-label={`Remove ${file.name}`}
                className="text-slate-400 hover:text-rose-600"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex w-fit items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? "Uploading…" : "+ Upload"}
      </button>
    </div>
  );
}

function DocLinkIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  );
}

function LinksCell({ links }: { links: string[] | null }) {
  const list = links ?? [];
  if (list.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div
      className="flex flex-wrap gap-1.5"
      onMouseDown={(event) => event.stopPropagation()}
    >
      {list.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          title={url}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-100 hover:text-indigo-800"
        >
          <DocLinkIcon />
          {`Order ${index + 1}`}
        </a>
      ))}
    </div>
  );
}

export function PbgGrid({
  rows,
  columns,
  filters,
  onSetFilter,
  distinctMap,
  statusOptions,
  saving,
  onCommit,
  onUploadBankGuarantee,
  onRemoveBankGuarantee,
}: {
  rows: PbgRecord[];
  columns: ColumnDef[];
  filters: FilterState;
  onSetFilter: (key: ColumnKey, value: ColumnFilter | undefined) => void;
  distinctMap: Map<ColumnKey, string[]>;
  statusOptions: string[];
  saving: Set<string>;
  onCommit: (id: string, key: ColumnKey, raw: string) => void;
  onUploadBankGuarantee: (id: string, files: File[]) => Promise<void>;
  onRemoveBankGuarantee: (id: string, url: string) => Promise<void>;
}) {
  const [sort, setSort] = useState<SortState>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<{ anchor: Pos; active: Pos }>({
    anchor: { r: 0, c: 0 },
    active: { r: 0, c: 0 },
  });
  const [editing, setEditing] = useState<{ pos: Pos; initial: string } | null>(
    null,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  const widthOf = (key: ColumnKey, fallback: number) => widths[key] ?? fallback;

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const def = columns.find((c) => c.key === sort.key);
    if (!def) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (def.type === "number") return (Number(av) - Number(bv)) * factor;
      return (
        String(av).localeCompare(String(bv), undefined, {
          numeric: true,
          sensitivity: "base",
        }) * factor
      );
    });
  }, [rows, sort, columns]);

  const maxR = Math.max(0, sortedRows.length - 1);
  const maxC = Math.max(0, columns.length - 1);
  const active: Pos = {
    r: Math.min(sel.active.r, maxR),
    c: Math.min(sel.active.c, maxC),
  };
  const anchor: Pos = {
    r: Math.min(sel.anchor.r, maxR),
    c: Math.min(sel.anchor.c, maxC),
  };
  const range = {
    rMin: Math.min(anchor.r, active.r),
    rMax: Math.max(anchor.r, active.r),
    cMin: Math.min(anchor.c, active.c),
    cMax: Math.max(anchor.c, active.c),
  };

  function moveTo(r: number, c: number, extend: boolean) {
    const rr = Math.max(0, Math.min(r, maxR));
    const cc = Math.max(0, Math.min(c, maxC));
    setSel((prev) =>
      extend
        ? { ...prev, active: { r: rr, c: cc } }
        : { anchor: { r: rr, c: cc }, active: { r: rr, c: cc } },
    );
  }

  function moveBy(dir: MoveDir) {
    if (!dir) return;
    const delta: Record<Exclude<MoveDir, null>, [number, number]> = {
      up: [-1, 0],
      down: [1, 0],
      left: [0, -1],
      right: [0, 1],
    };
    const [dr, dc] = delta[dir];
    moveTo(active.r + dr, active.c + dc, false);
  }

  function startEdit(pos: Pos, initial?: string) {
    const row = sortedRows[pos.r];
    const col = columns[pos.c];
    if (!row || !col) return;
    if (col.type === "files" || col.readonly) return;
    setEditing({ pos, initial: initial ?? toEditValue(row, col.key) });
  }

  function commitEdit(value: string, dir: MoveDir) {
    if (!editing) return;
    const row = sortedRows[editing.pos.r];
    const col = columns[editing.pos.c];
    setEditing(null);
    if (row && col) onCommit(row.id, col.key, value);
    moveBy(dir);
  }

  function commitEmpty(pos: Pos) {
    const row = sortedRows[pos.r];
    const col = columns[pos.c];
    if (row && col) onCommit(row.id, col.key, "");
  }

  function toggleHistory(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSort(key: ColumnKey) {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function copyRange() {
    const lines: string[] = [];
    for (let r = range.rMin; r <= range.rMax; r += 1) {
      const row = sortedRows[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = range.cMin; c <= range.cMax; c += 1) {
        const col = columns[c];
        if (!col) continue;
        const value = row[col.key];
        cells.push(value === null || value === undefined ? "" : String(value));
      }
      lines.push(cells.join("\t"));
    }
    const text = lines.join("\n");
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (editing || sortedRows.length === 0 || columns.length === 0) return;
    const extend = event.shiftKey;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      copyRange();
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveTo(active.r - 1, active.c, extend);
        return;
      case "ArrowDown":
        event.preventDefault();
        moveTo(active.r + 1, active.c, extend);
        return;
      case "ArrowLeft":
        event.preventDefault();
        moveTo(active.r, active.c - 1, extend);
        return;
      case "ArrowRight":
        event.preventDefault();
        moveTo(active.r, active.c + 1, extend);
        return;
      case "Tab":
        event.preventDefault();
        moveTo(active.r, active.c + (event.shiftKey ? -1 : 1), false);
        return;
      case "Home":
        event.preventDefault();
        moveTo(event.ctrlKey ? 0 : active.r, 0, false);
        return;
      case "End":
        event.preventDefault();
        moveTo(active.r, maxC, false);
        return;
      case "Enter":
      case "F2":
        event.preventDefault();
        startEdit(active);
        return;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        commitEmpty(active);
        return;
      default:
        break;
    }

    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      startEdit(active, event.key);
    }
  }

  function onResizeStart(
    event: ReactPointerEvent<HTMLSpanElement>,
    key: ColumnKey,
    fallback: number,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(key, fallback);

    const onMove = (e: PointerEvent) => {
      const next = Math.max(MIN_COL_WIDTH, startWidth + (e.clientX - startX));
      setWidths((prev) => ({ ...prev, [key]: next }));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const totalWidth =
    ROW_NUM_WIDTH +
    columns.reduce((sum, col) => sum + widthOf(col.key, col.width), 0);

  const isSaving = (id: string, key: ColumnKey) => saving.has(`${id}:${key}`);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="scrollbar-thin min-h-0 flex-1 overflow-auto rounded-b-xl outline-none"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-left text-sm text-black"
        style={{ minWidth: totalWidth }}
      >
        <colgroup>
          <col style={{ width: ROW_NUM_WIDTH }} />
          {columns.map((col) => (
            <col key={col.key} style={{ width: widthOf(col.key, col.width) }} />
          ))}
        </colgroup>

        <thead>
          <tr>
            <th
              className="sticky left-0 top-0 z-40 border-b border-r border-slate-300 bg-slate-100 px-1 text-center text-xs font-semibold leading-none text-black"
              style={{ height: HEADER_ROW_HEIGHT }}
            >
              #
            </th>
            {columns.map((col, index) => {
              const filterActive = isFilterActive(filters[col.key]);
              return (
                <th
                  key={col.key}
                  className={`sticky top-0 z-30 overflow-hidden whitespace-nowrap border-b border-r border-slate-300 ${
                    active.c === index
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-black"
                  } ${index === 0 ? "z-40" : ""}`}
                  style={{
                    height: HEADER_ROW_HEIGHT,
                    left: index === 0 ? ROW_NUM_WIDTH : undefined,
                  }}
                >
                  <div className="flex h-full items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide"
                      title="Sort"
                    >
                      <span className="truncate">{col.label}</span>
                      {sort?.key === col.key && (
                        <span className="shrink-0 text-indigo-600">
                          {sort.dir === "asc" ? "▲" : "▼"}
                        </span>
                      )}
                    </button>
                    {col.type !== "files" && col.type !== "links" && (
                      <Popover
                        ariaLabel={`Filter ${col.label}`}
                        trigger={<FunnelIcon />}
                        triggerClassName={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                          filterActive
                            ? "bg-indigo-100 text-indigo-600"
                            : "text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                        }`}
                      >
                        {() => (
                          <ColumnFilterPopover
                            def={col}
                            filter={filters[col.key]}
                            distinct={distinctMap.get(col.key) ?? []}
                            onChange={(value) => onSetFilter(col.key, value)}
                          />
                        )}
                      </Popover>
                    )}
                  </div>
                  <span
                    onPointerDown={(event) =>
                      onResizeStart(event, col.key, col.width)
                    }
                    className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none hover:bg-indigo-400"
                  />
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {sortedRows.map((row, r) => {
            // Past its contract validity date, or inside the 30-day window.
            const status = validityStatus(row.extendedValidity);
            const expiryTone =
              status === "expired"
                ? "bg-red-100"
                : status === "expiring"
                  ? "bg-amber-100"
                  : null;
            return (
            <Fragment key={row.id}>
            <tr
              className="group"
              title={
                status === "expired"
                  ? `PBG validity expired on ${row.extendedValidity}`
                  : status === "expiring"
                    ? `PBG validity expires on ${row.extendedValidity}`
                    : undefined
              }
            >
              <th
                className={`sticky left-0 z-20 border-b border-r border-slate-300 px-1 text-center text-xs font-medium tabular-nums ${
                  active.r === r
                    ? "bg-indigo-100 text-indigo-700"
                    : "bg-slate-100 text-black"
                }`}
              >
                {r + 1}
              </th>
              {columns.map((col, c) => {
                const isActive = active.r === r && active.c === c;
                const inRange =
                  r >= range.rMin &&
                  r <= range.rMax &&
                  c >= range.cMin &&
                  c <= range.cMax;
                const editingHere =
                  editing?.pos.r === r && editing?.pos.c === c;
                const savingHere = isSaving(row.id, col.key);
                const sticky = c === 0;
                const zebra = r % 2 === 1;
                // Selection still wins: a tint that hid the current range would
                // make the grid harder to drive than the warning is worth.
                const rowBg =
                  inRange && !isActive
                    ? "bg-indigo-50"
                    : (expiryTone ?? (zebra ? "bg-slate-50/70" : "bg-white"));
                // Sticky cells must stay fully opaque, otherwise the columns
                // scrolling behind them bleed through.
                const stickyBg = isActive
                  ? "bg-indigo-100"
                  : inRange
                    ? "bg-indigo-50"
                    : zebra
                      ? "bg-slate-50"
                      : "bg-white";
                const hoverBg = sticky
                  ? "group-hover:bg-indigo-100"
                  : "group-hover:bg-indigo-50/60";

                return (
                  <td
                    key={col.key}
                    onMouseDown={(event) => {
                      if (editingHere) return;
                      moveTo(r, c, event.shiftKey);
                      containerRef.current?.focus();
                    }}
                    onClick={() => {
                      if (editingHere) return;
                      if (col.options && col.options.length > 0) startEdit({ r, c });
                    }}
                    onDoubleClick={() => startEdit({ r, c })}
                    style={{
                      paddingTop: CELL_PAD_Y,
                      paddingBottom: CELL_PAD_Y,
                      left: sticky ? ROW_NUM_WIDTH : undefined,
                    }}
                    className={`relative overflow-hidden border-b border-r border-slate-200 px-3 align-middle ${
                      col.type === "number"
                        ? "text-right tabular-nums"
                        : col.key === "poNumber" || col.key === "bgNo"
                          ? "font-mono text-[13px]"
                          : ""
                    } ${isActive ? "ring-2 ring-inset ring-indigo-500" : ""} ${
                      sticky ? `sticky z-20 ${stickyBg}` : rowBg
                    } ${hoverBg} ${savingHere ? "opacity-60" : ""}`}
                  >
                    {editingHere ? (
                      <CellEditor
                        def={col}
                        initial={editing?.initial ?? ""}
                        statusOptions={statusOptions}
                        onCommit={commitEdit}
                        onCancel={() => setEditing(null)}
                      />
                    ) : col.type === "files" ? (
                      <BankGuaranteeCell
                        id={row.id}
                        files={row.bankGuarantee}
                        onUpload={onUploadBankGuarantee}
                        onRemove={onRemoveBankGuarantee}
                      />
                    ) : col.type === "links" ? (
                      <LinksCell links={row.orderList} />
                    ) : (
                      renderCell(col, row, expanded.has(row.id), toggleHistory)
                    )}
                  </td>
                );
              })}
            </tr>
            {expanded.has(row.id) && row.poNumber && (
              <tr className="bg-slate-50/60">
                <td
                  colSpan={columns.length + 1}
                  className="border-b border-slate-200 p-2"
                >
                  <SupplyHistoryInline
                    key={row.poNumber}
                    poNumber={row.poNumber}
                  />
                </td>
              </tr>
            )}
            </Fragment>
            );
          })}
        </tbody>
      </table>

      {sortedRows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <p className="text-sm font-medium text-black">No records match</p>
          <p className="max-w-sm text-xs text-slate-500">
            Try adjusting or clearing your filters.
          </p>
        </div>
      )}
    </div>
  );
}
