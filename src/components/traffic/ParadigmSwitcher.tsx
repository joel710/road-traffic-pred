'use client';

import { Globe, Pin } from 'lucide-react';

interface ParadigmSwitcherProps {
  modelType: 'global' | 'specific';
  onModelChange: (type: 'global' | 'specific') => void;
}

export default function ParadigmSwitcher({ modelType, onModelChange }: ParadigmSwitcherProps) {
  return (
    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000]">
      <div className="backdrop-blur-xl bg-white/80 rounded-2xl shadow-lg shadow-black/5 border border-white/50 p-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onModelChange('global')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              modelType === 'global'
                ? 'bg-gray-900 text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Global Model</span>
          </button>
          <button
            onClick={() => onModelChange('specific')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              modelType === 'specific'
                ? 'bg-gray-900 text-white shadow-md'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
            }`}
          >
            <Pin className="w-4 h-4" />
            <span>Specific Model</span>
          </button>
        </div>
      </div>
      
      {/* Model Info Tooltip */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
        <div className="backdrop-blur-xl bg-gray-900/90 text-white text-xs px-3 py-2 rounded-lg whitespace-nowrap">
          {modelType === 'global' 
            ? 'Trained on 48,000 hours of aggregated data' 
            : 'Junction-specific LSTM model'}
        </div>
      </div>
    </div>
  );
}
