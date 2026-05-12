'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import Sidebar from '@/components/traffic/Sidebar';
import ParadigmSwitcher from '@/components/traffic/ParadigmSwitcher';
import TimeSlider from '@/components/traffic/TimeSlider';
import { Junction, RouteSegment, ModelMetrics } from '@/types/traffic';

// Dynamically import the map component to avoid SSR issues with Leaflet
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

// Initial junction data (Paris traffic simulation)
const initialJunctions: Junction[] = [
  {
    id: 'J1',
    name: 'J1 - Périph Nord',
    lat: 48.8866,
    lng: 2.3522,
    currentFlow: 3420,
    predictedFlow: 3580,
    trend: 'up',
    status: 'moderate',
  },
  {
    id: 'J2',
    name: 'J2 - Champs-Élysées',
    lat: 48.8696,
    lng: 2.3076,
    currentFlow: 2840,
    predictedFlow: 2650,
    trend: 'down',
    status: 'fluid',
  },
  {
    id: 'J3',
    name: 'J3 - Place d\'Italie',
    lat: 48.8266,
    lng: 2.3552,
    currentFlow: 4120,
    predictedFlow: 4450,
    trend: 'up',
    status: 'congested',
  },
  {
    id: 'J4',
    name: 'J4 - Bastille',
    lat: 48.8536,
    lng: 2.3792,
    currentFlow: 2680,
    predictedFlow: 2720,
    trend: 'stable',
    status: 'fluid',
  },
];

// Initial route segments
const initialRoutes: RouteSegment[] = [
  { from: 'J1', to: 'J2', flow: 2800, status: 'fluid' },
  { from: 'J2', to: 'J4', flow: 3100, status: 'moderate' },
  { from: 'J1', to: 'J4', flow: 4200, status: 'congested' },
  { from: 'J3', to: 'J4', flow: 2500, status: 'fluid' },
  { from: 'J1', to: 'J3', flow: 3600, status: 'moderate' },
  { from: 'J2', to: 'J3', flow: 2900, status: 'fluid' },
];

// Model metrics for different paradigms
const globalMetrics: ModelMetrics = {
  mae: 3.24,
  rmse: 4.15,
  accuracy: 87.5,
};

const specificMetrics: ModelMetrics = {
  mae: 2.17, // As mentioned in the requirements
  rmse: 3.08,
  accuracy: 91.2,
};

// Helper function to calculate status based on flow
const calculateStatus = (flow: number): 'fluid' | 'moderate' | 'congested' => {
  if (flow > 3500) return 'congested';
  if (flow > 2800) return 'moderate';
  return 'fluid';
};

// Helper function to calculate trend
const calculateTrend = (predicted: number, current: number): 'up' | 'down' | 'stable' => {
  if (predicted > current) return 'up';
  if (predicted < current) return 'down';
  return 'stable';
};

export default function Home() {
  const [baseJunctions, setBaseJunctions] = useState<Junction[]>(initialJunctions);
  const [baseRoutes, setBaseRoutes] = useState<RouteSegment[]>(initialRoutes);
  const [selectedJunction, setSelectedJunction] = useState<string | null>(null);
  const [modelType, setModelType] = useState<'global' | 'specific'>('global');
  const [currentTime, setCurrentTime] = useState(0);

  // Derived model metrics based on modelType
  const modelMetrics = useMemo(() => {
    return modelType === 'global' ? globalMetrics : specificMetrics;
  }, [modelType]);

  // Simulate real-time data updates with timer
  useEffect(() => {
    const interval = setInterval(() => {
      setBaseJunctions(prev => prev.map(junction => ({
        ...junction,
        currentFlow: junction.currentFlow + Math.round((Math.random() - 0.5) * 50),
        predictedFlow: junction.predictedFlow + Math.round((Math.random() - 0.5) * 30),
      })));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Derived junctions with time-based predictions
  const junctions = useMemo(() => {
    const hourFactor = Math.sin(currentTime / 24 * Math.PI * 2);
    const rushHourFactor = (currentTime >= 7 && currentTime <= 9) || (currentTime >= 17 && currentTime <= 19) ? 1.3 : 1;
    const nightFactor = currentTime >= 0 && currentTime <= 5 ? 0.5 : 1;

    return baseJunctions.map(junction => {
      const predictedFlow = Math.round(junction.currentFlow * rushHourFactor * nightFactor * (1 + hourFactor * 0.2));
      
      return {
        ...junction,
        predictedFlow,
        status: calculateStatus(predictedFlow),
        trend: calculateTrend(predictedFlow, junction.currentFlow),
      };
    });
  }, [baseJunctions, currentTime]);

  // Derived routes with time-based predictions
  const routes = useMemo(() => {
    const hourFactor = Math.sin(currentTime / 24 * Math.PI * 2);
    
    return baseRoutes.map(route => {
      const predictedFlow = route.flow * (1 + hourFactor * 0.15);
      return { 
        ...route, 
        flow: Math.round(predictedFlow), 
        status: calculateStatus(predictedFlow) 
      };
    });
  }, [baseRoutes, currentTime]);

  const handleJunctionSelect = useCallback((id: string) => {
    setSelectedJunction(prev => prev === id ? null : id);
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
      <div className="absolute top-4 right-4 z-[1000]">
        <div className="backdrop-blur-xl bg-white/80 rounded-2xl shadow-lg shadow-black/5 border border-white/50 px-4 py-3">
          <h1 className="text-sm font-semibold text-gray-900">Traffic Prediction</h1>
          <p className="text-[10px] text-gray-500">LSTM Neural Network</p>
        </div>
      </div>
    </main>
  );
}
