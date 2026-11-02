"use client";

import { useState, useMemo, useRef, useCallback, useEffect, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ArrowUpDown, Search, RotateCcw, X, Download, Files, FileText, ExternalLink, Copy, Upload, Eye, Paperclip, Trash2, ImageIcon, Check, Highlighter, AlertTriangle, Loader2 } from "lucide-react";
import GMDUpdateStatusBadge from "./GMDUpdateStatusBadge";
import { looseIncludes, squish } from "../lib/squish";
import type { ContractReviewImage } from "../lib/types";
import {
  STATUS_COLUMNS,
  NUMERIC_COLUMNS,
  COL_INDEX_TO_DB_FIELD,
  isDateHeader,
} from "../lib/sheet-columns";
import {
  FLOW_HAS_VALUE,
  FLOW_NO_VALUE,
  FLOW_ZERO,
  FLOW_NON_ZERO,
  cellHasValue,
  cellIsZero,
} from "../lib/flowFilter";
import {
  BOM_ID_COLUMN,
  BOM_ID_FILTER_VALUES,
  getBomIdCategory,
} from "../lib/bomCategory";
import { parseGmdDate, CANONICAL_DATE } from "@gmd/ui/lib/dateParse";
import { format } from "date-fns";
import { cellCompare, compareDates } from "../lib/tableSort";
import DebouncedSearchInput from "./DebouncedSearchInput";
import Pagination from "./Pagination";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@gmd/ui/components/dialog";
import { Button } from "@gmd/ui/components/button";
import DatePicker from "@gmd/ui/components/date-picker";

function isUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderLinksCell(display: string) {
  const parts = display
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const linkParts = parts.filter(isUrl);
  if (linkParts.length === 0) return null;
  // Mix of links and non-links: render links as anchors, others as text, comma separated
  return (
    <span className="block break-all" title={display}>
      {parts.map((part, idx) => (
        <span key={`${part}-${idx}`}>
          {isUrl(part) ? (
            <a
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200"
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          ) : (
            <span>{part}</span>
          )}
          {idx < parts.length - 1 ? ", " : ""}
        </span>
      ))}
    </span>
  );
}

function OrderListCell({
  display,
  poNo,
  iconOnly,
  heading,
}: {
  display: string;
  poNo?: string;
  iconOnly?: boolean;
  heading?: string;
}) {
  const links = useMemo(
    () => display.split(",").map((s) => s.trim()).filter(Boolean).filter(isUrl),
    [display]
  );
  const [open, setOpen] = useState(false);
  if (links.length === 0) {
    if (iconOnly) return null;
    return <span className="truncate block text-muted-foreground" title={display}>—</span>;
  }
  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Failed to copy");
    }
  };
  return (
    <>
      <Button
        variant="outline"
        size="xs"
        className={
          iconOnly
            ? "h-6 shrink-0 px-1.5 font-semibold border-border bg-card hover:bg-muted/60 text-foreground"
            : "h-6 text-[11px] gap-1.5 px-2 font-semibold border-border bg-card hover:bg-muted/60 text-foreground"
        }
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={
          links.length === 1
            ? `View ${links.length} file`
            : `View ${links.length} files`
        }
        title={links.join(", ")}
      >
        <Files size={12} className="shrink-0" />
        {!iconOnly &&
          (links.length === 1 ? "View File" : `View Files (${links.length})`)}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-130 p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border bg-muted">
            <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <FileText size={16} className="text-foreground/70" />
              {heading
                ? `Attachments — ${heading}`
                : poNo
                  ? `Attachments — ${poNo}`
                  : `Attachments`}
              <span className="ml-1 text-xs font-semibold text-foreground/60">({links.length})</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {links.length === 1 ? "1 file linked to this PO" : `${links.length} files linked to this PO`} from GMD Clientwise
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {links.map((url, idx) => {
              const shortId = (() => {
                try {
                  const u = new URL(url);
                  const id = u.searchParams.get("id") || u.pathname.split("/").pop() || url;
                  return id.length > 18 ? id.slice(0, 18) + "…" : id;
                } catch {
                  return url.length > 32 ? url.slice(0, 32) + "…" : url;
                }
              })();
              return (
                <div key={`${url}-${idx}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors">
                  <div className="shrink-0 w-8 h-8 rounded bg-muted border border-border flex items-center justify-center text-foreground/70">
                    <FileText size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground">File {idx + 1}</div>
                    <div className="text-[11px] text-muted-foreground truncate" title={url}>{shortId}</div>
                    <div className="text-[10px] text-foreground/50 truncate" title={url}>{url}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="xs"
                      className="h-7 px-2 gap-1 text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(url);
                      }}
                      title="Copy link"
                    >
                      <Copy size={12} /> Copy
                    </Button>
                    <Button
                      variant="default"
                      size="xs"
                      className="h-7 px-2.5 gap-1 text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(url, "_blank", "noopener,noreferrer");
                      }}
                      title="Open file"
                    >
                      <ExternalLink size={12} /> Open
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ItemImageCell({
  images,
  code,
  drawingUrl,
}: {
  images: ContractReviewImage[];
  code: string;
  drawingUrl?: string;
}) {
  const [open, setOpen] = useState(false);
  const drawingHref = drawingUrl && isUrl(drawingUrl) ? drawingUrl : "";
  const hasDrawing = drawingHref !== "";
  if (images.length === 0 && !hasDrawing) {
    return (
      <span className="truncate block" title={code}>
        {code || "—"}
      </span>
    );
  }
  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Failed to copy");
    }
  };
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="truncate" title={code}>
        {code}
      </span>
      {images.length > 0 && (
        <Button
          variant="outline"
          size="xs"
          className="h-6 shrink-0 px-1.5 font-semibold border-border bg-card hover:bg-muted/60 text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={`View ${images.length} image${images.length === 1 ? "" : "s"} for ${code}`}
          title={`${images.length} image${images.length === 1 ? "" : "s"}\n${images
            .map(
              (i) =>
                `${i.itemType ?? ""} / ${i.operationType ?? ""} / ${i.rmType ?? ""}`,
            )
            .join("\n")}`}
        >
          <ImageIcon size={12} className="shrink-0" />
        </Button>
      )}
      {hasDrawing && (
        <Button
          variant="outline"
          size="xs"
          className="h-6 shrink-0 px-1.5 font-semibold border-border bg-card hover:bg-muted/60 text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            window.open(drawingHref, "_blank", "noopener,noreferrer");
          }}
          aria-label={`View uploaded drawing for ${code}`}
          title="View uploaded drawing"
        >
          <FileText size={12} className="shrink-0" />
        </Button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-140 p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border bg-muted">
            <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <ImageIcon size={16} className="text-foreground/70" />
              Images — {code}
              <span className="ml-1 text-xs font-semibold text-foreground/60">
                ({images.length})
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Item images linked to this item code from Quotation Process
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-border">
            {images.map((image, idx) => {
              const href =
                image.url ??
                (image.driveFileId
                  ? `https://drive.google.com/file/d/${image.driveFileId}/view`
                  : null);
              const combo = [
                image.itemType,
                image.operationType,
                image.rmType,
              ]
                .map((p) => (p ?? "").trim())
                .filter(Boolean)
                .join(" / ");
              return (
                <div
                  key={`${image.imageKey}-${idx}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/60 transition-colors"
                >
                  <div className="shrink-0 w-10 h-10 rounded border border-border bg-muted overflow-hidden flex items-center justify-center">
                    {image.driveFileId ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`https://drive.google.com/thumbnail?id=${image.driveFileId}&sz=w400`}
                        alt={combo || "item image"}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <ImageIcon size={14} className="text-foreground/50" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs font-semibold text-foreground truncate"
                      title={combo}
                    >
                      {combo || "Unlabelled image"}
                    </div>
                    <div
                      className="text-[10px] text-foreground/50 truncate"
                      title={image.imageKey}
                    >
                      {image.imageKey}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {href ? (
                      <>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="h-7 px-2 gap-1 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopy(href);
                          }}
                          title="Copy link"
                        >
                          <Copy size={12} /> Copy
                        </Button>
                        <Button
                          variant="default"
                          size="xs"
                          className="h-7 px-2.5 gap-1 text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(href, "_blank", "noopener,noreferrer");
                          }}
                          title="Open in Drive"
                        >
                          <ExternalLink size={12} /> Open
                        </Button>
                      </>
                    ) : (
                      <span className="text-[11px] italic text-muted-foreground">
                        No link
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttachmentCell({
  url,
  onUpload,
  onClear,
  accept,
  verdict,
  onSetVerdict,
}: {
  url: string;
  /** Omit to make the cell view-only (no upload / replace). */
  onUpload?: (file: File) => void;
  /** Omit to hide the remove button. */
  onClear?: () => void;
  accept?: string;
  verdict?: string | null;
  onSetVerdict?: (verdict: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const isPdf = /\.pdf($|\?)/i.test(url);

  const buttonClass =
    "flex items-center gap-1 px-1.5 py-1 text-[10px] font-semibold rounded border cursor-pointer transition-colors";

  const hasVerdict = onSetVerdict != null;
  const verdictDisabled = hasVerdict && !url;

  const verdictBoxClass = (active: boolean, tone: "emerald" | "rose") => {
    if (verdictDisabled) {
      return "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-border bg-muted text-muted-foreground/60 cursor-not-allowed";
    }
    if (active) {
      return tone === "emerald"
        ? "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-emerald-500 bg-emerald-500 dark:bg-emerald-500/80 text-white cursor-pointer transition-colors hover:bg-emerald-600 dark:hover:bg-emerald-500"
        : "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-rose-500 bg-rose-500 dark:bg-rose-500/80 text-white cursor-pointer transition-colors hover:bg-rose-600 dark:hover:bg-rose-500";
    }
    return tone === "emerald"
      ? "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-emerald-200 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 cursor-pointer transition-colors hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
      : "flex h-[22px] w-[22px] items-center justify-center rounded-[4px] border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-300 cursor-pointer transition-colors hover:bg-rose-100 dark:hover:bg-rose-500/20";
  };

  return (
    <div className="flex flex-col items-center justify-center gap-1">
      <div className="flex items-center justify-center gap-1">
      <input
        ref={fileRef}
        type="file"
        accept={accept ?? ".pdf,image/png,image/jpeg,image/webp"}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload?.(file);
          e.target.value = "";
        }}
      />
      {url ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
            className={`${buttonClass} border-border bg-card text-foreground hover:bg-muted/60`}
            title="Preview attachment"
          >
            <Eye size={12} />
            Preview
          </button>
          {onUpload && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
            className={`${buttonClass} border-border bg-card text-foreground/70 hover:bg-muted/60`}
            title="Replace attachment"
          >
            <Upload size={11} />
          </button>
          )}
          {onClear && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className={`${buttonClass} border-rose-200 dark:border-rose-500/25 bg-card text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20`}
            title="Remove attachment"
          >
            <Trash2 size={11} />
          </button>
          )}
        </>
      ) : onUpload ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileRef.current?.click();
          }}
          className={`${buttonClass} border-border bg-card text-foreground hover:bg-muted/60`}
          title="Upload PDF or image"
        >
          <Paperclip size={12} />
          Upload
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-180 p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-3 border-b border-border bg-muted">
            <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <FileText size={16} className="text-foreground/70" />
              Attachment Preview
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {isPdf ? "PDF document" : "Image"} stored in the S3 bucket
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-auto bg-muted">
            {isPdf ? (
              <iframe
                src={url}
                className="w-full h-[65vh]"
                title="Attachment preview"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt="Attachment preview"
                className="mx-auto max-h-[65vh] object-contain"
              />
            )}
          </div>
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            <Button
              variant="ghost"
              size="xs"
              className="h-7 px-2 gap-1 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(url);
                toast.success("Link copied");
              }}
            >
              <Copy size={12} /> Copy link
            </Button>
            <Button
              variant="default"
              size="xs"
              className="h-7 px-2.5 gap-1 text-[11px]"
              onClick={(e) => {
                e.stopPropagation();
                window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink size={12} /> Open
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </div>
      {hasVerdict ? (
        <div className="flex items-center justify-center gap-1.5">
          <button
            type="button"
            title={
              verdictDisabled
                ? "Upload a drawing first"
                : verdict === "CORRECT"
                  ? "Marked correct - click to clear"
                  : "Mark drawing as correct"
            }
            aria-label="Mark drawing as correct"
            aria-pressed={!verdictDisabled && verdict === "CORRECT"}
            disabled={verdictDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onSetVerdict(verdict === "CORRECT" ? null : "CORRECT");
            }}
            className={verdictBoxClass(verdict === "CORRECT", "emerald")}
          >
            <Check size={13} strokeWidth={3} />
          </button>
          <button
            type="button"
            title={
              verdictDisabled
                ? "Upload a drawing first"
                : verdict === "WRONG"
                  ? "Marked wrong - click to clear"
                  : "Mark drawing as wrong"
            }
            aria-label="Mark drawing as wrong"
            aria-pressed={!verdictDisabled && verdict === "WRONG"}
            disabled={verdictDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onSetVerdict(verdict === "WRONG" ? null : "WRONG");
            }}
            className={verdictBoxClass(verdict === "WRONG", "rose")}
          >
            <X size={13} strokeWidth={3} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

// Date parsing lives in lib/gmd_lib/dateParse.ts so this table, the Contract Review
// page and the DatePicker cannot drift apart. See that file for why a bare numeric
// string must never be treated as a date.
function parseDate(str: string): Date | null {
  return parseGmdDate(str);
}

const EMPTY_DATE_RANGES: Record<
  string,
  { from: string; to: string; blank?: boolean }
> = {};

const EMPTY_BATCH_FILTERS: Record<string, boolean> = {};

// Filter option labels for the boolean marking column (raw values stay
// "true"/"false" so filtering keeps working).
const MAJOR_MINOR_FILTER_LABELS: Record<string, string> = { true: "MAJOR", false: "MINOR" };

/**
 * Columns that identify "the same physical item" for the ERP-duplicate detector.
 * Two rows agreeing on all of these but holding different ERP codes are the same
 * stock counted twice, so they are tinted yellow. Header names (not DB fields)
 * because `COL_INDEX_TO_DB_FIELD` in this shared component is the raw-material map.
 */
const DUPLICATE_KEY_HEADERS = [
  "location",
  "L2-VALVE TYPE",
  "Dia",
  "L7-DIMENSION",
  "L7-PN",
  "L4-COMPONENT",
  "L5- MATERIAL",
  "L6-STD",
  "L8 -ITEM CATEGORY",
];

function cellEq(rowA: unknown[], rowB: unknown[], colIdx: number): boolean {
  return String(rowA[colIdx] ?? "") === String(rowB[colIdx] ?? "");
}

export interface ColumnGroupChild {
  header: string;
  /** Short caption shown next to the field inside the collapsed cell. */
  label?: string;
  /**
   * Render as a bare wrapped line instead of a captioned, bordered box: no
   * `label` caption and no border/padding chrome. The header still shows up as a
   * tooltip. Used where the parent group caption already names the two fields
   * and repeating them per row is noise.
   */
  plain?: boolean;
}

export interface ColumnGroup {
  /** Parent header caption. */
  label: string;
  /** Rendered width of the single collapsed column. */
  width?: number;
  children: ColumnGroupChild[];
}

/** A rendered column: either a standalone header, or a collapsed group. */
interface ResolvedCol {
  header: string;
  idx: number;
  group?: ColumnGroup & { children: ColumnGroupChild[] };
}

const DEFAULT_GROUP_WIDTH = 300;
const FROZEN_VISIBLE_COLUMNS = 2;

/**
 * Class string for a wrapped text cell that must not stretch its row: content
 * wraps, the box is capped, and anything past the cap scrolls inside the cell.
 *
 * `cell-scrollable` (app/globals.css) keeps the scrollbar 4px wide — with ~60
 * columns on screen a default-width scrollbar per overflowing cell would swamp
 * the grid. `max-h-16` is 64px, which at text-xs/leading-normal (18px a line)
 * shows 3 full lines before the cell starts scrolling; `max-h-12` only managed
 * 2. Raise it further if you want a taller common row. Cells rendered as a
 * widget (input, select, DatePicker, badge, button) never get this — they are
 * single-line and have nothing to scroll.
 */
const WRAPPED_CELL_BOX =
  "max-h-16 overflow-y-auto overflow-x-hidden cell-scrollable whitespace-normal leading-normal break-words";

/**
 * Max height (px) for a multiline editable cell. `max-h-12` is 48px, which at
 * text-xs/leading-normal shows ~2 lines before the cell starts scrolling.
 */
const MULTILINE_CELL_MAX_PX = 48;

/**
 * A column-filter checkbox whose match logic is supplied by the caller instead
 * of being derived from the column's own cell value. Rendered in `MultiSelect`
 * right after the built-in `(Blank)` option.
 */
export type ExtraFilterOption = {
  value: string;
  label: string;
  match: (row: unknown[]) => boolean;
};

function MultiSelect({
  options,
  selected,
  onChange,
  optionMeta,
  optionLabels,
  hideBlank,
  extraOptions,
  onOpen,
}: {
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
  optionMeta?: Record<
    string,
    { count: number; sumLabel: string; partyName?: string }
  >;
  optionLabels?: Record<string, string>;
  hideBlank?: boolean;
  extraOptions?: ExtraFilterOption[];
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const extraValues = useMemo(
    () => new Set((extraOptions ?? []).map((o) => o.value)),
    [extraOptions],
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
        className="w-full text-[10px] border border-border rounded bg-card text-foreground px-1 py-0.5 text-left outline-none cursor-pointer truncate"
      >
        {selected.length ? `${selected.length} selected` : "All"}
      </button>
      {open && (
        <div
          className={`absolute top-full left-0 z-50 mt-1 bg-card border border-border rounded shadow-lg ${
            optionMeta ? "min-w-64 max-w-104" : "w-48"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center px-1 py-1.5 text-[10px] border-b border-border">
            <button
              type="button"
              onClick={() => onChange([...options])}
              className="text-blue-600 dark:text-blue-300 font-bold hover:underline cursor-pointer"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-red-600 dark:text-red-300 font-semibold hover:underline cursor-pointer"
            >
              Clear
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {!hideBlank && (
              <label className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60 cursor-pointer text-[10px]">
                <input
                  type="checkbox"
                  checked={selected.includes("(Blank)")}
                  onChange={() => {
                    const next = selected.includes("(Blank)")
                      ? selected.filter((v) => v !== "(Blank)")
                      : [...selected, "(Blank)"];
                    onChange(next);
                  }}
                  className="accent-blue-600 dark:accent-primary"
                />
                <span className="italic text-muted-foreground">(Blank)</span>
              </label>
            )}
            {extraOptions?.map((o) => (
              <label
                key={o.value}
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-amber-50 dark:hover:bg-amber-500/10 cursor-pointer text-[10px]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => {
                    const next = selected.includes(o.value)
                      ? selected.filter((v) => v !== o.value)
                      : [...selected, o.value];
                    onChange(next);
                  }}
                  className="accent-amber-600 dark:accent-amber-400"
                />
                <span className="flex-1 min-w-0 truncate font-semibold text-amber-700 dark:text-amber-400">
                  {o.label}
                </span>
              </label>
            ))}
            {options
              .filter((opt) => !extraValues.has(opt))
              .map((opt) => {
              const meta = optionMeta?.[opt];
              return (
                <label
                  key={opt}
                  className="flex items-center gap-1.5 px-2 py-1 hover:bg-muted/60 cursor-pointer text-[10px]"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(opt)}
                    onChange={() => {
                      const next = selected.includes(opt)
                        ? selected.filter((v) => v !== opt)
                        : [...selected, opt];
                      onChange(next);
                    }}
                    className="accent-blue-600 dark:accent-primary"
                  />
                  <span className="flex-1 min-w-0 leading-tight">
                    <span className="block truncate font-medium">{optionLabels?.[opt] ?? opt}</span>
                    {meta && (
                      <>
                        <span className="block text-[9px] text-foreground/60 truncate">
                          {meta.partyName || "—"}
                        </span>
                        <span className="block text-[9px] text-foreground/80">
                          {meta.count} · {meta.sumLabel}
                        </span>
                      </>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface GMDUpdateTableProps {
  headers: string[];
  rows: unknown[][];
  ids: string[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  title?: string;
  editable?: boolean;
  editableColumns?: string[];
  hiddenFilters?: string[];
  hiddenColumns?: string[];
  /**
   * Renders a small chip inside another column's cell, driven by the value of
   * a *hidden* column on the same row. Lets a flag travel in the row payload
   * (so it can still be stored, filtered and synced) without occupying a
   * visible column of its own.
   *
   * The driving column may be listed in `hiddenColumns` — that only removes it
   * from the rendered columns, the value is still read from the row.
   */
  cellBadges?: {
    onColumn: string;
    fromColumn: string;
    value: string;
    label: string;
    title?: string;
    /** Chip colour. Defaults to rose so existing single-badge callers are unchanged. */
    tone?: "rose" | "amber" | "yellow" | "slate";
  }[];
  /**
   * Header (normally the item-code column) whose filter area renders the
   * `batchPresenceFilters` checkboxes.
   */
  batchFilterHeader?: string;
  /**
   * Checkbox presence filters rendered beside "Drawing present" / "Image
   * present". Each one keeps only the rows whose hidden `column` equals
   * `value`. Mirrors `cellBadges` so a page declares the chip and the filter
   * from the same flag.
   */
  batchPresenceFilters?: {
    key: string;
    label: string;
    column: string;
    value: string;
    title?: string;
  }[];
  /**
   * Renders a toolbar toggle that highlights the cells of two columns when
   * their trimmed, case-sensitive values differ. Used by the Verify BOM table
   * to compare ITEM NAME vs NEW ITEM NAME.
   */
  diffHighlight?: {
    columns: [string, string];
    label?: string;
    tone?: "rose" | "amber" | "yellow";
  };
  groupByColumn?: string;
  mergeColumns?: string[];
  mergeTypeColumn?: string;
  mergeOnlyTypes?: string[];
  categoryOptions?: Record<string, string[]>;
  uniqueKeyColumns?: string[];
  fixedDropdownOptions?: Record<string, string[]>;
  /** Per-row dropdown options (e.g. cascading levels); falls back to fixedDropdownOptions. */
  rowDropdownOptions?: (header: string, row: unknown[]) => string[] | undefined;
  /**
   * Narrows a cell dropdown to the values that fit the rest of that row (the
   * L1-L8 cascade). Returns undefined for a header it does not cascade, and
   * never an empty list, so the editor is never left with nothing to pick.
   */
  cascadeOptionsFor?: (row: unknown[], header: string) => string[] | undefined;
  onCellUpdate?: (id: string, colIndex: number, value: string) => Promise<void>;
  /** Fallback save when onCellUpdate is not given: persist one DB field. */
  onFieldUpdate?: (id: string, field: string, value: string | null) => Promise<unknown>;
  /** Save handler for the "USD cost" column. */
  onUsdCostUpdate?: (id: string, usdCost: string) => Promise<unknown>;
  onFilteredRowsChange?: (rows: unknown[][]) => void;
  /**
   * Extra row predicate for what the table renders (pagination, record count,
   * export). Unlike the built-in column/global filters, rows rejected here are
   * still reported through `onFilteredRowsChange`, so a caller that derives
   * summary totals from that callback keeps stable totals when this drill-down
   * filter is toggled.
   */
  displayOnlyRowFilter?: (row: unknown[], id: string) => boolean;
  usdInrRate?: number | null;
  /** Shown after the rate, e.g. "open.er-api.com · as of 31 Oct 2026, 1:05 pm". */
  usdRateNote?: string | null;
  onRefreshRate?: () => void;
  /** Show the Export Excel button. Default true. */
  allowExport?: boolean;
  onReset?: () => void;
  externalFiltersActive?: boolean;
  castingRateInputs?: {
    key: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
  }[];
  lockedCostIds?: ReadonlySet<string>;
  bomIdOptionsById?: Record<string, string[]>;
  onSelectBomId?: (id: string, bomId: string | null) => void;
  bomIdCategoryFilter?: boolean;
  filterState?: {
    columnFilters: Record<string, string>;
    multiFilters: Record<string, string[]>;
    batchFilters?: Record<string, boolean>;
    dateFrom?: string;
    dateTo?: string;
    dateRanges?: Record<string, { from: string; to: string; blank?: boolean }>;
    globalSearch: string;
    currentPage: number;
    pageSize: number;
  };
  filterActions?: {
    onColumnFilter: (header: string, value: string) => void;
    onMultiFilter: (header: string, values: string[]) => void;
    onBatchFilter?: (key: string, value: boolean) => void;
    onDateFrom?: (val: string) => void;
    onDateTo?: (val: string) => void;
    onDateRange?: (header: string, from: string, to: string) => void;
    onDateBlank?: (header: string, blank: boolean) => void;
    onGlobalSearch: (val: string) => void;
    onResetFilters: () => void;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
  columnOptionMeta?: Record<
    string,
    Record<string, { count: number; sumLabel: string; partyName?: string }>
  >;
  fullHeight?: boolean;
  maxHeight?: string;
  pasteErpCodes?: {
    draft: string;
    setDraft: (value: string) => void;
    onAdd: () => void;
    onPaste: (text: string) => void;
  };
  onClearMoved?: () => void;
  onImportExcel?: (file: File) => void;
  onErpCodeChange?: (id: string, code: string) => void;
  fieldOverride?: Record<string, string>;
  filterOptionsOverride?: Record<string, string[]>;
  /** Renders one column with a host-supplied widget (e.g. a list of links with an add button). */
  customCell?: { column: string; render: (row: unknown[], id: string) => React.ReactNode };
  attachmentColumn?: string;
  onUploadAttachment?: (id: string, file: File) => Promise<void>;
  onClearAttachment?: (id: string) => Promise<void>;
  attachmentAccept?: string;
  /**
   * When true, the attachment column gets a two-option filter dropdown
   * ("Has Drawing" / "No Drawing") derived from whether the cell holds a URL.
   * Off by default so other attachment dashboards keep their current behaviour.
   */
  filterAttachmentColumn?: boolean;
  verdictColumn?: string;
  verdictsById?: Record<string, string | null | undefined>;
  onSetVerdict?: (id: string, verdict: string | null) => Promise<void>;
  columnGroups?: ColumnGroup[];
  /**
   * Typed sort (used by Contract Review): a newly-clicked column starts
   * ascending for text (A→Z) and numbers (lowest→highest), but descending for
   * date columns (latest→oldest). Numeric comparison also understands sheet
   * number strings with thousands separators, decimals, a trailing percent and
   * the literal "Infinity". Off by default so other dashboards keep their
   * current descending-first behaviour.
   */
  sortByType?: boolean;
  /**
   * Editable free-text columns that should render as a word-wrapped, multiline
   * `<textarea>` (auto-grows up to ~2 lines, then scrolls inside the cell)
   * instead of a single-line `<input>`. Off by default so other dashboards keep
   * single-line editing.
   */
  multilineEditableColumns?: string[];
  /**
   * Per-column default widths in px, keyed by header. Seeds columnWidths on
   * mount only, so a manual drag-resize still wins for the rest of the session
   * (and is still discarded on reload). Columns absent from the map fall
   * through to the built-in defaults.
   */
  defaultColumnWidths?: Record<string, number>;
  /**
   * Word-wrap header captions and read-only cell values onto as many lines as
   * they need, instead of ellipsising them, and top-align body cells so a tall
   * wrapped cell lines up with its neighbours. Meant for dashboards whose
   * columns are sized narrow enough that captions would otherwise clip.
   *
   * Does not affect cells rendered as a widget — `<input>`, `<select>`,
   * DatePicker, badges and buttons are single-line by nature and still clip.
   * Off by default so the other dashboards keep their current appearance.
   */
  wrapCells?: boolean;
  onDeleteRow?: (id: string) => Promise<void>;
  onMatchCosts?: () => void;
  blankOnlyEditableColumns?: string[];
  /**
   * Header (e.g. "ERP CODE"): on a row where this cell is blank, the
   * blank-only columns other than it can be overwritten, not just filled.
   */
  blankOnlyUnlockedBy?: string;
  dropdownRowCondition?: (header: string, row: unknown[]) => boolean;
  /**
   * Columns whose cell value is encoded as `<value><separator><code>` (default
   * separator `|`, e.g. BOLT WEIGHT `"0.38|SS"`). The cell renders a `<select>`
   * of `options` (the code) beside the value; changing the select emits the
   * chosen code via `onCellUpdate`. On rows where the column is not editable the
   * same value/code pair is rendered as read-only text.
   */
  encodedDropdownColumns?: Record<
    string,
    { options: string[]; separator?: string }
  >;
  /**
   * Per-column sentinel checkboxes rendered in the column's filter dropdown
   * right after the built-in `(Blank)` option. Each option's `match` is
   * evaluated against the whole row, letting a page express a filter that
   * depends on more than the column's own cell value (e.g. Actuator "Pending
   * Actuations" = an actuator item row whose Actuator dropdown is still empty).
   */
  extraFilterOptions?: Record<string, ExtraFilterOption[]>;
  imageButtonColumn?: string;
  itemImagesByCode?: Record<string, ContractReviewImage[]>;
  /**
   * Column holding a per-row uploaded drawing URL. When set, the
   * `imageButtonColumn` cell also renders a document icon beside the item code
   * that opens the uploaded drawing in a new tab, once one exists.
   */
  linkedDrawingColumn?: string;
  /**
   * Column holding comma-separated file URLs (e.g. ORDER LIST). Paired with
   * `linkedFilesIconColumn` to surface those files as an icon next to another
   * column's value.
   */
  linkedFilesColumn?: string;
  /**
   * Column whose cell renders a files icon (backed by `linkedFilesColumn`) next
   * to its value, opening the file-list dialog. Used to show ORDER LIST files
   * beside the contract number.
   */
  linkedFilesIconColumn?: string;
  /**
   * Extra captions to render right-aligned in a tabular-nums face, in addition
   * to the built-in `NUMERIC_COLUMNS` set. Lets a dashboard whose columns are
   * not part of the raw-material sheet (e.g. Engineering Data) opt its numeric
   * columns in without touching this file.
   */
  numericColumns?: ReadonlySet<string>;
  /**
   * Extra content rendered in the toolbar immediately after the record count.
   * The table does not fetch this itself — callers pass a ready-rendered node
   * (e.g. a density reference strip).
   */
  toolbarExtra?: ReactNode;
  /**
   * Ids of rows to mark with a warning: an amber row tint plus a warning
   * triangle rendered in the `warningColumn` cell. Used to flag rows whose
   * derived item name collides with another row's.
   */
  warningRowIds?: ReadonlySet<string>;
  /** Column whose cell renders the warning triangle. */
  warningColumn?: string;
  /** Tooltip for the warning triangle. Defaults to "Duplicate derived item name". */
  warningTitle?: string;
  /**
   * Enables the ERP-duplicate detector: rows sharing the same location + L-columns
   * but carrying a different ERP CODE are tinted yellow (and flagged in the ERP
   * CODE cell), with a "Duplicates only" toggle in the ERP CODE filter.
   */
  duplicateErpHighlight?: boolean;
  /**
   * Opt-in server mode: `rows` is already one filtered, sorted page. The table
   * stops filtering/sorting/slicing locally and reports paging and sort changes
   * through the callbacks. Requires `filterState` + `filterActions`.
   */
  serverMode?: ServerTableMode;
}

export interface ServerTableMode {
  total: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  refreshing?: boolean;
  sort: { column: number; direction: "asc" | "desc" } | null;
  onSortChange: (
    sort: { column: number; direction: "asc" | "desc" } | null,
  ) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Cascaded option list for a column; null until the facet request resolves. */
  getFacetOptions: (header: string) => string[] | null;
  /** Fired when a column's multi-select opens. */
  requestFacet: (header: string) => void;
  /** Every row matching the current filters, for the Excel export. */
  getAllRows: () => Promise<unknown[][]>;
  /**
   * The "Drawing present" / "Image present" checkboxes are table-local, so in
   * server mode they are reported here for the server query to apply.
   */
  onPresenceFiltersChange?: (presence: {
    drawing: boolean;
    image: boolean;
  }) => void;
}

type CellBadge = NonNullable<GMDUpdateTableProps["cellBadges"]>[number];

function cellBadgeClass(tone: CellBadge["tone"]): string {
  switch (tone) {
    case "amber":
      return "bg-amber-500 dark:bg-amber-500/80 text-white";
    case "slate":
      return "bg-slate-500 text-white dark:bg-accent dark:text-foreground";
    default:
      return "bg-rose-600 dark:bg-rose-500/80 text-white";
  }
}

/**
 * Resolves every badge that applies to one cell (a row can carry more than one,
 * e.g. "C" and "N" side by side).
 *
 * The driving column is usually listed in `hiddenColumns`, which only removes
 * it from the rendered columns - the value is still read from the row, so the
 * flag travels in the payload without occupying a visible column.
 */
function badgesForCell(
  cellBadges: GMDUpdateTableProps["cellBadges"],
  headers: readonly string[],
  header: string,
  sourceRow: unknown[],
): CellBadge[] {
  if (!cellBadges) return [];
  return cellBadges.filter(
    (b) =>
      b.onColumn === header &&
      String(sourceRow[headers.indexOf(b.fromColumn)] ?? "").trim() === b.value,
  );
}

export default function GMDUpdateTable({
  headers,
  rows,
  ids,
  selectedIndex,
  onSelect,
  title,
  editable,
  editableColumns,
  hiddenFilters,
  hiddenColumns,
  cellBadges,
  groupByColumn,
  mergeColumns,
  mergeTypeColumn,
  mergeOnlyTypes,
  categoryOptions,
  uniqueKeyColumns,
  fixedDropdownOptions,
  rowDropdownOptions,
  cascadeOptionsFor,
  onCellUpdate,
  onFieldUpdate,
  onUsdCostUpdate,
  onFilteredRowsChange,
  displayOnlyRowFilter,
  usdInrRate,
  usdRateNote,
  onRefreshRate,
  allowExport = true,
  onReset,
  externalFiltersActive,
castingRateInputs,
  lockedCostIds,
  bomIdOptionsById,
  onSelectBomId,
  bomIdCategoryFilter,
  fullHeight,
  maxHeight,
  pasteErpCodes,
  onClearMoved,
  onImportExcel,
  onErpCodeChange,
  fieldOverride,
  filterOptionsOverride,
  customCell,
  attachmentColumn,
  onUploadAttachment,
  onClearAttachment,
  attachmentAccept,
  filterAttachmentColumn,
  verdictColumn,
  verdictsById,
  onSetVerdict,
  columnGroups,
  sortByType,
  multilineEditableColumns,
  defaultColumnWidths,
  wrapCells,
  onDeleteRow,
  onMatchCosts,
  blankOnlyEditableColumns,
  blankOnlyUnlockedBy,
  dropdownRowCondition,
  encodedDropdownColumns,
  extraFilterOptions,
  filterState,
  filterActions,
  columnOptionMeta,
  imageButtonColumn,
  itemImagesByCode,
  linkedDrawingColumn,
  linkedFilesColumn,
  linkedFilesIconColumn,
  batchFilterHeader,
  batchPresenceFilters,
  diffHighlight,
  numericColumns,
  toolbarExtra,
  warningRowIds,
  warningColumn,
  warningTitle,
  duplicateErpHighlight,
  serverMode,
}: GMDUpdateTableProps) {
  const isControlled = !!filterState;
  const isServer = !!serverMode;

  const [sortColumn, setSortColumn] = useState<number | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const activeSortColumn = isServer
    ? (serverMode!.sort?.column ?? null)
    : sortColumn;
  const activeSortDirection = isServer
    ? (serverMode!.sort?.direction ?? "desc")
    : sortDirection;
  const [localCurrentPage, setLocalCurrentPage] = useState(1);
  const [localPageSize, setLocalPageSize] = useState(25);
  const [localGlobalSearch, setLocalGlobalSearch] = useState("");
  const [localColumnFilters, setLocalColumnFilters] = useState<
    Record<string, string>
  >({});
  const [localMultiFilters, setLocalMultiFilters] = useState<
    Record<string, string[]>
  >({});
  const [localDateFrom, setLocalDateFrom] = useState("");
  const [localDateTo, setLocalDateTo] = useState("");
  const [localDateRanges, setLocalDateRanges] = useState<
    Record<string, { from: string; to: string; blank?: boolean }>
  >({});
  const [presenceFilters, setPresenceFilters] = useState<{
    drawing: boolean;
    image: boolean;
  }>({ drawing: false, image: false });
  const reportPresence = serverMode?.onPresenceFiltersChange;
  useEffect(() => {
    reportPresence?.(presenceFilters);
  }, [reportPresence, presenceFilters]);
  const [localBatchFilters, setLocalBatchFilters] = useState<
    Record<string, boolean>
  >({});
  const [highlightDiff, setHighlightDiff] = useState(false);
  const [showOnlyDuplicateErp, setShowOnlyDuplicateErp] = useState(false);

  const currentPage = isControlled
    ? filterState!.currentPage
    : localCurrentPage;
  const pageSize = isControlled ? filterState!.pageSize : localPageSize;
  const globalSearch = isControlled
    ? filterState!.globalSearch
    : localGlobalSearch;
  const columnFilters = isControlled
    ? filterState!.columnFilters
    : localColumnFilters;
  const multiFilters = isControlled
    ? filterState!.multiFilters
    : localMultiFilters;
  const batchFilters = isControlled
    ? (filterState!.batchFilters ?? EMPTY_BATCH_FILTERS)
    : localBatchFilters;
  const dateFrom = isControlled
    ? (filterState!.dateFrom ?? "")
    : localDateFrom;
  const dateTo = isControlled ? (filterState!.dateTo ?? "") : localDateTo;
  const dateRanges = isControlled
    ? (filterState!.dateRanges ?? EMPTY_DATE_RANGES)
    : localDateRanges;
  const setDateRange = useCallback(
    (header: string, from: string, to: string) => {
      if (filterActions?.onDateRange) {
        filterActions.onDateRange(header, from, to);
      } else if (isControlled) {
        filterActions?.onDateFrom?.(from);
        filterActions?.onDateTo?.(to);
      } else {
        setLocalDateRanges((prev) => {
          const next = { ...prev };
          if (from || to) next[header] = { from, to };
          else delete next[header];
          return next;
        });
        setLocalDateFrom(from);
        setLocalDateTo(to);
      }
    },
    [filterActions, isControlled],
  );
  const setCurrentPage = isControlled
    ? filterActions!.onPageChange
    : setLocalCurrentPage;
  const setPageSize = isControlled
    ? filterActions!.onPageSizeChange
    : setLocalPageSize;
  const setDateBlank = useCallback(
    (header: string, blank: boolean) => {
      if (filterActions?.onDateBlank) {
        filterActions.onDateBlank(header, blank);
      } else {
        setLocalDateRanges((prev) => {
          const next = { ...prev };
          if (blank) next[header] = { from: "", to: "", blank: true };
          else if (next[header]) {
            const { from, to } = next[header];
            if (from || to) next[header] = { from, to };
            else delete next[header];
          }
          return next;
        });
      }
      setCurrentPage(1);
    },
    [filterActions, setCurrentPage],
  );

  const setBatchFilter = useCallback(
    (key: string, value: boolean) => {
      if (filterActions?.onBatchFilter) {
        filterActions.onBatchFilter(key, value);
      } else {
        setLocalBatchFilters((prev) => {
          const next = { ...prev };
          if (value) next[key] = true;
          else delete next[key];
          return next;
        });
      }
      setCurrentPage(1);
    },
    [filterActions, setCurrentPage],
  );

  const DATE_FILTER_CANDIDATES = useMemo(() => new Set(["Date", "DATE", "expiryDate", "DATE OF CONTRACT", "LC DATE/RTGS DATE", "LAST DATE OF SHIPMENT/DATE OF LC"]), []);
  const dateColIdx = useMemo(() => {
    for (const cand of DATE_FILTER_CANDIDATES) {
      const idx = headers.indexOf(cand);
      if (idx !== -1) return idx;
    }
    // Fallback: any header containing "date" (e.g. future Warranty Exp Date)
    const fallback = headers.findIndex((h) => h.toLowerCase().includes("date"));
    return fallback;
  }, [headers, DATE_FILTER_CANDIDATES]);
  const isDateFilterHeader = useCallback((header: string) => DATE_FILTER_CANDIDATES.has(header), [DATE_FILTER_CANDIDATES]);

  // "Highlight Name Diff" support: compare two columns (trimmed, case
  // sensitive) and tint both cells of any row/group where they differ.
  const [diffColA, diffColB] = diffHighlight?.columns ?? ["", ""];
  const diffIdxA = diffHighlight ? headers.indexOf(diffColA) : -1;
  const diffIdxB = diffHighlight ? headers.indexOf(diffColB) : -1;
  const diffActive = highlightDiff && diffIdxA !== -1 && diffIdxB !== -1;
  const rowDiffers = useCallback(
    (row: unknown[]): boolean =>
      diffActive &&
      String(row[diffIdxA] ?? "").trim() !== String(row[diffIdxB] ?? "").trim(),
    [diffActive, diffIdxA, diffIdxB],
  );
  const isDiffCol = useCallback(
    (header: string): boolean =>
      diffActive && (header === diffColA || header === diffColB),
    [diffActive, diffColA, diffColB],
  );

  const hiddenSet = useMemo(
    () => new Set(hiddenColumns ?? []),
    [hiddenColumns],
  );
  const groupByIdx = groupByColumn ? headers.indexOf(groupByColumn) : -1;
  const mergeTypeIdx = mergeTypeColumn ? headers.indexOf(mergeTypeColumn) : -1;
  const isMergeable = (row: unknown[]): boolean => {
    if (mergeTypeIdx === -1 || !mergeOnlyTypes || mergeOnlyTypes.length === 0) {
      return true;
    }
    return mergeOnlyTypes.includes(String(row[mergeTypeIdx] ?? "").trim());
  };
  const mergeIdxSet = useMemo(
    () =>
      new Set(
        (mergeColumns ?? [])
          .map((h) => headers.indexOf(h))
          .filter((i) => i >= 0),
      ),
    [mergeColumns, headers],
  );
  const isGrouped = groupByIdx >= 0 && mergeIdxSet.size > 0;
  // Maps every group child to its owning group so a group can be collapsed onto
  // its first *visible* child. Children in hiddenColumns are skipped, so a group
  // whose leading child is hidden still renders on its next visible child.
  const groupByChild = useMemo(() => {
    const map = new Map<string, { group: ColumnGroup; isFirst: boolean }>();
    if (!columnGroups) return map;
    for (const group of columnGroups) {
      const visibleChildren = group.children.filter(
        (c) => headers.includes(c.header) && !hiddenSet.has(c.header),
      );
      visibleChildren.forEach((child, i) => {
        if (map.has(child.header)) return;
        map.set(child.header, { group, isFirst: i === 0 });
      });
    }
    return map;
  }, [columnGroups, headers, hiddenSet]);
  const visibleCols: ResolvedCol[] = useMemo(() => {
    const out: ResolvedCol[] = [];
    headers.forEach((header, idx) => {
      if (hiddenSet.has(header)) return;
      const info = groupByChild.get(header);
      if (!info) {
        out.push({ header, idx });
        return;
      }
      // Non-first children are absorbed into the group's single column.
      if (!info.isFirst) return;
      const children = info.group.children.filter(
        (c) => headers.includes(c.header) && !hiddenSet.has(c.header),
      );
      if (children.length === 0) {
        out.push({ header, idx });
        return;
      }
      out.push({ header, idx, group: { ...info.group, children } });
    });
    return out;
  }, [headers, hiddenSet, groupByChild]);
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>(
    () => {
      // A collapsed group seeds the width of the column it renders on, so a
      // later drag-resize behaves exactly like a standalone column.
      const groupWidthByHeader = new Map<string, number>();
      for (const g of columnGroups ?? []) {
        if (!g.width) continue;
        const anchor = g.children.find((c) => !hiddenSet.has(c.header));
        if (anchor) groupWidthByHeader.set(anchor.header, g.width);
      }
      const widths: Record<number, number> = {};
      headers.forEach((h, i) => {
        const gw = groupWidthByHeader.get(h);
        if (gw) {
          widths[i] = gw;
          return;
        }
        // Caller-supplied per-column defaults win over the built-in chain, so a
        // dashboard can size each of its columns without touching this file.
        const dw = defaultColumnWidths?.[h];
        if (typeof dw === "number" && dw > 0) {
          widths[i] = dw;
          return;
        }
        widths[i] =
          h === "ITEM NAME (proposed)-AUTO"
            ? 200
            : h === "Party Mail Address"
              ? 300
              : h === "ORDER LIST"
                ? 160
                // : h === "Upload Drawing"
                //   ? 250
                  : h === "CONTRACT NO"
                    ? 360
                    : 180;
      });
      return widths;
    },
  );
  const getColWidth = useCallback(
    (col: ResolvedCol) =>
      columnWidths[col.idx] ?? col.group?.width ?? DEFAULT_GROUP_WIDTH,
    [columnWidths],
  );
  // Left offsets for the frozen leading columns, derived from the *visible*
  // column order and real rendered widths so a collapsed group (wider than any
  // single child) cannot desync the header from the body.
  const frozenOffsets = useMemo(() => {
    const offsets: (number | undefined)[] = [];
    let acc = 0;
    const count = Math.min(FROZEN_VISIBLE_COLUMNS, visibleCols.length);
    for (let i = 0; i < count; i++) {
      offsets.push(acc);
      acc += getColWidth(visibleCols[i]);
    }
    return offsets;
  }, [visibleCols, getColWidth]);
  const resizingRef = useRef<{
    index: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteRow = useMemo(() => {
    if (!confirmDeleteId) return null;
    const idx = ids.indexOf(confirmDeleteId);
    if (idx === -1) return null;
    return { id: confirmDeleteId, erpCode: String(rows[idx]?.[0] ?? "").trim() };
  }, [confirmDeleteId, ids, rows]);

  const sortStorageKey = `gmd-table-sort:${title ?? "table"}`;
  const handleSort = (colIndex: number) => {
    const sameColumn = activeSortColumn === colIndex;
    const h = headers[colIndex] ?? "";
    const nextDirection = sameColumn
      ? activeSortDirection === "asc"
        ? "desc"
        : "asc"
      : sortByType && !isDateHeader(h)
        ? "asc"
        : "desc";
    if (isServer) {
      serverMode!.onSortChange({ column: colIndex, direction: nextDirection });
    } else {
      setSortColumn(colIndex);
      setSortDirection(nextDirection);
      try {
        localStorage.setItem(sortStorageKey, JSON.stringify({ header: h, direction: nextDirection }));
      } catch {}
    }
    setCurrentPage(1);
  };

  // Keep the user's sort across reloads (local mode; server mode owns its sort).
  const sortRestored = useRef(false);
  useEffect(() => {
    if (isServer || sortRestored.current || headers.length === 0) return;
    sortRestored.current = true;
    try {
      const saved = JSON.parse(localStorage.getItem(sortStorageKey) ?? "null");
      const col = saved ? headers.indexOf(saved.header) : -1;
      if (col !== -1) {
        setSortColumn(col);
        setSortDirection(saved.direction === "asc" ? "asc" : "desc");
      }
    } catch {}
  }, [isServer, headers, sortStorageKey]);

  const handleColumnFilter = (header: string, value: string) => {
    if (isControlled) filterActions!.onColumnFilter(header, value);
    else setLocalColumnFilters((prev) => ({ ...prev, [header]: value }));
    setCurrentPage(1);
  };

  const handleMultiFilter = (header: string, values: string[]) => {
    if (isControlled) filterActions!.onMultiFilter(header, values);
    else
      setLocalMultiFilters((prev) => {
        const next = { ...prev };
        if (values.length) next[header] = values;
        else delete next[header];
        return next;
      });
    setCurrentPage(1);
  };
  const handleExportToExcel = async () => {
    const toastId = toast.loading("Preparing Excel file...");
    try {
      // Server mode only holds one page; ask for every matching row.
      const sourceRows = isServer
        ? await serverMode!.getAllRows()
        : displayedWithIds.map(({ row }) => row);
      const rows = sourceRows.map((row) => {
        const obj: Record<string, unknown> = {};
        visibleCols.forEach(({ header, idx }) => {
          const v = row[idx];
          obj[header] = v != null ? String(v) : "";
        });
        return obj;
      });
      const XLSX = await import("xlsx");
      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Data");
      const dateStr = new Date().toISOString().split("T")[0];
      XLSX.writeFile(
        workbook,
        `${title?.replace(/\s+/g, "_") || "Export"}_${dateStr}.xlsx`,
      );
      toast.success("Excel file downloaded successfully!", { id: toastId });
    } catch (err: any) {
      console.error("Export to Excel failed:", err);
      toast.error("Failed to export Excel file.", { id: toastId });
    }
  };

  const handleResetFilters = () => {
    if (isControlled) filterActions!.onResetFilters();
    else {
      setLocalColumnFilters({});
      setLocalMultiFilters({});
      setLocalBatchFilters({});
      setLocalGlobalSearch("");
      setLocalDateFrom("");
      setLocalDateTo("");
      setLocalDateRanges({});
    }
    setPresenceFilters({ drawing: false, image: false });
    setShowOnlyDuplicateErp(false);
    setCurrentPage(1);
    onReset?.();
  };

  const hasActiveFilters =
    Object.values(columnFilters).some((v) => v && v !== "All") ||
    Object.values(multiFilters).some((v) => v.length > 0) ||
    Object.values(batchFilters).some(Boolean) ||
    globalSearch.trim() !== "" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    showOnlyDuplicateErp ||
    presenceFilters.drawing ||
    presenceFilters.image ||
    Object.values(dateRanges).some((r) => r.from || r.to || r.blank);

  const showResetFilters = hasActiveFilters || !!externalFiltersActive;

  const sortedWithIds = useMemo(() => {
    const decorated = rows.map((row, i) => ({ row, id: ids[i], i }));
    // Server mode: the page already arrives filtered and sorted.
    if (isServer) return decorated;
    if (activeSortColumn === null && !isGrouped) return decorated;
    const dir = activeSortDirection === "asc" ? 1 : -1;
    const sortHeader =
      activeSortColumn !== null ? (headers[activeSortColumn] ?? "") : "";
    const isDateSort = activeSortColumn !== null && isDateHeader(sortHeader);
    decorated.sort((a, b) => {
      if (isGrouped) {
        const g = cellCompare(a.row[groupByIdx], b.row[groupByIdx], 1);
        if (g !== 0) return g;
      }
      if (activeSortColumn !== null) {
        const c = isDateSort
          ? compareDates(
              a.row[activeSortColumn],
              b.row[activeSortColumn],
              dir,
            )
          : cellCompare(
              a.row[activeSortColumn],
              b.row[activeSortColumn],
              dir,
              sortByType,
            );
        if (c !== 0) return c;
      }
      return a.i - b.i;
    });
    return decorated;
  }, [
    rows,
    ids,
    isServer,
    activeSortColumn,
    activeSortDirection,
    isGrouped,
    groupByIdx,
    headers,
    sortByType,
  ]);

  const rowSearchCache = useMemo(() => {
    const cache = new Map<unknown[], string>();
    for (const row of rows) {
      cache.set(
        row,
        headers.map((_, i) => squish(row[i])).join(""),
      );
    }
    return cache;
  }, [rows, headers]);

  // ERP-duplicate detector (opt-in): rows that share the same location + L-columns
  // but carry a different ERP CODE are the same item counted twice.
  const duplicateRowSet = useMemo(() => {
    if (!duplicateErpHighlight) return new Set<unknown[]>();
    const erpIdx = headers.indexOf("ERP CODE");
    if (erpIdx === -1) return new Set<unknown[]>();
    const keyIdxs = DUPLICATE_KEY_HEADERS.map((h) => headers.indexOf(h)).filter(
      (i) => i !== -1,
    );
    if (keyIdxs.length === 0) return new Set<unknown[]>();
    const keyOf = (row: unknown[]) =>
      keyIdxs.map((i) => String(row[i] ?? "").trim()).join("\u0001");
    const groups = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = keyOf(row);
      const codes = groups.get(key) ?? new Set<string>();
      codes.add(String(row[erpIdx] ?? "").trim());
      groups.set(key, codes);
    }
    const result = new Set<unknown[]>();
    for (const row of rows) {
      if ((groups.get(keyOf(row))?.size ?? 0) > 1) result.add(row);
    }
    return result;
  }, [duplicateErpHighlight, rows, headers]);

  const rowPassesFilters = useCallback(
    (row: unknown[], opts: { excludeHeader?: string; id?: string } = {}): boolean => {
      if (showOnlyDuplicateErp && !duplicateRowSet.has(row)) return false;
      const gs = globalSearch;
      if (gs.trim()) {
        const q = squish(gs);
        if (!(rowSearchCache.get(row) ?? "").includes(q)) return false;
      }

      for (const [colName, filterVal] of Object.entries(columnFilters)) {
        if (colName === opts.excludeHeader) continue;
        if (!filterVal || filterVal === "All") continue;
        if (colName === BOM_ID_COLUMN && bomIdCategoryFilter) {
          if (!opts.id) continue;
          const cat = getBomIdCategory(bomIdOptionsById?.[opts.id]);
          if (cat !== filterVal) return false;
          continue;
        }
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) continue;
        const cellVal = String(row[colIdx] ?? "");
        if (
          filterVal === "(Blank)" ||
          filterVal === "-" ||
          filterVal === "—"
        ) {
          if (cellVal !== "") return false;
        } else if (!looseIncludes(cellVal, filterVal)) {
          return false;
        }
      }

      for (const [colName, selected] of Object.entries(multiFilters)) {
        if (colName === opts.excludeHeader) continue;
        if (!selected.length) continue;
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) continue;
        const cellVal = String(row[colIdx] ?? "").trim();
        if (
          filterAttachmentColumn &&
          attachmentColumn &&
          colName === attachmentColumn
        ) {
          const hasDrawing = cellVal !== "";
          const matchesHasDrawing =
            selected.includes("Has Drawing") && hasDrawing;
          const matchesNoDrawing =
            selected.includes("No Drawing") && !hasDrawing;
          if (!(matchesHasDrawing || matchesNoDrawing)) return false;
          continue;
        }
        const matchesBlank = selected.includes("(Blank)") && cellVal === "";
        const matchesHasValue =
          selected.includes(FLOW_HAS_VALUE) && cellHasValue(cellVal);
        const matchesNoValue =
          selected.includes(FLOW_NO_VALUE) && !cellHasValue(cellVal);
        const matchesZero = selected.includes(FLOW_ZERO) && cellIsZero(cellVal);
        const matchesNonZero =
          selected.includes(FLOW_NON_ZERO) && !cellIsZero(cellVal);
        const matchesExtra = (extraFilterOptions?.[colName] ?? []).some(
          (o) => selected.includes(o.value) && o.match(row),
        );
        if (
          !(
            matchesBlank ||
            matchesHasValue ||
            matchesNoValue ||
            matchesZero ||
            matchesNonZero ||
            matchesExtra ||
            selected.includes(cellVal)
          )
        )
          return false;
      }

      for (const [colName, r] of Object.entries(dateRanges)) {
        if (colName === opts.excludeHeader) continue;
        if (!r.from && !r.to && !r.blank) continue;
        const colIdx = headers.indexOf(colName);
        if (colIdx === -1) continue;
        const dateStr = String(row[colIdx] ?? "");
        if (r.blank) {
          const isBlank =
            dateStr === "" || dateStr === "-" || dateStr === "—";
          if (!isBlank) return false;
          continue;
        }
        if (!dateStr) return false;
        const date = parseDate(dateStr);
        if (!date) return false;
        const fromDate = r.from ? new Date(r.from + "T00:00:00") : null;
        const toEnd = r.to ? new Date(r.to + "T23:59:59") : null;
        if (fromDate && date < fromDate) return false;
        if (toEnd && date > toEnd) return false;
      }

      if (dateColIdx !== -1 && (dateFrom || dateTo)) {
        const fromDate = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
        const toEnd = dateTo ? new Date(dateTo + "T23:59:59") : null;
        const dateStr = String(row[dateColIdx] ?? "");
        if (!dateStr) return false;
        const date = parseDate(dateStr);
        if (!date) return false;
        if (fromDate && date < fromDate) return false;
        if (toEnd && date > toEnd) return false;
      }

      if (presenceFilters.drawing && linkedDrawingColumn) {
        const dIdx = headers.indexOf(linkedDrawingColumn);
        if (dIdx === -1 || !String(row[dIdx] ?? "").trim()) return false;
      }
      if (presenceFilters.image && imageButtonColumn) {
        const iIdx = headers.indexOf(imageButtonColumn);
        const code = iIdx !== -1 ? String(row[iIdx] ?? "").trim() : "";
        if (!code || !(itemImagesByCode?.[code]?.length ?? 0)) return false;
      }
      for (const bf of batchPresenceFilters ?? []) {
        if (!batchFilters[bf.key]) continue;
        const bIdx = headers.indexOf(bf.column);
        if (bIdx === -1 || String(row[bIdx] ?? "").trim() !== bf.value)
          return false;
      }

      return true;
    },
    [
      globalSearch,
      rowSearchCache,
      columnFilters,
      multiFilters,
      batchFilters,
      headers,
      dateRanges,
      dateColIdx,
      dateFrom,
      dateTo,
      bomIdCategoryFilter,
      bomIdOptionsById,
      attachmentColumn,
      filterAttachmentColumn,
      presenceFilters,
      linkedDrawingColumn,
      imageButtonColumn,
      itemImagesByCode,
      batchPresenceFilters,
      extraFilterOptions,
      showOnlyDuplicateErp,
      duplicateRowSet,
    ],
  );

  const filteredWithIds = useMemo(
    () =>
      isServer
        ? sortedWithIds
        : sortedWithIds.filter(({ row, id }) => rowPassesFilters(row, { id })),
    [isServer, sortedWithIds, rowPassesFilters],
  );

  const displayedWithIds = useMemo(
    () =>
      displayOnlyRowFilter
        ? filteredWithIds.filter(({ row, id }) => displayOnlyRowFilter(row, id))
        : filteredWithIds,
    [filteredWithIds, displayOnlyRowFilter],
  );

  const filteredRows = useMemo(
    () => displayedWithIds.map((v) => v.row),
    [displayedWithIds],
  );

  // Summary consumers get the table-filtered set without the display-only
  // drill-down, so toggling that drill-down never moves their totals.
  const statsRows = useMemo(
    () => filteredWithIds.map((v) => v.row),
    [filteredWithIds],
  );

  useEffect(() => {
    onFilteredRowsChange?.(statsRows);
  }, [statsRows, onFilteredRowsChange]);

  const pbgAmountSum = useMemo(() => {
    const colIdx = headers.indexOf("PBG AMOUNT");
    if (colIdx === -1) return null;
    return filteredRows.reduce((sum, row) => {
      const cleaned = String(row[colIdx] ?? "").replace(/,/g, "");
      const num = parseFloat(cleaned);
      return sum + (isNaN(num) ? 0 : num);
    }, 0);
  }, [filteredRows, headers]);

  const totalRecords = isServer ? serverMode!.total : filteredRows.length;
  const totalPages = Math.ceil(totalRecords / pageSize) || 1;
  const activePage = isServer
    ? serverMode!.page
    : Math.min(currentPage, totalPages);

  const columnUniqueVals = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const h of headers) {
      const idx = headers.indexOf(h);
      const values =
        (isServer ? serverMode!.getFacetOptions(h) : null) ||
        filterOptionsOverride?.[h] ||
        fixedDropdownOptions?.[h] ||
        getUniqueColumnValues(idx);
      // Server facets already cascade; still honour an explicit allow-list.
      const allowed = isServer ? categoryOptions?.[h] : undefined;
      result[h] = allowed?.length
        ? values.filter((value) => allowed.includes(value))
        : values;
    }
    return result;
  }, [
    headers,
    categoryOptions,
    fixedDropdownOptions,
    rows,
    filterOptionsOverride,
    isServer,
    serverMode,
  ]);

  const cascadedFilterOptions = useMemo(() => {
    // Server facets already exclude the column's own filter.
    if (isServer) return columnUniqueVals;
    const result: Record<string, string[]> = {};
    if (!hasActiveFilters) {
      return columnUniqueVals;
    }
    for (const h of headers) {
      const idx = headers.indexOf(h);
      const vals = new Set<string>();
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!rowPassesFilters(row, { excludeHeader: h, id: ids[i] })) continue;
        const v = String(row[idx] ?? "");
        if (v) vals.add(v);
      }
      let list = [...vals].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
      if (categoryOptions?.[h]?.length) {
        const allowed = new Set(categoryOptions[h]);
        list = list.filter((v) => allowed.has(v));
      }
      for (const s of multiFilters[h] ?? []) {
        if (s !== "(Blank)" && !list.includes(s)) list.push(s);
      }
      result[h] = list;
    }
    for (const [h, vals] of Object.entries(filterOptionsOverride ?? {})) {
      result[h] = vals;
    }
    return result;
  }, [rows, ids, headers, categoryOptions, multiFilters, hasActiveFilters, rowPassesFilters, columnUniqueVals, filterOptionsOverride]);

  const paginatedWithIds = useMemo(() => {
    // Server mode hands us exactly one page.
    if (isServer) return filteredWithIds;
    const start = (activePage - 1) * pageSize;
    return displayedWithIds.slice(start, start + pageSize);
  }, [isServer, displayedWithIds, activePage, pageSize]);

  const { mergedSpans, mergedSkipped } = useMemo(() => {
    const spans = new Map<string, number>();
    const skipped = new Set<string>();
    if (!isGrouped) return { mergedSpans: spans, mergedSkipped: skipped };
    const list = paginatedWithIds;
    const n = list.length;
    for (const c of mergeIdxSet) {
      let i = 0;
      while (i < n) {
        let j = i;
        while (
          j + 1 < n &&
          isMergeable(list[j].row) &&
          isMergeable(list[j + 1].row) &&
          cellEq(list[j].row, list[j + 1].row, groupByIdx) &&
          cellEq(list[j].row, list[j + 1].row, c)
        ) {
          j++;
        }
        const len = j - i + 1;
        if (len > 1) {
          spans.set(`${i}:${c}`, len);
          for (let k = i + 1; k <= j; k++) skipped.add(`${k}:${c}`);
        }
        i = j + 1;
      }
    }
    return { mergedSpans: spans, mergedSkipped: skipped };
  }, [paginatedWithIds, isGrouped, groupByIdx, mergeIdxSet]);

  const handleResizeStart = useCallback(
    (index: number, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = {
        index,
        startX: e.clientX,
        startWidth: columnWidths[index],
      };
      document.addEventListener("mousemove", handleResizeMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.body.style.cursor = "col-resize";
    },
    [columnWidths],
  );

  const handleResizeMove = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return;
    const { index, startX, startWidth } = resizingRef.current;
    const newWidth = Math.max(60, startWidth + (e.clientX - startX));
    setColumnWidths((prev) => ({ ...prev, [index]: newWidth }));
  }, []);

  const handleResizeEnd = useCallback(() => {
    resizingRef.current = null;
    document.removeEventListener("mousemove", handleResizeMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.body.style.cursor = "default";
  }, [handleResizeMove]);

  function getUniqueColumnValues(colIdx: number): string[] {
    const vals = new Set<string>();
    for (const row of rows) {
      const v = String(row[colIdx] ?? "");
      if (v) vals.add(v);
    }
    return [...vals].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }),
    );
  }

  const handleCellUpdate = async (
    rowIndex: number,
    colIndex: number,
    value: string,
  ) => {
    const entry = paginatedWithIds[rowIndex];
    const id = entry?.id;
    if (!id) return;
    const header = headers[colIndex];

    if (onCellUpdate) {
      await onCellUpdate(id, colIndex, value);
      return;
    }

    const field = fieldOverride?.[header] ?? COL_INDEX_TO_DB_FIELD[colIndex];
    if (!field || !onFieldUpdate) return;

    const savedValue = value || null;

    const toastId = toast.loading(`Updating ${header}...`);
    try {
      await onFieldUpdate(id, field, savedValue);
      toast.success(`${header} updated`, { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || err || `Failed to update ${header}`, { id: toastId });
    }

    if (header === "ERP ITEM CODE" && value && onErpCodeChange) {
      onErpCodeChange(id, value);
    }
  };

  const handleUsdCostUpdate = async (rowIndex: number, value: string) => {
    const entry = paginatedWithIds[rowIndex];
    const id = entry?.id;
    if (!id || !onUsdCostUpdate) return;
    const toastId = toast.loading("Converting USD cost...");
    try {
      await onUsdCostUpdate(id, value);
      toast.success("USD cost converted to INR", { id: toastId });
    } catch (err: any) {
      toast.error(err?.message || err || "Failed to update USD cost", { id: toastId });
    }
  };

  /**
   * Per-cell render metadata, derived purely from the column name + cell value.
   * Shared by the standalone <td> path and the collapsed-group <td> path so both
   * agree on editability and highlighting.
   */
  const rowUnlocksBlankOnly = (header: string, row: unknown[]) => {
    if (!blankOnlyUnlockedBy || header === blankOnlyUnlockedBy) return false;
    const idx = headers.indexOf(blankOnlyUnlockedBy);
    return idx !== -1 && String(row[idx] ?? "").trim() === "";
  };

  const cellMeta = (header: string, cellIdx: number, row: unknown[]) => {
    const value = row[cellIdx];
    const display = value != null ? String(value) : "";
    const isBlankCell = String(display ?? "").trim() === "";
    const isBlankOnlyColumn = !!blankOnlyEditableColumns?.includes(header);
    const baseEditable =
      !editableColumns ||
      editableColumns.includes(header) ||
      isBlankOnlyColumn;
    const isCellEditable =
      !!editable &&
      baseEditable &&
      (!isBlankOnlyColumn || isBlankCell || rowUnlocksBlankOnly(header, row)) &&
      (!dropdownRowCondition || dropdownRowCondition(header, row));
    const isAttachmentColumn =
      !!attachmentColumn && header === attachmentColumn && !!onUploadAttachment;
    const isPnBlankDropdown =
      header === "PN RATING" &&
      !String(display).trim() &&
      (fixedDropdownOptions?.[header]?.length ?? 0) > 0;
    return { display, isCellEditable, isAttachmentColumn, isPnBlankDropdown };
  };

  /**
   * Auto-grows a multiline cell `<textarea>` from one line up to
   * `MULTILINE_CELL_MAX_PX`, letting it scroll internally beyond that. Also
   * used as the element `ref`, so it sizes on mount / when the cell remounts.
   */
  const autoGrowCell = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height =
      Math.min(el.scrollHeight, MULTILINE_CELL_MAX_PX) + "px";
  }, []);

  /**
   * Class string for a text cell. `scrollable` is false inside a collapsed
   * group, because the group column caps and scrolls itself as a whole —
   * capping each child too would nest a scroller inside a scroller and clip the
   * other children out of reach.
   */
  const textCellClass = (scrollable: boolean) =>
    !wrapCells
      ? "truncate block"
      : scrollable
        ? `block ${WRAPPED_CELL_BOX}`
        : "block break-words";

  /**
   * Renders the body of one column. Lifted verbatim out of the row loop so a
   * collapsed column group can render each of its children through the exact
   * same logic (DatePicker, select, attachment, status badge, links, ...).
   */
  const renderCellContent = (
    header: string,
    cellIdx: number,
    row: unknown[],
    id: string,
    idx: number,
    scrollable = true,
    badgesOverride?: CellBadge[],
  ): React.ReactNode => {
    const { display, isCellEditable, isAttachmentColumn } = cellMeta(
      header,
      cellIdx,
      row,
    );
    let cellContent: React.ReactNode;
    if (isAttachmentColumn) {
      const isVerdictColumn = verdictColumn === header && onSetVerdict != null;
      cellContent = (
        <AttachmentCell
          url={display}
          accept={attachmentAccept}
          onUpload={onUploadAttachment ? (file) => onUploadAttachment(id, file) : undefined}
          onClear={onClearAttachment ? () => onClearAttachment(id) : undefined}
          verdict={isVerdictColumn ? verdictsById?.[id] : undefined}
          onSetVerdict={
            isVerdictColumn
              ? (verdict) => onSetVerdict(id, verdict)
              : undefined
          }
        />
      );
    } else if (customCell && header === customCell.column) {
      cellContent = customCell.render(row, id);
    } else if (header === "BOM ID" && onSelectBomId) {
      const options = bomIdOptionsById?.[id] ?? [];
      if (options.length === 0) {
        cellContent = (
          <span className="truncate block italic text-muted-foreground">
            No BOM exists
          </span>
        );
      } else if (options.length === 1) {
        cellContent = (
          <span className={textCellClass(scrollable)} title={options[0]}>
            {display || options[0] || "—"}
          </span>
        );
      } else {
        cellContent = (
          <select
            value={display}
            onChange={(e) => onSelectBomId?.(id, e.target.value || null)}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs bg-transparent border-none outline-none cursor-pointer"
            title={options.join(", ")}
          >
            <option value="">-- select --</option>
            {options.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        );
      }
    } else if (header === "RM AVAIL") {
      if (display === "SA") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-600 dark:bg-emerald-500/80 text-white text-[10px] font-bold">
            SA
          </span>
        );
      } else if (display === "Not available") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-600 dark:bg-rose-500/80 text-white text-[10px] font-bold">
            Not available
          </span>
        );
      } else {
        cellContent = <span className="truncate block text-muted-foreground">—</span>;
      }
    } else if (header === "NO USE" || header === "USE/NO USE") {
      if (display === "USE") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-emerald-600 dark:bg-emerald-500/80 text-white text-[10px] font-bold">
            USE
          </span>
        );
      } else if (display === "NO USE") {
        cellContent = (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-rose-600 dark:bg-rose-500/80 text-white text-[10px] font-bold">
            NO USE
          </span>
        );
      } else {
        cellContent = <span className="truncate block text-muted-foreground">—</span>;
      }
    } else if (isCellEditable) {
      if (header === "USD cost") {
        cellContent = (
          <input
            key={display + "-" + idx + "-" + cellIdx}
            type="text"
            defaultValue={display}
            placeholder="$"
            onBlur={(e) => {
              if (e.target.value !== display) {
                handleUsdCostUpdate(idx, e.target.value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full text-xs bg-transparent border-none outline-none font-mono-md"
          />
        );
      } else if (header === "cost") {
        if (lockedCostIds?.has(id)) {
          cellContent = (
            <span
              className="truncate block font-mono-md text-foreground"
              title={display}
            >
              {display || "—"}
            </span>
          );
        } else {
          cellContent = (
            <input
              key={display + "-" + idx + "-" + cellIdx}
              type="text"
              defaultValue={display}
              onBlur={(e) => {
                if (e.target.value !== display) {
                  handleCellUpdate(idx, cellIdx, e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="w-full text-xs bg-transparent border-none outline-none"
            />
          );
        }
      } else if (header === "MAJOR MARKING") {
        const isYes = display === "true";
        const isNo = display === "false";
        cellContent = (
          <div className="flex items-center justify-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCellUpdate(idx, cellIdx, isYes ? "" : "true");
              }}
              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                isYes
                  ? "bg-emerald-500 dark:bg-emerald-500/80 text-white "
                  : "bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/25 dark:hover:bg-emerald-500/20"
              }`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleCellUpdate(idx, cellIdx, isNo ? "" : "false");
              }}
              className={`px-2.5 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
                isNo
                  ? "bg-rose-500 dark:bg-rose-500/80 text-white "
                  : "bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/25 dark:hover:bg-rose-500/20"
              }`}
            >
              No
            </button>
          </div>
        );
      } else if (isDateHeader(header)) {
        cellContent = (
          <DatePicker
            key={display + "-" + idx + "-" + cellIdx}
            value={display}
            onChange={(next) => {
              if (next !== display) {
                handleCellUpdate(idx, cellIdx, next);
              }
            }}
          />
        );
      } else if (encodedDropdownColumns?.[header]) {
        const cfg = encodedDropdownColumns[header];
        const sep = cfg.separator ?? "|";
        const sepAt = display.indexOf(sep);
        const valuePart = sepAt === -1 ? display : display.slice(0, sepAt);
        const materialPart =
          sepAt === -1 ? "" : display.slice(sepAt + sep.length).trim();
        const current = materialPart || cfg.options[0] || "";
        cellContent = (
          <div className="flex items-center justify-between gap-2 w-full min-w-0">
            <span className="font-mono-md text-foreground/80 truncate">
              {valuePart || "—"}
            </span>
            <select
              key={display + "-" + idx + "-" + cellIdx}
              defaultValue={current}
              onChange={(e) => handleCellUpdate(idx, cellIdx, e.target.value)}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-xs bg-transparent border-none outline-none cursor-pointer"
            >
              {materialPart && !cfg.options.includes(materialPart) && (
                <option value={materialPart}>{materialPart}</option>
              )}
              {cfg.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        );
      } else if (
        STATUS_COLUMNS.has(header) ||
        categoryOptions?.[header] ||
        fixedDropdownOptions?.[header]
      ) {
        const options = (
          rowDropdownOptions?.(header, row) ||
          fixedDropdownOptions?.[header] ||
          cascadeOptionsFor?.(row, header) ||
          categoryOptions?.[header] ||
          columnUniqueVals[header] ||
          []
        ).filter(Boolean) as string[];
        const showCurrent = display.trim() !== "" && !options.includes(display);
        cellContent = (
          <select
            key={display + "-" + idx + "-" + cellIdx}
            defaultValue={display}
            onChange={(e) => handleCellUpdate(idx, cellIdx, e.target.value)}
            onClick={(e) => e.stopPropagation()}
            className="w-full text-xs bg-transparent border-none outline-none cursor-pointer"
          >
            <option value="">-</option>
            {showCurrent && <option value={display}>{display}</option>}
            {options.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        );
      } else if (multilineEditableColumns?.includes(header)) {
        // Long free-text editable column (e.g. Remarks): word-wrapped, grows
        // with content up to 2 lines then scrolls inside the cell, so the
        // column width and empty-row height stay unchanged.
        cellContent = (
          <textarea
            key={display + "-" + idx + "-" + cellIdx}
            ref={autoGrowCell}
            rows={1}
            defaultValue={display}
            onInput={(e) => autoGrowCell(e.currentTarget)}
            onBlur={(e) => {
              if (e.target.value !== display) {
                handleCellUpdate(idx, cellIdx, e.target.value);
              }
            }}
            className="block w-full max-h-12 p-0 text-xs bg-transparent border-none outline-none resize-none overflow-y-auto overflow-x-hidden cell-scrollable whitespace-pre-wrap leading-normal break-words"
          />
        );
      } else {
        cellContent = (
          <input
            key={display + "-" + idx + "-" + cellIdx}
            type="text"
            defaultValue={display}
            onBlur={(e) => {
              if (e.target.value !== display) {
                handleCellUpdate(idx, cellIdx, e.target.value);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full text-xs bg-transparent border-none outline-none"
          />
        );
      }
    } else if (encodedDropdownColumns?.[header]) {
      const cfg = encodedDropdownColumns[header];
      const sep = cfg.separator ?? "|";
      const sepAt = display.indexOf(sep);
      const valuePart = sepAt === -1 ? display : display.slice(0, sepAt);
      const materialPart =
        sepAt === -1 ? "" : display.slice(sepAt + sep.length).trim();
      cellContent = (
        <div className="flex items-center justify-between gap-2 w-full min-w-0">
          <span className="font-mono-md text-foreground truncate">
            {valuePart || "—"}
          </span>
          <select
            disabled
            defaultValue={materialPart || cfg.options[0] || ""}
            className="shrink-0 text-xs bg-transparent border-none outline-none text-muted-foreground cursor-not-allowed"
          >
            {materialPart && !cfg.options.includes(materialPart) && (
              <option value={materialPart}>{materialPart}</option>
            )}
            {cfg.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
      );
    } else if (STATUS_COLUMNS.has(header)) {
      cellContent = <GMDUpdateStatusBadge value={display || null} />;
    } else if (NUMERIC_COLUMNS.has(header) || numericColumns?.has(header)) {
      cellContent = (
        <span className="font-mono-md text-right text-foreground">
          {display || "—"}
        </span>
      );
    } else if (header === "MAJOR/MINOR MARKING") {
      const isYes = display === "true";
      const isNo = display === "false";
      cellContent = isYes ? (
        <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
          MAJOR
        </span>
      ) : isNo ? (
        <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300">
          MINOR
        </span>
      ) : (
        <span className="block text-gray-400">—</span>
      );
    } else if (isDateHeader(header)) {
      const parsed = parseDate(display);
      cellContent = (
        <span className={textCellClass(scrollable)} title={display}>
          {parsed ? format(parsed, CANONICAL_DATE) : display || "—"}
        </span>
      );
    } else if (header === "ORDER LIST") {
      if (!display) {
        cellContent = (
          <span className="truncate block text-muted-foreground">—</span>
        );
      } else {
        const poIdx = headers.indexOf("PARTY Order No.");
        const poAltIdx = headers.indexOf("PO NO");
        const poVal = String(row[poIdx !== -1 ? poIdx : poAltIdx] ?? "");
        cellContent = <OrderListCell display={display} poNo={poVal} />;
      }
    } else if (imageButtonColumn && header === imageButtonColumn) {
      const drawingIdx = linkedDrawingColumn
        ? headers.indexOf(linkedDrawingColumn)
        : -1;
      cellContent = (
        <ItemImageCell
          code={display}
          images={itemImagesByCode?.[display] ?? []}
          drawingUrl={drawingIdx !== -1 ? String(row[drawingIdx] ?? "") : ""}
        />
      );
    } else if (linkedFilesIconColumn && header === linkedFilesIconColumn) {
      const filesIdx = linkedFilesColumn
        ? headers.indexOf(linkedFilesColumn)
        : -1;
      const files = filesIdx !== -1 ? String(row[filesIdx] ?? "") : "";
      cellContent = (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate" title={display}>
            {display || "—"}
          </span>
          {files.trim() !== "" && (
            <OrderListCell display={files} heading={display} iconOnly />
          )}
        </div>
      );
    } else if (display && isUrl(display)) {
      // Single URL case (non-ORDER LIST columns)
      cellContent = (
        <a
          href={display}
          target="_blank"
          rel="noopener noreferrer"
          className={
            wrapCells
              ? `block break-all ${scrollable ? WRAPPED_CELL_BOX : ""} underline text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200`
              : "truncate block underline text-blue-600 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200"
          }
          title={display}
        >
          {display}
        </a>
      );
    } else if (
      display &&
      display.includes(",") &&
      display.split(",").some((p) => isUrl(p.trim()))
    ) {
      const linksContent = renderLinksCell(display);
      cellContent = linksContent ?? (
        <span className={textCellClass(scrollable)} title={display}>
          {display || "—"}
        </span>
      );
    } else {
      cellContent = (
        <span className={textCellClass(scrollable)} title={display}>
          {display || "—"}
        </span>
      );
    }

    // Decorated AFTER the chain rather than as another else-if on purpose.
    // As a branch it was shadowed by whichever widget branch matched first:
    // imageButtonColumn wins for /contract_review's ITEM_CODE column, and
    // isCellEditable wins for /raw_material's 2nd and 3rd tables (they pass
    // `editable` with no `editableColumns`, which makes every column
    // editable). Wrapping the finished cell keeps whatever the column
    // rendered - image button, input, select, link - and adds the chip.
    const badges = badgesOverride ?? badgesForCell(cellBadges, headers, header, row);
    if (badges.length > 0) {
      cellContent = (
        <span className="flex items-start gap-1.5 min-w-0">
          <span className="min-w-0 flex-1">{cellContent}</span>
          <span className="shrink-0 flex flex-col items-end gap-0.5">
            {badges.map((b, i) => (
              <span
                key={`${b.label}-${i}`}
                title={b.title}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${cellBadgeClass(b.tone)}`}
              >
                {b.label}
              </span>
            ))}
          </span>
        </span>
      );
    }
    return cellContent;
  };

  // Presence toggles for the image-button column. Rendered both for a standalone
  // column header and for the same column when it is a child of a collapsed
  // group (where the group header owns the filter UI).
  const presenceFilterControls = (
    <div className="flex flex-col gap-0.5 mt-1.5">
      <label
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 text-[10px] font-medium normal-case tracking-normal text-foreground/70 cursor-pointer select-none"
        title="Show only rows with an uploaded drawing"
      >
        <input
          type="checkbox"
          checked={presenceFilters.drawing}
          onChange={(e) => {
            setPresenceFilters((p) => ({ ...p, drawing: e.target.checked }));
            setCurrentPage(1);
          }}
          className="accent-[#0070f3] dark:accent-primary"
        />
        Drawing present
      </label>
      <label
        onClick={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 text-[10px] font-medium normal-case tracking-normal text-foreground/70 cursor-pointer select-none"
        title="Show only rows with item images"
      >
        <input
          type="checkbox"
          checked={presenceFilters.image}
          onChange={(e) => {
            setPresenceFilters((p) => ({ ...p, image: e.target.checked }));
            setCurrentPage(1);
          }}
          className="accent-[#0070f3] dark:accent-primary"
        />
        Image present
      </label>
    </div>
  );

  // Checkbox presence filters for batch flags (C / N). Rendered in the
  // item-code header (`batchFilterHeader`) the same way drawing/image are
  // rendered in the image-button column, including inside a collapsed group.
  const batchPresenceControls =
    batchPresenceFilters && batchPresenceFilters.length > 0 ? (
      <div className="flex flex-col gap-0.5 mt-1.5">
        {batchPresenceFilters.map((bf) => (
          <label
            key={bf.key}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 text-[10px] font-medium normal-case tracking-normal text-foreground/70 cursor-pointer select-none"
            title={bf.title}
          >
            <input
              type="checkbox"
              checked={!!batchFilters[bf.key]}
              onChange={(e) => setBatchFilter(bf.key, e.target.checked)}
              className="accent-[#0070f3] dark:accent-primary"
            />
            {bf.label}
          </label>
        ))}
      </div>
    ) : null;

  if (visibleCols.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-xs text-muted-foreground">
        No data available
      </div>
    );
  }

  return (
    <div className={`flex flex-col w-full max-w-full min-w-0 bg-card border border-border rounded-lg shadow-sm ${fullHeight ? "flex-1 min-h-0 overflow-hidden h-full" : ""}`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-border bg-muted">
        <div className="flex items-center gap-2">
          {title && (
            <span className="text-xs font-bold uppercase tracking-wider text-">
              {title}
            </span>
          )}
          <span className="text-xs font-semibold text-foreground/60 mr-10">
            {isServer ? (
              serverMode!.loading ? (
                <span className="inline-flex items-center gap-1.5 text-[#0f62fe] dark:text-blue-300">
                  <Loader2 size={12} className="animate-spin" />
                  Loading page {serverMode!.page}…
                </span>
              ) : (
                <>
                  Showing{" "}
                  {serverMode!.total === 0
                    ? 0
                    : (serverMode!.page - 1) * pageSize + 1}
                  –{Math.min(serverMode!.page * pageSize, serverMode!.total)} of{" "}
                  {serverMode!.total.toLocaleString()} records
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    · page {serverMode!.page} of{" "}
                    {Math.max(1, Math.ceil(serverMode!.total / pageSize))}
                  </span>
                  {serverMode!.refreshing && (
                    <span className="ml-1.5 inline-flex items-center gap-1 font-normal text-muted-foreground">
                      <Loader2 size={10} className="animate-spin" /> refreshing…
                    </span>
                  )}
                </>
              )
            ) : (
              <>Showing {filteredRows.length} of {rows.length} records</>
            )}
          </span>
          {toolbarExtra}
          {usdInrRate != null && (
            <span className="flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-300 bg-card border border-border rounded px-2 py-0.5">
              1 USD = ₹{usdInrRate.toFixed(2)}
              {usdRateNote && (
                <span className="font-normal text-muted-foreground">· {usdRateNote}</span>
              )}
              {onRefreshRate && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshRate();
                  }}
                  className="text-[#0070f3] dark:text-primary hover:text-foreground underline"
                  title="Refresh rate"
                >
                  refresh
                </button>
              )}
            </span>
          )}
          {castingRateInputs && castingRateInputs.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <span className="text-[10px] uppercase tracking-wider">
                Cast Rates
              </span>
              {castingRateInputs.map(({ key, label, value, onChange }) => (
                <label
                  key={key}
                  className="flex items-center gap-1 bg-card border border-border rounded px-1.5 py-0.5 cursor-text"
                >
                  <span className="text-[9px] text-foreground/80">{label}</span>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="0"
                    className="w-14 text-[10px] bg-transparent outline-none text-foreground placeholder:text-foreground/70"
                  />
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {pasteErpCodes && (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={pasteErpCodes.draft}
                onChange={(e) => {
                  e.stopPropagation();
                  pasteErpCodes.setDraft(e.target.value);
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pasteErpCodes.onPaste(e.clipboardData.getData("text"));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    pasteErpCodes.onAdd();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Paste ERP item code..."
                className="w-52 px-2 py-1.5 text-xs border border-border rounded bg-card text-foreground outline-none focus:border-[#0070f3] dark:focus:border-primary placeholder:text-foreground/30"
                title="Paste ERP item code(s) — matching rows move from Filtered Items to this table"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  pasteErpCodes.onAdd();
                }}
                className="flex items-center gap-1 text-xs font-semibold text-[#0f62fe] dark:text-primary hover:text-foreground px-2 py-1.5 rounded hover:bg-card/80 border border-border"
              >
                Add
              </button>
              {onClearMoved && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearMoved();
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-red-800 dark:text-red-300 hover:text-foreground px-2 py-1.5 rounded hover:bg-card/80 border border-border"
                  title="Move all rows back to Filtered Items"
                >
                  <RotateCcw size={12} />
                  Clear moved
                </button>
              )}
            </div>
          )}
          {onImportExcel && (
            <div className="relative">
              <input
                ref={importFileRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportExcel(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  importFileRef.current?.click();
                }}
                className="flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:text-foreground px-2 py-1.5 rounded hover:bg-card/80 border border-border"
                title="Import Excel to fill transferred rows"
              >
                <Upload size={12} />
                Import Excel
              </button>
            </div>
          )}
          {onMatchCosts && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMatchCosts();
              }}
              className="flex items-center gap-1 text-xs font-semibold text-[#0f62fe] dark:text-primary hover:text-foreground px-2 py-1.5 rounded hover:bg-card/80 border border-border"
              title="Match transferred rows (full L1-L8) to New Items and apply their cost"
            >
              <FileText size={12} />
              Match & Update Costs
            </button>
          )}
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-foreground/40"
            />
            <DebouncedSearchInput
              value={globalSearch}
              onCommit={(val) => {
                if (isControlled) filterActions!.onGlobalSearch(val);
                else setLocalGlobalSearch(val);
                setCurrentPage(1);
              }}
              placeholder="Search all columns..."
              className="w-60 pl-8 pr-7 py-1.5 text-xs border border-border rounded bg-card text-foreground outline-none focus:border-[#0070f3] dark:focus:border-primary placeholder:text-foreground/30"
            />
            {globalSearch && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (isControlled) filterActions!.onGlobalSearch("");
                  else setLocalGlobalSearch("");
                  setCurrentPage(1);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-foreground/50 hover:text-foreground transition-colors"
                title="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          {showResetFilters && (
            <button
              onClick={handleResetFilters}
              className="flex items-center gap-1 text-xs font-semibold text-red-800 dark:text-red-300 hover:text-foreground transition-colors px-2 py-1.5 rounded hover:bg-card/80 border border-border"
            >
              <RotateCcw size={12} />
              Reset Filters
            </button>
          )}
          {diffHighlight && diffIdxA !== -1 && diffIdxB !== -1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setHighlightDiff((v) => !v);
              }}
              className={`flex items-center gap-1 text-xs font-semibold px-2 py-1.5 rounded border transition-colors ${
                highlightDiff
                  ? diffHighlight.tone === "amber"
                    ? "bg-amber-500/15 border-amber-400/40 text-amber-700 dark:text-amber-300"
                    : diffHighlight.tone === "yellow"
                      ? "bg-yellow-500/15 border-yellow-400/40 text-yellow-700 dark:text-yellow-300"
                      : "bg-rose-500/15 border-rose-400/40 text-rose-700 dark:text-rose-300"
                  : "border-border text-foreground/70 hover:text-foreground hover:bg-card/80"
              }`}
              title={`Highlight ${diffColA} vs ${diffColB} (trimmed, case-sensitive)`}
            >
              <Highlighter size={12} />
              {diffHighlight.label ?? "Highlight Name Diff"}
            </button>
          )}
          {allowExport && (
          <button
            type="button"
            onClick={handleExportToExcel}
            className="flex items-center gap-1 text-xs font-semibold text-[#0f62fe] dark:text-primary hover:text-foreground transition-colors px-2 py-1.5 rounded hover:bg-card/80 border border-border"
          >
            <Download size={12} />
            Export Excel
          </button>
          )}
        </div>
      </div>

      {/* Scrollable Table */}
      <div
        className={`w-full min-w-0 ${
          fullHeight ? "flex-1 min-h-0 overflow-auto" : "overflow-x-auto overflow-y-auto"
        }`}
        style={fullHeight ? undefined : { height: maxHeight || "50vh" }}
      >
        {" "}
        <table
          className="w-full text-left"
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            {visibleCols.map((col) => (
              <col key={col.idx} style={{ width: `${getColWidth(col)}px` }} />
            ))}
            {onDeleteRow && <col style={{ width: "84px" }} />}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr className="bg-muted">
              {visibleCols.map((col, visIdx) => {
                const { header, idx, group } = col;
                const isSorted = activeSortColumn === idx;
                const uniqueVals = cascadedFilterOptions[header] ?? [];
                const frozenLeft = frozenOffsets[visIdx];

                if (group) {
                  const groupChildren = group.children.map((c) => c.header);
                  const activeCount = groupChildren.filter(
                    (h) =>
                      (multiFilters[h]?.length ?? 0) > 0 ||
                      !!columnFilters[h] ||
                      !!dateRanges[h]?.from ||
                      !!dateRanges[h]?.to ||
                      !!dateRanges[h]?.blank,
                  ).length;
                  const groupIsEditable =
                    editable &&
                    groupChildren.some(
                      (h) =>
                        editableColumns?.includes(h) ||
                        blankOnlyEditableColumns?.includes(h),
                    );
                  const clearGroup = () => {
                    groupChildren.forEach((h) => {
                      handleMultiFilter(h, []);
                      handleColumnFilter(h, "");
                      if (isDateFilterHeader(h)) setDateRange(h, "", "");
                      setDateBlank(h, false);
                    });
                  };
                  return (
                    <th
                      key={idx}
                      className={`relative bg-muted text-foreground text-xs font-bold uppercase tracking-wider px-2.5 py-2 text-left border-b-2 border-border border-r last:border-r-0 select-none align-top${
                        frozenLeft !== undefined ? " sticky z-20" : ""
                      }${groupIsEditable ? " bg-amber-50/50 dark:bg-[color-mix(in_oklch,var(--muted),var(--color-amber-500)_10%)]" : ""}`}
                      style={
                        frozenLeft !== undefined ? { left: frozenLeft } : undefined
                      }
                    >
                      <div
                        className={`flex justify-between gap-1 ${wrapCells ? "items-start" : "items-center"}`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={wrapCells ? "wrap-break-word" : "truncate"}>
                            {group.label}
                          </span>
                          {activeCount > 0 && (
                            <span className="inline-flex items-center justify-center h-4 px-1.5 rounded-full text-[9px] font-bold bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300">
                              {activeCount}
                            </span>
                          )}
                        </div>
                        {activeCount > 0 && (
                          <button
                            type="button"
                            onClick={clearGroup}
                            className="inline-flex items-center gap-0.5 text-[9px] font-medium text-foreground/60 hover:text-red-500 dark:hover:text-red-200 transition-colors"
                            title={`Clear ${group.label} filters`}
                          >
                            <X size={10} />
                            <span>Clear</span>
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-1 mt-1.5">
                        {group.children.map((child) => {
                          const ch = child.header;
                          const childActive =
                            (multiFilters[ch]?.length ?? 0) > 0 ||
                            !!columnFilters[ch] ||
                            !!dateRanges[ch]?.from ||
                            !!dateRanges[ch]?.to ||
                            !!dateRanges[ch]?.blank;
                          const chIdx = headers.indexOf(ch);
                          const childSorted = chIdx !== -1 && activeSortColumn === chIdx;
                          return (
                            <div key={ch} className="min-w-0 flex flex-col gap-1">
                              {isDateFilterHeader(ch) ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="date"
                                    value={dateRanges[ch]?.from ?? (dateFrom || "")}
                                    onChange={(e) =>
                                      setDateRange(
                                        ch,
                                        e.target.value,
                                        dateRanges[ch]?.to ?? (dateTo || ""),
                                      )
                                    }
                                    className="flex-1 min-w-0 text-[10px] border border-border rounded bg-card text-foreground px-1 py-0.5 outline-none"
                                  />
                                  <input
                                    type="date"
                                    value={dateRanges[ch]?.to ?? (dateTo || "")}
                                    onChange={(e) =>
                                      setDateRange(
                                        ch,
                                        dateRanges[ch]?.from ?? (dateFrom || ""),
                                        e.target.value,
                                      )
                                    }
                                    className="flex-1 min-w-0 text-[10px] border border-border rounded bg-card text-foreground px-1 py-0.5 outline-none"
                                  />
                                </div>
                              ) : (
                                <MultiSelect
                                  options={cascadedFilterOptions[ch] ?? []}
                                  selected={multiFilters[ch] ?? []}
                                  onChange={(vals) => handleMultiFilter(ch, vals)}
                                  optionMeta={columnOptionMeta?.[ch]}
                                  optionLabels={
                                    ch === "MAJOR/MINOR MARKING" ? MAJOR_MINOR_FILTER_LABELS : undefined
                                  }
                                  extraOptions={extraFilterOptions?.[ch]}
                                  onOpen={
                                    isServer
                                      ? () => serverMode!.requestFacet(ch)
                                      : undefined
                                  }
                                />
                              )}
                              <div className="flex items-center gap-1">
                                <DebouncedSearchInput
                                  value={columnFilters[ch] ?? ""}
                                  onCommit={(val) => handleColumnFilter(ch, val)}
                                  placeholder={`Search ${ch}...`}
                                />
                                {childActive && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleColumnFilter(ch, "");
                                      handleMultiFilter(ch, []);
                                      if (isDateFilterHeader(ch))
                                        setDateRange(ch, "", "");
                                      setDateBlank(ch, false);
                                    }}
                                    className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-foreground/50 hover:text-foreground transition-colors"
                                    title={`Clear ${ch} filter`}
                                  >
                                    <X size={10} />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (chIdx !== -1) handleSort(chIdx);
                                  }}
                                  className={`shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-accent transition-colors ${
                                    childSorted
                                      ? "text-foreground"
                                      : "text-foreground/50 hover:text-foreground"
                                  }`}
                                  title={`Sort by ${ch}`}
                                >
                                  {childSorted ? (
                                    activeSortDirection === "asc" ? (
                                      <ChevronUp size={10} />
                                    ) : (
                                      <ChevronDown size={10} />
                                    )
                                  ) : (
                                    <ArrowUpDown size={10} />
                                  )}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {imageButtonColumn &&
                        group.children.some(
                          (c) => c.header === imageButtonColumn,
                        ) && presenceFilterControls}
                      {batchFilterHeader &&
                        group.children.some(
                          (c) => c.header === batchFilterHeader,
                        ) && batchPresenceControls}

                      <div
                        onMouseDown={(e) => handleResizeStart(idx, e)}
                        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 group"
                        style={{ marginRight: "-3px" }}
                      >
                        <div className="absolute top-0 -left-1 w-3.5 h-full" />
                        <div className="absolute right-0.5 top-0 w-0.5 h-full bg-transparent group-hover:bg-[#0070f3] group-active:bg-[#0070f3] dark:group-hover:bg-primary dark:group-active:bg-primary transition-colors" />
                      </div>
                    </th>
                  );
                }

                return (
                  <th
                    key={idx}
                    className={`relative bg-muted text-foreground text-xs font-bold uppercase tracking-wider px-3 py-2 text-left border-b-2 border-border border-r  last:border-r-0 select-none align-top${
                      frozenLeft !== undefined ? " sticky z-20" : ""
                    }${
                      editable &&
                      (!editableColumns ||
                        editableColumns.includes(header) ||
                        blankOnlyEditableColumns?.includes(header))
                        ? " bg-amber-50/50 dark:bg-[color-mix(in_oklch,var(--muted),var(--color-amber-500)_10%)]"
                        : ""
                    }`}
                    style={
                      frozenLeft !== undefined ? { left: frozenLeft } : undefined
                    }
                  >
                    <div
                      className={`flex justify-between gap-1.5 cursor-pointer ${wrapCells ? "items-start" : "items-center"}`}
                      onClick={() => handleSort(idx)}
                    >
                      <span className={wrapCells ? "wrap-break-word" : "truncate"}>
                        {header}
                      </span>
                      {isSorted && (
                        <span className="shrink-0 text-[10px] text-foreground">
                          {activeSortDirection === "asc" ? (
                            <ChevronUp size={10} />
                          ) : (
                            <ChevronDown size={10} />
                          )}
                        </span>
                      )}
                    </div>
                    {/* Column filter */}
                    {!hiddenFilters?.includes(header) &&
                      !(
                        attachmentColumn &&
                        header === attachmentColumn &&
                        onUploadAttachment &&
                        !filterAttachmentColumn
                      ) &&
                      (isDateFilterHeader(header) ? (
                        <div className="flex flex-col gap-1 mt-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              type="date"
                              value={
                                dateRanges[header]?.from ??
                                (dateFrom || "")
                              }
                              onChange={(e) =>
                                setDateRange(
                                  header,
                                  e.target.value,
                                  dateRanges[header]?.to ?? (dateTo || ""),
                                )
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 text-[10px] border border-border rounded bg-card text-foreground px-1 py-0.5 outline-none"
                            />
                            <input
                              type="date"
                              value={
                                dateRanges[header]?.to ?? (dateTo || "")
                              }
                              onChange={(e) =>
                                setDateRange(
                                  header,
                                  dateRanges[header]?.from ??
                                    (dateFrom || ""),
                                  e.target.value,
                                )
                              }
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 text-[10px] border border-border rounded bg-card text-foreground px-1 py-0.5 outline-none"
                            />
                          </div>
                          {header === "DATE OF CONTRACT" && (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-[10px] text-foreground/70 cursor-pointer select-none"
                              title="Show only rows with no date of contract"
                            >
                              <input
                                type="checkbox"
                                checked={!!dateRanges[header]?.blank}
                                onChange={(e) =>
                                  setDateBlank(header, e.target.checked)
                                }
                                className="accent-[#0070f3] dark:accent-primary"
                              />
                              Blanks
                            </label>
                          )}
                          <div className="flex items-center gap-1">
                            <DebouncedSearchInput
                              value={columnFilters[header] ?? ""}
                              onCommit={(val) =>
                                handleColumnFilter(header, val)
                              }
                              placeholder={`Search ${header}...`}
                            />
                            {(columnFilters[header] ||
                              dateFrom ||
                              dateTo ||
                              dateRanges[header]?.from ||
                              dateRanges[header]?.to ||
                              dateRanges[header]?.blank) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleColumnFilter(header, "");
                                  setDateRange(header, "", "");
                                }}
                                className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-foreground/50 hover:text-foreground transition-colors"
                                title="Clear filter"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : bomIdCategoryFilter && header === "BOM ID" ? (
                        <div className="flex flex-col gap-1 mt-1.5">
                          <select
                            value={columnFilters["BOM ID"] ?? "All"}
                            onChange={(e) => {
                              e.stopPropagation();
                              handleColumnFilter("BOM ID", e.target.value);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full text-[10px] border border-border rounded bg-card text-foreground px-1 py-0.5 outline-none cursor-pointer"
                            title="Filter by BOM ID availability"
                          >
                            <option value="All">All</option>
                            {BOM_ID_FILTER_VALUES.filter(
                              (v) => v !== "All",
                            ).map((v) => (
                              <option key={v} value={v}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1 mt-1.5">
                          {header === "ERP CODE" && duplicateErpHighlight && (
                            <label
                              onClick={(e) => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-[10px] font-medium normal-case tracking-normal text-foreground/70 cursor-pointer select-none"
                              title="Show only rows sharing location & L-columns with a different ERP code"
                            >
                              <input
                                type="checkbox"
                                checked={showOnlyDuplicateErp}
                                onChange={(e) => {
                                  setShowOnlyDuplicateErp(e.target.checked);
                                  setCurrentPage(1);
                                }}
                                className="accent-amber-600 dark:accent-amber-400"
                              />
                              Duplicates only
                            </label>
                          )}
                          <MultiSelect
                            options={
                              filterAttachmentColumn &&
                              attachmentColumn &&
                              header === attachmentColumn
                                ? ["Has Drawing", "No Drawing"]
                                : uniqueVals
                            }
                            selected={multiFilters[header] ?? []}
                            onChange={(vals) => handleMultiFilter(header, vals)}
                            optionMeta={columnOptionMeta?.[header]}
                            optionLabels={
                              header === "MAJOR/MINOR MARKING" ? MAJOR_MINOR_FILTER_LABELS : undefined
                            }
                            extraOptions={extraFilterOptions?.[header]}
                            hideBlank={
                              !!filterAttachmentColumn &&
                              !!attachmentColumn &&
                              header === attachmentColumn
                            }
                            onOpen={
                              isServer
                                ? () => serverMode!.requestFacet(header)
                                : undefined
                            }
                          />
                          <div className="flex items-center gap-1">
                            <DebouncedSearchInput
                              value={columnFilters[header] ?? ""}
                              onCommit={(val) =>
                                handleColumnFilter(header, val)
                              }
                              placeholder={`Search ${header}...`}
                            />
                            {columnFilters[header] && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleColumnFilter(header, "");
                                }}
                                className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-accent text-foreground/50 hover:text-foreground transition-colors"
                                title="Clear filter"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    {imageButtonColumn === header && presenceFilterControls}
                    {batchFilterHeader === header && batchPresenceControls}
                    {header === "PBG AMOUNT" && pbgAmountSum !== null && (
                      <div className="mt-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                        Total :  {"  "}
                        {pbgAmountSum.toLocaleString("en-IN", {
                          maximumFractionDigits: 1,
                        })}
                      </div>
                    )}
                    {/* Resize handle */}
                    <div
                      onMouseDown={(e) => handleResizeStart(idx, e)}
                      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-20 group"
                      style={{ marginRight: "-3px" }}
                    >
                      <div className="absolute top-0 -left-1 w-3.5 h-full" />
                      <div className="absolute right-0.5 top-0 w-0.5 h-full bg-transparent group-hover:bg-[#0070f3] group-active:bg-[#0070f3] dark:group-hover:bg-primary dark:group-active:bg-primary transition-colors" />
                    </div>
                  </th>
                );
              })}
              {onDeleteRow && (
                <th className="relative bg-muted text-foreground text-xs font-bold uppercase tracking-wider px-3 py-2 text-center border-b-2 border-border select-none align-top">
                  Delete
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {paginatedWithIds.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleCols.length + (onDeleteRow ? 1 : 0)}
                  className="h-24 text-center text-xs text-muted-foreground"
                >
                  No matching rows
                </td>
              </tr>
            ) : (
              paginatedWithIds.map(({ row, id }, idx) => {
                const isWarned = !!id && !!warningRowIds?.has(id);
                const isDuplicate = duplicateRowSet.has(row);
                return (
                <tr
                  key={id ?? idx}
                  className={`transition-colors cursor-pointer ${
                    selectedIndex === idx
                      ? "bg-blue-50 dark:bg-blue-500/10"
                      : isDuplicate
                        ? "bg-yellow-100 dark:bg-yellow-500/10 hover:bg-yellow-200 dark:hover:bg-yellow-500/20"
                        : "hover:bg-muted/60"
                  }`}
                  onClick={() => onSelect(idx)}
                >
                  {visibleCols.map((col, visIdx) => {
                    const { header, idx: cellIdx, group } = col;

                    const mergedKey = `${idx}:${cellIdx}`;
                    const isMergedCell =
                      isGrouped && mergeIdxSet.has(cellIdx);
                    if (isMergedCell && mergedSkipped.has(mergedKey)) {
                      return null;
                    }
                    const mergedSpan = isMergedCell
                      ? (mergedSpans.get(mergedKey) ?? undefined)
                      : undefined;

                    // A merged cell renders once (rowSpan), so a per-row badge
                    // check would only ever see the group's first row. Aggregate
                    // instead: show a chip if ANY row in the merge group carries
                    // it. Unmerged cells fall back to the per-row check in
                    // renderCellContent.
                    let mergedBadges: CellBadge[] | undefined;
                    if (isMergedCell && mergedSpan && mergedSpan > 1) {
                      const end = Math.min(
                        idx + mergedSpan,
                        paginatedWithIds.length,
                      );
                      const seen = new Set<string>();
                      const collected: CellBadge[] = [];
                      for (let k = idx; k < end; k++) {
                        for (const b of badgesForCell(
                          cellBadges,
                          headers,
                          header,
                          paginatedWithIds[k].row,
                        )) {
                          if (seen.has(b.label)) continue;
                          seen.add(b.label);
                          collected.push(b);
                        }
                      }
                      if (collected.length > 0) mergedBadges = collected;
                    }

                    const groupIsEditable = group
                      ? group.children.some((c) => {
                          const { isCellEditable: cEditable } = cellMeta(
                            c.header,
                            headers.indexOf(c.header),
                            row,
                          );
                          return cEditable;
                        })
                      : false;
                    const { isCellEditable, isPnBlankDropdown } = cellMeta(
                      header,
                      cellIdx,
                      row,
                    );

                    const cellContent: React.ReactNode = group ? (
                      <div
                        className={
                          wrapCells
                            ? `flex flex-col gap-1 min-w-0 ${WRAPPED_CELL_BOX}`
                            : "flex flex-col gap-1"
                        }
                      >
                        {group.children.map((child) => {
                          const childIdx = headers.indexOf(child.header);
                          if (childIdx === -1) return null;
                          const childContent = renderCellContent(
                            child.header,
                            childIdx,
                            row,
                            id,
                            idx,
                            false,
                          );
                          if (child.plain) {
                            // Bare line: no caption, no border box. The parent
                            // group caption already names the field, and the
                            // header stays available as a tooltip. shrink-0 so
                            // the line cannot be squashed by the capped scroll
                            // box on the container.
                            return (
                              <div
                                key={child.header}
                                title={child.header}
                                className="shrink-0 min-w-0 text-xs text-foreground"
                              >
                                {childContent}
                              </div>
                            );
                          }
                          return (
                            <div
                              key={child.header}
                              title={child.header}
                              className={`flex items-center gap-1 min-w-0 rounded border border-border bg-card px-1.5 py-0.5 hover:border-muted-foreground/50 transition-colors${
                                // The group container is a capped column flex box
                                // once wrapCells is on; without this a child could be
                                // squashed to fit the cap instead of scrolling.
                                wrapCells ? " shrink-0" : ""
                              }`}
                            >
                              <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-foreground/55">
                                {child.label ?? child.header}
                              </span>
                              <span className="flex-1 min-w-0 text-xs text-foreground">
                                {childContent}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      renderCellContent(
                        header,
                        cellIdx,
                        row,
                        id,
                        idx,
                        true,
                        mergedBadges,
                      )
                    );

                    const frozenLeft = frozenOffsets[visIdx];

                    // One background per cell: a translucent tint would let the
                    // columns scrolling under a sticky cell show through, and
                    // stacking bg-card with a bg-* highlight makes the winner
                    // depend on stylesheet order. So pick a single opaque class.
                    const rowIsDiff = isDiffCol(header) && rowDiffers(row);
                    const diffBg =
                      diffHighlight?.tone === "amber"
                        ? "bg-amber-200 dark:bg-amber-800"
                        : diffHighlight?.tone === "yellow"
                          ? "bg-yellow-200 dark:bg-yellow-800"
                          : "bg-rose-100 dark:bg-rose-900";
                    const editableBg =
                      isCellEditable || isPnBlankDropdown || groupIsEditable
                        ? "bg-amber-50 dark:bg-[color-mix(in_oklch,var(--card),var(--color-amber-500)_10%)]"
                        : "";
                    const bgClass = rowIsDiff
                      ? diffBg
                      : isWarned
                        ? "bg-amber-100 dark:bg-amber-500/15"
                        : isDuplicate
                          ? "bg-yellow-100 dark:bg-yellow-500/10"
                          : editableBg
                            ? editableBg
                            : frozenLeft !== undefined
                              ? "bg-card"
                              : "";

                    return (
                      <td
                        key={cellIdx}
                        rowSpan={mergedSpan}
                        className={`${group ? "px-2" : "px-3"} py-2 text-xs border-b border-border border-r  last:border-r-0${
                          wrapCells ? " align-top" : ""
                        }${
                          frozenLeft !== undefined ? " sticky z-10" : ""
                        } ${bgClass}`}
                        style={
                          frozenLeft !== undefined ? { left: frozenLeft } : undefined
                        }
                      >
                        {header === warningColumn && isWarned ? (
                          <span
                            className="flex items-center gap-1.5 min-w-0"
                            title={
                              warningTitle ?? "Duplicate derived item name"
                            }
                          >
                            <AlertTriangle
                              size={13}
                              className="shrink-0 text-amber-600 dark:text-amber-400"
                            />
                            <span className="min-w-0 flex-1">
                              {cellContent}
                            </span>
                          </span>
                        ) : header === "ERP CODE" && isDuplicate ? (
                          <span
                            className="flex items-center gap-1.5 min-w-0"
                            title="Same location & L-columns as another row with a different ERP code"
                          >
                            <AlertTriangle
                              size={13}
                              className="shrink-0 text-amber-600 dark:text-amber-400"
                            />
                            <span className="min-w-0 flex-1">
                              {cellContent}
                            </span>
                          </span>
                        ) : (
                          cellContent
                        )}
                      </td>
                    );
                  })}
                  {onDeleteRow && (
                    <td className="px-2 py-2 text-xs border-b border-border text-center bg-card">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(id);
                        }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded border border-rose-200 dark:border-rose-500/25 bg-card text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/20 hover:text-rose-700 dark:hover:text-rose-200 transition-colors cursor-pointer"
                        title="Delete row"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <Pagination
        total={totalRecords}
        currentPage={activePage}
        pageSize={pageSize}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />
      {onDeleteRow && (
        <Dialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
          <DialogContent className="sm:max-w-105 p-0 gap-0 overflow-hidden">
            <DialogHeader className="px-4 pt-4 pb-3 border-b border-border bg-muted">
              <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
                <Trash2 size={16} className="text-rose-600 dark:text-rose-300" />
                Delete transferred row?
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {confirmDeleteRow?.erpCode
                  ? `ERP ${confirmDeleteRow.erpCode} — this will permanently remove the row and its S3 attachment (if any).`
                  : "This will permanently remove the row and its S3 attachment (if any)."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-end gap-2 px-4 py-3">
              <Button variant="outline" size="sm" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="bg-rose-600 dark:bg-rose-500/80 hover:bg-rose-700 dark:hover:bg-rose-500 text-white"
                onClick={async () => {
                  if (!confirmDeleteId) return;
                  const targetId = confirmDeleteId;
                  setConfirmDeleteId(null);
                  await onDeleteRow(targetId);
                }}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}



