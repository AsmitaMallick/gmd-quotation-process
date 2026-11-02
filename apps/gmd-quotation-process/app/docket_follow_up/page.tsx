"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  AlertCircle,
  FileCheck,
  Inbox,
  Clock,
  Send,
  Layers,
  FileWarning,
  Paperclip,
  CheckCircle2,
  Zap,
} from "lucide-react";
import { Button } from "@gmd/ui/components/button";
import { Card, CardContent } from "@gmd/ui/components/card";
import DocketFollowUpTable from "@/components/docket_follow_up/DocketFollowUpTable";
import PendingDocketsTable, { PendingDocketRow } from "@/components/docket_follow_up/PendingDocketsTable";

interface SummaryData {
  totalEnquiries: number;
  actionPendingCount: number;
  withEmailCount: number;
  fileSentCount: number;
  quotationSentCount: number;
  partyReplyCount: number;
  awaitingReplyCount: number;
  overdueReplyCount: number;
  repliedCount: number;
}

interface PendingSummaryData {
  totalPending: number;
  unrepliedRequestsCount: number;
  noDocketAssignedCount: number;
  docketAssignedLaterCount: number;
  aiValidationEnabled?: boolean;
  aiVerifiedCount?: number;
  aiUnverifiedCount?: number;
  aiPendingCount?: number;
  aiRejectedCount?: number;
  aiMaxAttempts?: number;
}

export default function DocketFollowUpPage() {
  const [activeTab, setActiveTab] = useState<"PORTAL_DOCKETS" | "PENDING_DOCKETS">("PENDING_DOCKETS");

  // Portal Dockets State
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [rows, setRows] = useState<any[]>([]);

  // Pending Dockets State
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingSummary, setPendingSummary] = useState<PendingSummaryData | null>(null);
  const [pendingRows, setPendingRows] = useState<PendingDocketRow[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const pendingPollCount = useRef(0);
  const activeTabRef = useRef(activeTab);

  const fetchPortalData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch("/api/docket-follow-up", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP error ${res.status}`);
      }
      const data = await res.json();
      setSummary(data.summary);
      setRows(data.rows || []);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setError("Portal dockets request timed out. Please retry.");
      } else {
        console.error("Failed to load docket follow-up data:", err);
        setError(err?.message || "Failed to load docket follow-up data");
      }
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }, []);

  const fetchPendingData = useCallback(async () => {
    setPendingLoading(true);
    setPendingError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch("/api/docket-follow-up/pending-dockets", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP error ${res.status}`);
      }
      const data = await res.json();
      setPendingSummary(data.summary);
      setPendingRows(data.rows || []);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setPendingError("Pending dockets request timed out. Please retry.");
      } else {
        console.error("Failed to load pending dockets data:", err);
        setPendingError(err?.message || "Failed to load pending dockets data");
      }
    } finally {
      clearTimeout(timeout);
      setPendingLoading(false);
    }
  }, []);

  const handleSyncAndDetect = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsSyncing(true);
    setSyncStatus("Detecting dockets & syncing...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60_000);
    try {
      const res = await fetch("/api/scheduler/docket-followup", {
        method: "POST",
        headers: { "x-app-source": "gmd-dashboard" },
        signal: controller.signal,
      });
      if (res.ok) {
        await res.json();
        setSyncStatus("Sync completed");
      }
    } catch (err) {
      if ((err as any)?.name === "AbortError") {
        console.warn("Auto sync timed out");
      } else {
        console.error("Auto sync failed:", err);
      }
    } finally {
      clearTimeout(timeout);
      if (!isSilent) setIsSyncing(false);
      if (activeTabRef.current === "PORTAL_DOCKETS") fetchPortalData();
      fetchPendingData();
      setTimeout(() => setSyncStatus(null), 4000);
    }
  }, [fetchPortalData, fetchPendingData]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    // Fast first paint: the Pending tab is the default and uses the narrow
    // cached query. The heavy Portal query is loaded lazily when its tab opens.
    const kick = setTimeout(() => {
      fetchPendingData();

      // Automatic detection for new mail: at most once per 10 minutes per tab.
      // Fire-and-forget so the page never waits on it.
      const lastDetect = Number(sessionStorage.getItem("docket-followup-sync-at") || 0);
      if (Date.now() - lastDetect > 10 * 60_000) {
        sessionStorage.setItem("docket-followup-sync-at", String(Date.now()));
        void handleSyncAndDetect(true);
      }
    }, 0);

    // 1-Hour Automatic Sync Interval (Runs in background every 60 minutes)
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const intervalId = setInterval(() => {
      console.log("[Auto-Sync] Running 1-hour docket follow-up sync...");
      handleSyncAndDetect(true);
    }, ONE_HOUR_MS);

    return () => {
      clearTimeout(kick);
      clearInterval(intervalId);
    };
  }, [fetchPendingData, handleSyncAndDetect]);

  // Load the Portal Dockets data only when that tab is opened (it is a much
  // heavier query over all enquiries/threads).
  useEffect(() => {
    if (activeTab !== "PORTAL_DOCKETS") return;
    const id = setTimeout(() => fetchPortalData(), 0);
    return () => clearTimeout(id);
  }, [activeTab, fetchPortalData]);

  // While the Pending Dockets tab is open and the background queue still has
  // eligible threads, refresh quietly (never blanks the table) so verdicts
  // appear without a manual refresh. Stops once all are decided/exhausted.
  useEffect(() => {
    if (activeTab !== "PENDING_DOCKETS") {
      pendingPollCount.current = 0;
      return;
    }
    if (pendingLoading) return;
    if (!pendingSummary?.aiValidationEnabled) return;

    const remaining = pendingSummary.aiPendingCount ?? 0;
    if (remaining <= 0) {
      pendingPollCount.current = 0;
      return;
    }
    if (pendingPollCount.current >= 30) return;

    const id = setTimeout(() => {
      pendingPollCount.current += 1;
      fetchPendingData();
    }, 10000);

    return () => clearTimeout(id);
  }, [
    activeTab,
    pendingLoading,
    pendingSummary?.aiValidationEnabled,
    pendingSummary?.aiPendingCount,
    fetchPendingData,
  ]);

  const handleRefresh = () => {
    if (activeTab === "PORTAL_DOCKETS") {
      fetchPortalData();
    } else {
      fetchPendingData();
    }
  };

  const isCurrentLoading = activeTab === "PORTAL_DOCKETS" ? loading : pendingLoading;

  return (
    <div className="flex-1 min-h-0 flex flex-col h-[calc(100vh-65px)] overflow-hidden bg-background">
      {/* Top Header - with Section Switcher Tabs */}
      <div className="border-b border-border bg-card px-6 py-2 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-foreground">
                Docket Follow Up
              </h1>
              {/* Tab Selector Buttons */}
              <div className="flex items-center p-0.5 rounded-lg bg-muted border border-border">
                <button
                  onClick={() => setActiveTab("PORTAL_DOCKETS")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === "PORTAL_DOCKETS"
                      ? "bg-card text-foreground shadow-2xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Inbox className="w-3.5 h-3.5 text-blue-600" />
                  <span>Portal Dockets ({summary?.totalEnquiries ?? 0})</span>
                </button>

                <button
                  onClick={() => setActiveTab("PENDING_DOCKETS")}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeTab === "PENDING_DOCKETS"
                      ? "bg-card text-foreground shadow-2xs font-bold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <FileWarning className="w-3.5 h-3.5 text-rose-600" />
                  <span>Pending Dockets</span>
                  <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold border border-rose-300/60">
                    {pendingSummary?.totalPending ?? pendingRows.length}
                  </span>
                </button>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground mt-0.5">
              {activeTab === "PORTAL_DOCKETS"
                ? "Track communication threads, quotation attachments, and client reply turnarounds against all portal dockets."
                : "Monitor unreplied docket creation requests, pending client RFQ emails, and conversation file attachments."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {syncStatus && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 animate-pulse hidden sm:inline">
                {syncStatus}
              </span>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={() => handleSyncAndDetect(false)}
              disabled={isSyncing || isCurrentLoading}
              className="h-7 px-2.5 text-xs font-medium cursor-pointer bg-blue-600 hover:bg-blue-700 text-white"
              title="Scan all threads, attachment names & OCR to detect dockets and update pending status"
            >
              <Zap className={`w-3 h-3 mr-1 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Syncing..." : "Sync & Detect"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isCurrentLoading || isSyncing}
              className="h-7 px-2.5 text-xs font-medium cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isCurrentLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 min-h-0 px-6 py-2.5 flex flex-col space-y-2 overflow-hidden w-full">
        {/* ===================== TAB 1: PORTAL DOCKETS ===================== */}
        {activeTab === "PORTAL_DOCKETS" && (
          <>
            {/* Metric Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 shrink-0">
              {/* Card 1: Total Dockets */}
              <Card className="border border-border/80 shadow-2xs bg-card">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
                    <Inbox className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Total Dockets
                    </div>
                    <div className="text-base font-bold text-foreground leading-tight">
                      {loading ? "..." : summary?.totalEnquiries ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: Action Pending */}
              <Card className="border border-rose-200 dark:border-rose-900/40 shadow-2xs bg-rose-50/40 dark:bg-rose-950/20">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
                      Action Pending
                    </div>
                    <div className="text-base font-bold text-rose-700 dark:text-rose-400 leading-tight">
                      {loading ? "..." : summary?.actionPendingCount ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 3: Quotation Sent */}
              <Card className="border border-emerald-200 dark:border-emerald-900/40 shadow-2xs bg-emerald-50/40 dark:bg-emerald-950/20">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <FileCheck className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      Quote Sent
                    </div>
                    <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 leading-tight">
                      {loading ? "..." : summary?.quotationSentCount ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 4: Party Replies Arrived */}
              <Card className="border border-blue-200 dark:border-blue-900/40 shadow-2xs bg-blue-50/40 dark:bg-blue-950/20">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 shrink-0">
                    <Send className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                      Reply Arrived
                    </div>
                    <div className="text-base font-bold text-blue-700 dark:text-blue-400 leading-tight">
                      {loading ? "..." : summary?.partyReplyCount ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 5: Awaiting Reply */}
              <Card className="border border-amber-200 dark:border-amber-900/40 shadow-2xs bg-amber-50/40 dark:bg-amber-950/20 col-span-2 sm:col-span-1">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0">
                    <Clock className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                      Awaiting Reply
                    </div>
                    <div className="text-base font-bold text-amber-700 dark:text-amber-400 leading-tight">
                      {loading ? "..." : summary?.awaitingReplyCount ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Error Alert */}
            {error && (
              <div className="p-2.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Main Table Container */}
            {loading ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground space-y-2 bg-card rounded-md border border-border">
                <RefreshCw className="w-7 h-7 animate-spin text-blue-600" />
                <p className="text-xs font-medium">Analyzing docket communication threads & attachments...</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                <DocketFollowUpTable rows={rows} />
              </div>
            )}
          </>
        )}

        {/* ===================== TAB 2: PENDING DOCKETS ===================== */}
        {activeTab === "PENDING_DOCKETS" && (
          <>
            {/* Pending Metrics KPI Summary Cards - Compact & Clean */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 shrink-0">
              {/* Card 1: Total Pending */}
              <Card className="border border-border/80 shadow-2xs bg-card">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Total Requests
                    </div>
                    <div className="text-base font-bold text-foreground leading-tight">
                      {pendingLoading ? "..." : pendingSummary?.totalPending ?? pendingRows.length}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 2: No Docket in DB */}
              <Card className="border border-rose-200 dark:border-rose-900/40 shadow-2xs bg-rose-50/40 dark:bg-rose-950/20">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-rose-500/15 text-rose-600 dark:text-rose-400 shrink-0">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
                      No Docket Assigned
                    </div>
                    <div className="text-base font-bold text-rose-700 dark:text-rose-400 leading-tight">
                      {pendingLoading ? "..." : pendingSummary?.noDocketAssignedCount ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Card 3: Stamped in DB */}
              <Card className="border border-blue-200 dark:border-blue-900/40 shadow-2xs bg-blue-50/40 dark:bg-blue-950/20">
                <CardContent className="p-2 px-3 flex items-center gap-2.5">
                  <div className="p-1.5 rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-400 shrink-0">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                      Docket Stamped in DB
                    </div>
                    <div className="text-base font-bold text-blue-700 dark:text-blue-400 leading-tight">
                      {pendingLoading ? "..." : pendingSummary?.docketAssignedLaterCount ?? 0}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Error Alert */}
            {pendingError && (
              <div className="p-2.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs flex items-center gap-2 shrink-0">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pendingError}</span>
              </div>
            )}

            {/* Main Pending Dockets Table */}
            {pendingLoading && pendingRows.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-muted-foreground space-y-2 bg-card rounded-md border border-border">
                <RefreshCw className="w-7 h-7 animate-spin text-rose-600" />
                <p className="text-xs font-medium">Fetching unreplied docket requests & conversation attachments...</p>
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {pendingLoading && pendingRows.length > 0 && (
                  <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium text-muted-foreground border-b border-border bg-muted/20 shrink-0">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Refreshing…
                  </div>
                )}
                <PendingDocketsTable rows={pendingRows} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
