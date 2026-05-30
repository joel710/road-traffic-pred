// src/components/traffic/TrafficDashboard.tsx
'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { ArrowLeft, Play, Pause, AlertTriangle, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Junction, RouteSegment, ModelMetrics } from '@/types/traffic';
import Sidebar from './Sidebar';
import ParadigmSwitcher from './ParadigmSwitcher';
import TimeSlider from './TimeSlider';

const TrafficMap = dynamic(() => import('./TrafficMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-slate-800 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-xs text-slate-400 font-medium animate-pulse">Initializing Neural Map Grid...</p>
      </div>
    </div>
  ),
});

// Real Paris Roundabouts & Junctions coordinates (well-mapped, exact)
const JUNCTION_META: Record<string, { name: string; lat: number; lng: number }> = {
  J1: { name: 'J1 - Gare du Nord', lat: 48.8866, lng: 2.3522 },
  J2: { name: 'J2 - Champs-Élysées', lat: 48.8696, lng: 2.3076 },
  J3: { name: "J3 - Place d'Italie", lat: 48.8266, lng: 2.3552 },
  J4: { name: 'J4 - Bastille', lat: 48.8536, lng: 2.3792 },
};

// Complete real-route connections
const ROUTE_DEFS: { from: string; to: string }[] = [
  { from: 'J1', to: 'J2' },
  { from: 'J2', to: 'J4' },
  { from: 'J1', to: 'J4' },
  { from: 'J3', to: 'J4' },
  { from: 'J1', to: 'J3' },
  { from: 'J2', to: 'J3' },
];

// Model metrics from README_MODEL.md — based on training evaluation across all junctions
const globalMetrics: ModelMetrics = { mae: 2.61, rmse: 3.48, accuracy: 89.2 };
const specificMetrics: ModelMetrics = { mae: 3.46, rmse: 4.32, accuracy: 86.1 };

// Thresholds matching the backend Spark processor (vehicles per junction)
const calcStatus = (v: number): 'fluid' | 'moderate' | 'congested' =>
  v >= 60 ? 'congested' : v >= 30 ? 'moderate' : 'fluid';

const calcTrend = (pred: number, cur: number): 'up' | 'down' | 'stable' =>
  pred > cur ? 'up' : pred < cur ? 'down' : 'stable';

const buildInitialJunctions = (): Junction[] =>
  Object.entries(JUNCTION_META).map(([id, meta]) => ({
    id,
    name: meta.name,
    lat: meta.lat,
    lng: meta.lng,
    currentFlow: 0,
    predictedFlow: 0,
    trend: 'stable' as const,
    status: 'fluid' as const,
  }));

const buildInitialRoutes = (): RouteSegment[] =>
  ROUTE_DEFS.map((r) => ({ from: r.from, to: r.to, flow: 0, status: 'fluid' as const }));

type WsPayload = {
  Junction: number;
  Vehicles: number;
  PredictedVehicles: number;
  Status: string;
  DateTime: string;
};

export function TrafficDashboard({ initialJunction }: { initialJunction?: number }) {
  const [junctions, setJunctions] = useState<Junction[]>(buildInitialJunctions);
  const [routes, setRoutes] = useState<RouteSegment[]>(buildInitialRoutes);
  const [selectedJunction, setSelectedJunction] = useState<string | null>(
    initialJunction ? `J${initialJunction}` : null
  );
  const [modelType, setModelType] = useState<'global' | 'specific'>('global');
  const [currentTime, setCurrentTime] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const modelMetrics = useMemo(() => (modelType === 'global' ? globalMetrics : specificMetrics), [modelType]);

  // ─── WebSocket: connect to FastAPI backend ──────────────────
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//localhost:8000/ws/traffic`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: WsPayload = JSON.parse(event.data);
          if (data.Junction == null) return;

          const junctionId = `J${data.Junction}`;

          // Only process J1-J4 junctions
          if (!JUNCTION_META[junctionId]) return;

          setJunctions((prev) =>
            prev.map((j) => {
              if (j.id !== junctionId) return j;
              const newFlow = data.Vehicles ?? j.currentFlow;
              const predFlow = data.PredictedVehicles ?? j.predictedFlow;
              // Use backend Status (fluid/moderate/congested), fallback to local calc
              const backendStatus = data.Status?.toLowerCase();
              const status =
                backendStatus === 'fluid' || backendStatus === 'moderate' || backendStatus === 'congested'
                  ? backendStatus
                  : calcStatus(predFlow);
              return {
                ...j,
                currentFlow: newFlow,
                predictedFlow: predFlow,
                status,
                trend: calcTrend(predFlow, newFlow),
              };
            }),
          );
        } catch (e) {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        setTimeout(connect, 5000);
      };

      ws.onerror = () => ws.close();
    };

    connect();
    return () => wsRef.current?.close();
  }, []);

  // ─── Initial data fetch (REST fallback) ─────────────────────
  useEffect(() => {
    fetch('http://localhost:8000/traffic/current')
      .then((r) => r.json())
      .then((data: WsPayload[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setJunctions((prev) =>
            prev.map((j) => {
              const match = data.find((d) => `J${d.Junction}` === j.id);
              if (!match) return j;
              const flow = match.Vehicles ?? j.currentFlow;
              const pred = match.PredictedVehicles ?? j.predictedFlow;
              return { ...j, currentFlow: flow, predictedFlow: pred, status: calcStatus(pred), trend: calcTrend(pred, flow) };
            }),
          );
        }
      })
      .catch(() => { /* API not available yet, use defaults */ });
  }, []);

  // ─── Recalculate routes whenever junctions change ───────────
  useEffect(() => {
    setRoutes((prev) =>
      prev.map((route) => {
        const jFrom = junctions.find((j) => j.id === route.from);
        const jTo = junctions.find((j) => j.id === route.to);
        const avg = Math.round(((jFrom?.currentFlow ?? 0) + (jTo?.currentFlow ?? 0)) / 2);
        return { ...route, flow: avg, status: calcStatus(avg) };
      }),
    );
  }, [junctions]);

  const handleJunctionSelect = useCallback((id: string) => {
    setSelectedJunction((prev) => (prev === id ? null : id));
  }, []);

  const handleModelChange = useCallback((type: 'global' | 'specific') => {
    setModelType(type);
  }, []);

  const handleTimeChange = useCallback((hour: number) => {
    setCurrentTime(hour);
  }, []);

  const toggleStreaming = async () => {
    try {
      if (!isStreaming) {
        await fetch('http://localhost:8001/start', { method: 'POST' });
        setIsStreaming(true);
      } else {
        await fetch('http://localhost:8001/stop', { method: 'POST' });
        setIsStreaming(false);
      }
    } catch (err) {
      console.error('Streaming control error:', err);
    }
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      {/* Full-screen Background Map */}
      <div className="absolute inset-0 z-0">
        <TrafficMap
          junctions={junctions}
          routes={routes}
          selectedJunction={selectedJunction}
          onJunctionSelect={handleJunctionSelect}
        />
      </div>

      {/* Floating Glassmorphic Sidebar (Left) */}
      <Sidebar
        junctions={junctions}
        selectedJunction={selectedJunction}
        onJunctionSelect={handleJunctionSelect}
        modelMetrics={modelMetrics}
        modelType={modelType}
      />

      {/* Paradigm Switcher (Center Bottom Overlay) */}
      <ParadigmSwitcher
        modelType={modelType}
        onModelChange={handleModelChange}
      />

      {/* Time Slider (Bottom Overlay) */}
      <TimeSlider
        currentTime={currentTime}
        onTimeChange={handleTimeChange}
      />

      {/* ─── Top Right Control Cards ─── */}
      <div className="absolute top-4 right-4 z-50 flex flex-col sm:flex-row gap-3">
        {/* Navigation & Streaming Controller */}
        <div className="backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 rounded-2xl shadow-lg border border-white/50 dark:border-slate-800/50 p-2 flex items-center gap-2">
          <Link
            href="/"
            className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shadow-inner"
            title="Back to Launchpad"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          
          <button
            onClick={toggleStreaming}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs transition-all shadow-md active:scale-95 ${
              isStreaming
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/10'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/10'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isStreaming ? 'STOP STREAM' : 'START STREAM'}</span>
          </button>
        </div>

        {/* Brand & Connection Status Card */}
        <div className="backdrop-blur-xl bg-white/80 dark:bg-slate-900/80 rounded-2xl shadow-lg border border-white/50 dark:border-slate-800/50 px-4 py-3 flex items-center gap-3">
          <div className="flex flex-col">
            <h1 className="text-xs font-bold text-gray-900 dark:text-white uppercase tracking-wider">Kinetic Flow AI</h1>
            <p className="text-[10px] text-gray-500 dark:text-gray-400">LSTM Inference Grid</p>
          </div>
          
          <div 
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold tracking-wider uppercase border ${
              wsConnected 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 animate-pulse'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {wsConnected ? 'LIVE' : 'SYNCING'}
          </div>
        </div>
      </div>
    </main>
  );
}
