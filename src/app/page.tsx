'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/traffic/Sidebar';
import ParadigmSwitcher from '@/components/traffic/ParadigmSwitcher';
import TimeSlider from '@/components/traffic/TimeSlider';
import { Junction, RouteSegment, ModelMetrics } from '@/types/traffic';

// Dynamically import the map component to avoid SSR issues with MapLibre
const TrafficMap = dynamic(() => import('@/components/traffic/TrafficMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
        <span className="text-sm text-gray-500">Loading map...</span>
      </div>
    </div>
  ),
});

// ─── Junction Metadata (positions + names, static) ──────────────
const JUNCTION_META: Record<string, { name: string; lat: number; lng: number }> = {
  J1: { name: 'J1 - Périph Nord', lat: 48.8866, lng: 2.3522 },
  J2: { name: 'J2 - Champs-Élysées', lat: 48.8696, lng: 2.3076 },
  J3: { name: "J3 - Place d'Italie", lat: 48.8266, lng: 2.3552 },
  J4: { name: 'J4 - Bastille', lat: 48.8536, lng: 2.3792 },
};

// ─── Route definitions (from→to) ───────────────────────────────
const ROUTE_DEFS: { from: string; to: string }[] = [
  { from: 'J1', to: 'J2' },
  { from: 'J2', to: 'J4' },
  { from: 'J1', to: 'J4' },
  { from: 'J3', to: 'J4' },
  { from: 'J1', to: 'J3' },
  { from: 'J2', to: 'J3' },
];

// Model metrics for different paradigms
const globalMetrics: ModelMetrics = { mae: 3.24, rmse: 4.15, accuracy: 87.5 };
const specificMetrics: ModelMetrics = { mae: 2.17, rmse: 3.08, accuracy: 91.2 };

// Helpers
const calcStatus = (v: number): 'fluid' | 'moderate' | 'congested' =>
  v > 3500 ? 'congested' : v > 2800 ? 'moderate' : 'fluid';

const calcTrend = (pred: number, cur: number): 'up' | 'down' | 'stable' =>
  pred > cur ? 'up' : pred < cur ? 'down' : 'stable';

// ─── Initial junctions with sensible defaults ───────────────────
const buildInitialJunctions = (): Junction[] =>
  Object.entries(JUNCTION_META).map(([id, meta]) => ({
    id,
    name: meta.name,
    lat: meta.lat,
    lng: meta.lng,
    currentFlow: 0,
    predictedFlow: 0,
    trend: 'stable',
    status: 'fluid',
  }));

const buildInitialRoutes = (): RouteSegment[] =>
  ROUTE_DEFS.map((r) => ({ from: r.from, to: r.to, flow: 0, status: 'fluid' }));

type WsPayload = {
  Junction: number;
  Vehicles: number;
  PredictedVehicles: number;
  Status: string;
  DateTime: string;
};

export default function Home() {
  const [junctions, setJunctions] = useState<Junction[]>(buildInitialJunctions);
  const [routes, setRoutes] = useState<RouteSegment[]>(buildInitialRoutes);
  const [selectedJunction, setSelectedJunction] = useState<string | null>(null);
  const [modelType, setModelType] = useState<'global' | 'specific'>('global');
  const [currentTime, setCurrentTime] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
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
        console.log('✅ WebSocket connected to', wsUrl);
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: WsPayload = JSON.parse(event.data);
          if (data.Junction == null) return;

          const junctionId = `J${data.Junction}`;

          // Update junctions
          setJunctions((prev) =>
            prev.map((j) => {
              if (j.id !== junctionId) return j;
              const newFlow = data.Vehicles ?? j.currentFlow;
              const predFlow = data.PredictedVehicles ?? j.predictedFlow;
              return {
                ...j,
                currentFlow: newFlow,
                predictedFlow: predFlow,
                status: calcStatus(predFlow),
                trend: calcTrend(predFlow, newFlow),
              };
            }),
          );

          // Update routes — average flow of the two connected junctions
          setRoutes((prev) =>
            prev.map((route) => {
              const fromJ = data.Junction === parseInt(junctionId.replace('J', '')) ? junctionId : null;
              if (!fromJ && route.from !== junctionId && route.to !== junctionId) return route;
              const jFrom = junctions.find((j) => j.id === route.from);
              const jTo = junctions.find((j) => j.id === route.to);
              const avgFlow = Math.round(((jFrom?.currentFlow ?? 0) + (jTo?.currentFlow ?? 0)) / 2);
              return { ...route, flow: avgFlow, status: calcStatus(avgFlow) };
            }),
          );
        } catch (e) {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected, reconnecting in 5s…');
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

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-gray-100">
      {/* Full-screen Map */}
      <div className="absolute inset-0">
        <TrafficMap
          junctions={junctions}
          routes={routes}
          selectedJunction={selectedJunction}
          onJunctionSelect={handleJunctionSelect}
        />
      </div>

      {/* Glass Sidebar */}
      <Sidebar
        junctions={junctions}
        selectedJunction={selectedJunction}
        onJunctionSelect={handleJunctionSelect}
        modelMetrics={modelMetrics}
        modelType={modelType}
      />

      {/* Paradigm Switcher */}
      <ParadigmSwitcher
        modelType={modelType}
        onModelChange={handleModelChange}
      />

      {/* Time Slider */}
      <TimeSlider
        currentTime={currentTime}
        onTimeChange={handleTimeChange}
      />

      {/* Logo/Brand */}
      <div className="absolute top-4 right-4 z-50">
        <div className="backdrop-blur-xl bg-white/80 rounded-2xl shadow-lg shadow-black/5 border border-white/50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex flex-col">
              <h1 className="text-sm font-semibold text-gray-900">Traffic Prediction</h1>
              <p className="text-[10px] text-gray-500">LSTM Neural Network</p>
            </div>
            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-amber-500 animate-pulse'}`} title={wsConnected ? 'Connected' : 'Connecting…'} />
          </div>
        </div>
      </div>
    </main>
  );
}
