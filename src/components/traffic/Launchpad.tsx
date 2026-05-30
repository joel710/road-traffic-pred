// src/components/traffic/Launchpad.tsx
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, MapPin, Clock, Navigation2, ArrowRight, Sparkles } from 'lucide-react';

interface Junction {
  id: number;
  name: string;
  icon: string;
  estimatedTime: string;
  status: 'fluid' | 'moderate' | 'congested';
  distance?: string;
  lat?: number;
  lng?: number;
}

const QUICK_ROUTES: Junction[] = [
  { id: 1, name: 'Downtown District', icon: '🏢', estimatedTime: '15 min', status: 'fluid', distance: '8.2 km', lat: 48.8566, lng: 2.3522 },
  { id: 3, name: 'Central Hub', icon: '🔄', estimatedTime: '28 min', status: 'moderate', distance: '15.4 km', lat: 48.8698, lng: 2.3076 },
  { id: 5, name: 'Airport Terminal', icon: '✈️', estimatedTime: '45 min', status: 'congested', distance: '32.1 km', lat: 49.0097, lng: 2.5479 },
];

const ALL_JUNCTIONS: Junction[] = Array.from({ length: 12 }, (_, i) => {
  const statuses: Junction['status'][] = ['fluid', 'moderate', 'congested'];
  const r = Math.random();
  const status = r > 0.6 ? 'congested' : r > 0.3 ? 'moderate' : 'fluid';
  return {
    id: i + 1,
    name: `Junction ${i + 1}`,
    icon: ['🚦', '🚧', '🏗️', '🌉', '🛣️', '🏙️', '🌆', '🌃', '🏘️', '🏭', '🏪', '🏫'][i],
    estimatedTime: `${5 + i * 3} min`,
    status,
    distance: `${(1.5 + i * 2.3).toFixed(1)} km`,
    lat: 48.85 + Math.random() * 0.05,
    lng: 2.32 + Math.random() * 0.07,
  };
});

export function Launchpad() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);

  const filteredJunctions = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return ALL_JUNCTIONS.filter(
      j => j.name.toLowerCase().includes(q) || `junction ${j.id}`.includes(q) || `j${j.id}` === q
    );
  }, [searchQuery]);

  const navigateToDashboard = (junctionId: number) => {
    router.push(`/dashboard?junction=${junctionId}`);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'fluid': return 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20';
      case 'moderate': return 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20';
      case 'congested': return 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20';
      default: return 'bg-blue-500/15 text-blue-700 dark:text-blue-400';
    }
  };

  const statusDot = (status: string) => {
    switch (status) {
      case 'fluid': return 'bg-emerald-500';
      case 'moderate': return 'bg-amber-500';
      case 'congested': return 'bg-red-500';
      default: return 'bg-blue-500';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      {/* ── Top Navigation (mobile style inspired by UI.html) ── */}
      <header className="md:hidden fixed top-0 w-full z-50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border-b border-slate-200/50 dark:border-slate-800/50">
        <div className="flex items-center justify-between h-16 px-5 max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Navigation2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-lg text-slate-900 dark:text-white">Kinetic Flow</span>
              <span className="block text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em]">Precision Traffic AI</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 transition-colors">
              <Sparkles className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-purple-600 overflow-hidden">
              <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">J</div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Desktop Side Navigation (inspired by UI.html) ── */}
      <nav className="hidden md:flex flex-col py-6 px-4 gap-2 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl h-screen w-64 fixed left-0 top-0 z-40 border-r border-slate-200/50 dark:border-slate-800/50">
        <div className="px-3 mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Navigation2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-xl text-slate-900 dark:text-white">Kinetic Flow</h1>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-[0.2em]">Precision Traffic AI</p>
            </div>
          </div>
        </div>

        {/* Navigation tabs */}
        <div className="flex flex-col gap-1 flex-grow">
          <a className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-blue-600/10 dark:bg-blue-600/20 text-blue-700 dark:text-blue-400 font-semibold text-sm" href="#">
            <Navigation2 className="w-5 h-5" />
            <span>Dashboard</span>
          </a>
          <a className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-sm transition-colors" href="#">
            <MapPin className="w-5 h-5" />
            <span>Analysis</span>
          </a>
          <a className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-sm transition-colors" href="#">
            <Clock className="w-5 h-5" />
            <span>Favorites</span>
          </a>
        </div>

        {/* Bottom links */}
        <div className="flex flex-col gap-1 pt-4 border-t border-slate-200 dark:border-slate-800">
          <a className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-medium text-sm transition-colors" href="#">
            <Sparkles className="w-5 h-5" />
            <span>Support</span>
          </a>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <main className="md:ml-64 pt-16 md:pt-0 min-h-screen">
        <div className="max-w-5xl mx-auto px-5 md:px-8 py-8 md:py-16 flex flex-col gap-10 md:gap-16">

          {/* Hero */}
          <section className="flex flex-col items-center text-center gap-4 md:gap-6 pt-4 md:pt-8">
            <h1 className="text-3xl md:text-6xl font-bold text-slate-900 dark:text-white tracking-tight">
              Good Morning, <span className="bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent">Jane</span>
            </h1>
            <p className="text-base md:text-lg text-slate-600 dark:text-slate-400 max-w-xl">
              Real-time traffic predictions powered by LSTM neural networks
            </p>

            {/* Search bar (UI.html inspired) */}
            <div className="relative w-full max-w-xl mt-2 group">
              <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none text-slate-400 group-focus-within:text-blue-600 dark:group-focus-within:text-cyan-400 transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                placeholder="Search junctions or destinations..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setShowResults(true); }}
                onFocus={() => setShowResults(true)}
                onBlur={() => setTimeout(() => setShowResults(false), 200)}
                className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-2xl py-4 pl-14 pr-12 border-2 border-slate-200 dark:border-slate-700 focus:border-blue-600 dark:focus:border-cyan-500 focus:ring-4 focus:ring-blue-500/20 dark:focus:ring-cyan-500/20 outline-none transition-all shadow-lg placeholder:text-slate-500 dark:placeholder:text-slate-400 text-base"
              />
              <button className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-blue-600 dark:hover:text-cyan-400 transition-colors">
                <Sparkles className="w-5 h-5" />
              </button>

              {/* Search dropdown */}
              {showResults && searchQuery.trim() && filteredJunctions.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 divide-y divide-slate-100 dark:divide-slate-700">
                  {filteredJunctions.map((j) => (
                    <button
                      key={j.id}
                      onMouseDown={() => navigateToDashboard(j.id)}
                      className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                    >
                      <span className="text-2xl">{j.icon}</span>
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900 dark:text-white">{j.name}</p>
                        <p className="text-sm text-slate-500 dark:text-slate-400">{j.distance} • {j.estimatedTime}</p>
                      </div>
                      <span className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border ${getStatusColor(j.status)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusDot(j.status)}`} />
                        {j.status.charAt(0).toUpperCase() + j.status.slice(1)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── Quick Routes (Bento Grid as in UI.html) ── */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white mb-5 md:mb-6">Quick Routes</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
              {QUICK_ROUTES.map((route) => (
                <button
                  key={route.id}
                  onClick={() => navigateToDashboard(route.id)}
                  className="group relative bg-white dark:bg-slate-800 rounded-2xl p-5 md:p-6 shadow-md hover:shadow-xl transition-all duration-300 border border-slate-200/80 dark:border-slate-700/80 hover:border-blue-600/30 dark:hover:border-cyan-500/30 text-left overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-600/[0.03] to-cyan-500/[0.03] dark:from-blue-600/[0.08] dark:to-cyan-500/[0.08] opacity-0 group-hover:opacity-100 transition-opacity" />
                  
                  <div className="relative flex items-start justify-between mb-4">
                    <span className="text-3xl">{route.icon}</span>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${getStatusColor(route.status)}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot(route.status)}`} />
                      {route.status.charAt(0).toUpperCase() + route.status.slice(1)}
                    </span>
                  </div>

                  <h3 className="text-lg md:text-xl font-bold text-slate-900 dark:text-white mb-3 group-hover:text-blue-700 dark:group-hover:text-cyan-400 transition-colors">
                    {route.name}
                  </h3>

                  <div className="space-y-1.5">
                    <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      {route.estimatedTime}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <MapPin className="w-4 h-4" />
                      {route.distance}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* ── All Junctions Grid ── */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold text-slate-900 dark:text-white mb-5 md:mb-6">All Junctions</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 md:gap-4">
              {ALL_JUNCTIONS.map((j) => (
                <button
                  key={j.id}
                  onClick={() => navigateToDashboard(j.id)}
                  className="group relative bg-white dark:bg-slate-800 rounded-xl p-3 md:p-4 shadow-sm hover:shadow-lg transition-all duration-300 border border-slate-200 dark:border-slate-700 hover:border-blue-600/40 dark:hover:border-cyan-500/40"
                >
                  <div className="text-2xl md:text-3xl mb-1.5 text-center">{j.icon}</div>
                  <p className="text-[11px] md:text-xs font-semibold text-slate-900 dark:text-white text-center truncate">
                    J{j.id}
                  </p>
                  <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-1 ${statusDot(j.status)}`} />
                </button>
              ))}
            </div>
          </section>

          {/* Footer */}
          <footer className="text-center text-xs text-slate-400 dark:text-slate-600 pb-8">
            <p>Kinetic Flow • Precision Traffic AI • Running on LSTM Neural Network</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
