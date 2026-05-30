// src/components/traffic/TrafficDashboard.tsx
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Play, Pause, Settings, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Junction, RouteSegment } from '@/types/traffic';

const TrafficMap = dynamic(() => import('./TrafficMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-slate-800">
      <div className="w-10 h-10 border-3 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
    </div>
  ),
});

const JUNCTION_META: Record<string, { name: string; lat: number; lng: number }> = {
  J1: { name: 'J1 - Nord', lat: 48.8866, lng: 2.3522 },
  J2: { name: 'J2 - Centre', lat: 48.8696, lng: 2.3076 },
  J3: { name: 'J3 - Sud', lat: 48.8266, lng: 2.3552 },
  J4: { name: 'J4 - Est', lat: 48.8536, lng: 2.3792 },
  J5: { name: 'J5 - Ouest', lat: 48.8792, lng: 2.2861 },
  J6: { name: 'J6 - Périph', lat: 48.8932, lng: 2.4252 },
  J7: { name: 'J7 - Gare', lat: 48.8438, lng: 2.3472 },
  J8: { name: 'J8 - Aéroport', lat: 48.8567, lng: 2.2972 },
  J9: { name: 'J9 - Université', lat: 48.8245, lng: 2.3752 },
  J10: { name: 'J10 - Parc', lat: 48.8786, lng: 2.3982 },
  J11: { name: 'J11 - Pont', lat: 48.8436, lng: 2.3222 },
  J12: { name: 'J12 - Porte', lat: 48.8866, lng: 2.2722 },
};

const ROUTE_DEFS: { from: string; to: string }[] = [
  { from: 'J1', to: 'J2' }, { from: 'J2', to: 'J4' },
  { from: 'J1', to: 'J4' }, { from: 'J3', to: 'J4' },
  { from: 'J1', to: 'J3' }, { from: 'J2', to: 'J3' },
  { from: 'J4', to: 'J5' }, { from: 'J5', to: 'J6' },
  { from: 'J6', to: 'J7' }, { from: 'J7', to: 'J8' },
  { from: 'J8', to: 'J9' }, { from: 'J9', to: 'J10' },
  { from: 'J10', to: 'J11' }, { from: 'J11', to: 'J12' },
];

const calcStatus = (v: number): 'fluid' | 'moderate' | 'congested' =>
  v > 3500 ? 'congested' : v > 2800 ? 'moderate' : 'fluid';

const calcTrend = (pred: number, cur: number): 'up' | 'down' | 'stable' =>
  pred > cur ? 'up' : pred < cur ? 'down' : 'stable';

export function TrafficDashboard({ initialJunction }: { initialJunction?: number }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [selectedJunction, setSelectedJunction] = useState<string | null>(
    initialJunction ? `J${initialJunction}` : null
  );
  const [teslasCount, setTeslasCount] = useState(0);

  // Build initial junctions
  const [junctions, setJunctions] = useState<Junction[]>(() =>
    Object.entries(JUNCTION_META).map(([id, meta]) => ({
      id,
      name: meta.name,
      lat: meta.lat,
      lng: meta.lng,
      currentFlow: 0,
      predictedFlow: 0,
      trend: 'stable' as const,
      status: 'fluid' as const,
    }))
  );

  const [routes, setRoutes] = useState<RouteSegment[]>(() =>
    ROUTE_DEFS.map(r => ({ from: r.from, to: r.to, flow: 0, status: 'fluid' as const }))
  );

  const wsRef = useRef<WebSocket | null>(null);

  // WebSocket connection
  useEffect(() => {
    const wsUrl = 'ws://localhost:8000/ws/traffic';

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const junctionId = `J${data.Junction}`;

          setJunctions(prev => prev.map(j => {
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
          }));
        } catch (e) {
          // ignore
        }
      };

      ws.onerror = () => ws.close();
      ws.onclose = () => {
        setWsConnected(false);
        setTimeout(connect, 5000);
      };
    };

    connect();
    return () => wsRef.current?.close();
  }, []);

  // Update routes when junctions change
  useEffect(() => {
    setRoutes(prev =>
      prev.map(route => {
        const jFrom = junctions.find(j => j.id === route.from);
        const jTo = junctions.find(j => j.id === route.to);
        const avg = Math.round(((jFrom?.currentFlow ?? 0) + (jTo?.currentFlow ?? 0)) / 2);
        return { ...route, flow: avg, status: calcStatus(avg) };
      })
    );
  }, [junctions]);

  const toggleStreaming = async () => {
    try {
      if (!isStreaming) {
        await fetch('http://localhost:8001/start', { method: 'POST' });
        setIsStreaming(true);
        setTeslasCount(1);
      } else {
        await fetch('http://localhost:8001/stop', { method: 'POST' });
        setIsStreaming(false);
        setTeslasCount(0);
      }
    } catch (err) {
      console.error('Erreur:', err);
    }
  };

  const handleJunctionSelect = useCallback((id: string) => {
    setSelectedJunction(prev => (prev === id ? null : id));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/"
                className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white">
                  Traffic Prediction
                </h1>
                <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">
                  LSTM Neural Network • {wsConnected ? '🟢 Connected' : '🟡 Connecting...'}
                </p>
              </div>
            </div>

            {/* Streaming button - top right */}
            <button
              onClick={toggleStreaming}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-lg ${
                isStreaming
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isStreaming ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              <span>{isStreaming ? 'Stop Test' : 'Start Test'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Map */}
      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="w-full h-[500px] md:h-[600px] lg:h-[70vh]">
            <TrafficMap
              junctions={junctions}
              routes={routes}
              selectedJunction={selectedJunction}
              onJunctionSelect={handleJunctionSelect}
            />
          </div>
        </div>

        {/* Bottom bar: stats + debug info */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Stream</p>
            <p className={`text-lg font-bold mt-0.5 ${isStreaming ? 'text-emerald-600' : 'text-slate-400'}`}>
              {isStreaming ? '● Live' : '○ Idle'}
            </p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Teslas</p>
            <p className="text-lg font-bold mt-0.5 text-slate-900 dark:text-white">{teslasCount}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Junctions</p>
            <p className="text-lg font-bold mt-0.5 text-slate-900 dark:text-white">{junctions.length}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wide">Selected</p>
            <p className="text-lg font-bold mt-0.5 text-blue-600 dark:text-cyan-400">
              {selectedJunction || 'None'}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
