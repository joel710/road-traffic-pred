'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import Map, { Source, Layer, Marker, Popup, MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Junction, RouteSegment } from '@/types/traffic';
import { roadGeometries } from '@/lib/data/roadGeometries';
import { motion, AnimatePresence } from 'framer-motion';

interface TrafficMapProps {
  junctions: Junction[];
  routes: RouteSegment[];
  selectedJunction: string | null;
  onJunctionSelect: (id: string) => void;
}

export default function TrafficMap({ junctions, routes, selectedJunction, onJunctionSelect }: TrafficMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [popupInfo, setPopupInfo] = useState<Junction | null>(null);

  const colors = {
    fluid: '#10B981', // Emerald green
    moderate: '#F59E0B', // Amber
    congested: '#EA580C', // Burnt orange
  };

  // Convert routes to GeoJSON for "natural" rendering
  const routesGeoJSON = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: routes.map((route) => {
        const key = `${route.from}-${route.to}` as keyof typeof roadGeometries;
        const coords = roadGeometries[key] || [
          [junctions.find(j => j.id === route.from)?.lng || 0, junctions.find(j => j.id === route.from)?.lat || 0],
          [junctions.find(j => j.id === route.to)?.lng || 0, junctions.find(j => j.id === route.to)?.lat || 0]
        ];

        return {
          type: 'Feature',
          properties: {
            status: route.status,
            color: colors[route.status],
            flow: route.flow
          },
          geometry: {
            type: 'LineString',
            coordinates: coords
          }
        };
      })
    };
  }, [routes, junctions]);

  // Handle camera transitions when a junction is selected
  useEffect(() => {
    if (selectedJunction && mapRef.current) {
      const junction = junctions.find(j => j.id === selectedJunction);
      if (junction) {
        mapRef.current.flyTo({
          center: [junction.lng, junction.lat],
          zoom: 15.5,
          pitch: 60, // 3D angle
          bearing: -20, // Aesthetic rotation
          duration: 3000,
          essential: true
        });
        setPopupInfo(junction);
      }
    } else if (mapRef.current) {
      mapRef.current.flyTo({
        center: [2.3522, 48.8566],
        zoom: 12.5,
        pitch: 0,
        bearing: 0,
        duration: 2000
      });
      setPopupInfo(null);
    }
  }, [selectedJunction, junctions]);

  return (
    <div className="w-full h-full relative">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 2.3522,
          latitude: 48.8566,
          zoom: 12.5,
          pitch: 0,
          bearing: 0
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
      >
        {/* Road Layers */}
        <Source id="traffic-routes" type="geojson" data={routesGeoJSON}>
          {/* Outer glow/blur layer */}
          <Layer
            id="route-glow"
            type="line"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 8,
              'line-blur': 4,
              'line-opacity': 0.4
            }}
          />
          {/* Main solid line layer */}
          <Layer
            id="route-main"
            type="line"
            layout={{
              'line-join': 'round',
              'line-cap': 'round'
            }}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 4,
              'line-opacity': 0.9
            }}
          />
          {/* Flow animation layer (dash array) */}
          <Layer
            id="route-flow"
            type="line"
            paint={{
              'line-color': '#fff',
              'line-width': 2,
              'line-dasharray': [2, 4],
              'line-opacity': 0.3
            }}
          />
        </Source>

        {/* Junction Markers */}
        {junctions.map((junction) => (
          <Marker
            key={junction.id}
            longitude={junction.lng}
            latitude={junction.lat}
            anchor="center"
            onClick={e => {
              e.originalEvent.stopPropagation();
              onJunctionSelect(junction.id);
            }}
          >
            <div className="relative flex items-center justify-center group cursor-pointer">
              {/* Pulsing rings */}
              <motion.div
                animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute w-8 h-8 rounded-full border-2"
                style={{ borderColor: colors[junction.status] }}
              />
              <motion.div
                animate={{ scale: [1, 1.5], opacity: [0.3, 0] }}
                transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                className="absolute w-8 h-8 rounded-full border-2"
                style={{ borderColor: colors[junction.status] }}
              />
              
              {/* Central dot */}
              <div 
                className="w-3 h-3 rounded-full z-10 shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-transform group-hover:scale-125"
                style={{ backgroundColor: colors[junction.status] }}
              />
              
              {/* Label */}
              <div className="absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <span className="bg-black/80 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm border border-white/10">
                  {junction.name}
                </span>
              </div>
            </div>
          </Marker>
        ))}

        {/* Popup for Selected Junction */}
        {popupInfo && (
          <Popup
            longitude={popupInfo.lng}
            latitude={popupInfo.lat}
            anchor="bottom"
            offset={15}
            closeButton={false}
            onClose={() => setPopupInfo(null)}
            className="custom-popup"
          >
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 min-w-[180px] bg-white/95 backdrop-blur-md rounded-xl shadow-2xl"
            >
              <h3 className="font-bold text-sm text-gray-900 border-b border-gray-100 pb-1.5 mb-2">
                {popupInfo.name}
              </h3>
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-500">Live Flow:</span>
                  <span className="font-mono font-bold text-gray-900">{popupInfo.currentFlow}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-gray-500">Prediction:</span>
                  <span className="font-mono font-bold text-emerald-600">{popupInfo.predictedFlow}</span>
                </div>
                <div className={`text-[10px] font-semibold mt-1 px-1.5 py-0.5 rounded inline-block ${
                  popupInfo.status === 'congested' ? 'bg-orange-100 text-orange-700' :
                  popupInfo.status === 'moderate' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                }`}>
                  {popupInfo.status.toUpperCase()}
                </div>
              </div>
            </motion.div>
          </Popup>
        )}
      </Map>

      {/* Map Controls UI Overlay */}
      <div className="absolute bottom-10 right-6 flex flex-col gap-2 pointer-events-auto">
        <button 
          onClick={() => mapRef.current?.zoomIn()}
          className="w-10 h-10 bg-white/90 backdrop-blur-xl rounded-full shadow-lg border border-gray-200 flex items-center justify-center hover:bg-white transition-colors"
        >
          <span className="text-xl font-light">+</span>
        </button>
        <button 
          onClick={() => mapRef.current?.zoomOut()}
          className="w-10 h-10 bg-white/90 backdrop-blur-xl rounded-full shadow-lg border border-gray-200 flex items-center justify-center hover:bg-white transition-colors"
        >
          <span className="text-xl font-light">−</span>
        </button>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .maplibregl-popup-content {
          padding: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }
        .maplibregl-popup-tip {
          display: none !important;
        }
      `}} />
    </div>
  );
}
