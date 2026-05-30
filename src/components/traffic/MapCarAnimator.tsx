'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Marker, MapRef } from 'react-map-gl/maplibre';
import { CarRoute, RouteSegment } from '@/types/traffic';
import { roadGeometries } from '@/lib/data/roadGeometries';
import { findBestPath } from '@/lib/traffic/routing';

interface CarAnimatorProps {
  carRoute: CarRoute | null;
  routes: RouteSegment[];
  onArrival: () => void;
  mapRef: React.RefObject<MapRef | null>;
}

const CAR_SPEED = 0.00012; // lng/lat units per frame (~60fps)

function interpolate(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function distance(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function getDirection(from: [number, number], to: [number, number]): number {
  return Math.atan2(to[1] - from[1], to[0] - from[0]) * (180 / Math.PI);
}

export default function MapCarAnimator({ carRoute, routes, onArrival, mapRef }: CarAnimatorProps) {
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [angle, setAngle] = useState(0);
  const [visible, setVisible] = useState(false);
  const [trail, setTrail] = useState<[number, number][]>([]);

  const animRef = useRef<number>(0);
  const coordsRef = useRef<[number, number][]>([]);
  const idxRef = useRef(0);
  const subRef = useRef(0);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const arrivedRef = useRef(false);

  const buildFullPath = useCallback((route: CarRoute, allRoutes: RouteSegment[]): [number, number][] | null => {
    const pathJunctions = findBestPath(route.from, route.to, allRoutes);
    if (!pathJunctions || pathJunctions.length < 2) return null;

    const fullCoords: [number, number][] = [];
    for (let i = 0; i < pathJunctions.length - 1; i++) {
      const key = `${pathJunctions[i]}-${pathJunctions[i + 1]}`;
      const revKey = `${pathJunctions[i + 1]}-${pathJunctions[i]}`;
      const seg = roadGeometries[key as keyof typeof roadGeometries]
        ?? roadGeometries[revKey as keyof typeof roadGeometries];
      if (!seg) continue;
      const coords = key in roadGeometries ? [...seg] : [...seg].reverse();
      for (let j = (fullCoords.length === 0 ? 0 : 1); j < coords.length; j++) {
        fullCoords.push(coords[j]);
      }
    }
    return fullCoords.length >= 2 ? fullCoords : null;
  }, []);

  useEffect(() => {
    arrivedRef.current = false;

    if (!carRoute) {
      setVisible(false);
      setPosition(null);
      setTrail([]);
      cancelAnimationFrame(animRef.current);
      return;
    }

    const coords = carRoute.fullCoords;
    if (!coords || coords.length < 2) {
      onArrival();
      return;
    }

    coordsRef.current = coords;
    idxRef.current = 0;
    subRef.current = 0;
    setPosition(coords[0]);
    setVisible(true);
    setTrail([coords[0]]);

    const segmentDistances: number[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      segmentDistances.push(distance(coords[i], coords[i + 1]));
    }

    let frameCount = 0;

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      frameCount++;

      let i = idxRef.current;
      let t = subRef.current;

      if (i >= coords.length - 1) {
        if (!arrivedRef.current) {
          arrivedRef.current = true;
          setVisible(false);
          onArrival();
        }
        return;
      }

      const segLen = segmentDistances[i] || 0.0001;
      t += CAR_SPEED / segLen;

      if (t >= 1.0) {
        t = 0;
        i++;
        if (i >= coords.length - 1) {
          setPosition(coords[coords.length - 1]);
          setTrail(prev => [...prev.slice(-200), coords[coords.length - 1]]);
          arrivedRef.current = true;
          setVisible(false);
          onArrival();
          return;
        }
      }

      idxRef.current = i;
      subRef.current = t;

      const pos = interpolate(coords[i], coords[i + 1], t);
      const dir = getDirection(coords[i], coords[i + 1]);

      setPosition(pos);
      setAngle(dir);
      setTrail(prev => {
        const next = [...prev, pos];
        return next.length > 300 ? next.slice(-300) : next;
      });

      // Camera follows car smoothly
      if (mapRef.current && frameCount % 20 === 0) {
        mapRef.current.panTo([pos[0], pos[1]], { duration: 800 });
      }

      // Re-routing check every 3 seconds
      if (carRoute && frameCount % 180 === 0) {
        const reroute = findBestPath(carRoute.from, carRoute.to, routesRef.current);
        if (reroute && reroute.length >= 2 && reroute.join() !== carRoute.path.join()) {
          const newCoords = buildFullPath(
            { ...carRoute, path: reroute },
            routesRef.current
          );
          if (newCoords && newCoords.length >= 2) {
            let closestIdx = 0;
            let closestDist = Infinity;
            for (let j = 0; j < newCoords.length; j++) {
              const d = distance(pos, newCoords[j]);
              if (d < closestDist) { closestDist = d; closestIdx = j; }
            }
            if (closestIdx < newCoords.length - 1) {
              coordsRef.current = newCoords;
              idxRef.current = closestIdx;
              subRef.current = 0;
              segmentDistances.length = 0;
              for (let k = 0; k < newCoords.length - 1; k++) {
                segmentDistances.push(distance(newCoords[k], newCoords[k + 1]));
              }
            }
          }
        }
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [carRoute, onArrival, buildFullPath]);

  if (!visible || !position) return null;

  // Tesla Model S proportions: ~4.97m long, ~1.96m wide → ratio ~2.5:1
  const CAR_L = 64; // length (along direction of travel)
  const CAR_W = 26; // width

  return (
    <>
      {/* Trail glow dots */}
      {trail.length > 3 && trail.filter((_, i) => i % 6 === 0).slice(-30).map((t, i) => (
        <Marker key={`t${i}`} longitude={t[0]} latitude={t[1]} anchor="center">
          <div
            style={{
              width: 3 + (i / 30) * 3,
              height: 3 + (i / 30) * 3,
              borderRadius: '50%',
              background: `rgba(100,116,139,${0.06 + (i / 30) * 0.3})`,
              boxShadow: `0 0 ${4 + (i / 30) * 6}px rgba(100,116,139,${0.1 + (i / 30) * 0.2})`,
            }}
          />
        </Marker>
      ))}

      {/* Main Car Marker — Tesla Model S style */}
      <Marker longitude={position[0]} latitude={position[1]} anchor="center">
        <div
          className="relative"
          style={{
            width: CAR_L + 28,
            height: CAR_W + 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Road shadow */}
          <div
            className="absolute rounded-full"
            style={{
              width: CAR_L - 4,
              height: CAR_W + 6,
              background: 'rgba(0,0,0,0.3)',
              filter: 'blur(4px)',
              transform: `rotate(${angle}deg) translate(2px, 2px)`,
            }}
          />

          {/* Car body — Tesla grey metallic */}
          <div
            style={{
              width: CAR_L,
              height: CAR_W,
              background: 'linear-gradient(180deg, #9CA3AF 0%, #6B7280 15%, #D1D5DB 35%, #9CA3AF 60%, #6B7280 85%, #4B5563 100%)',
              borderRadius: '40% 40% 40% 40% / 45% 45% 45% 45%',
              border: '1.5px solid rgba(255,255,255,0.35)',
              boxShadow: `
                0 0 10px rgba(0,0,0,0.3),
                0 0 2px rgba(255,255,255,0.4),
                inset 0 1px 0 rgba(255,255,255,0.2)
              `,
              transform: `rotate(${angle}deg)`,
              position: 'relative',
            }}
          >
            {/* Hood reflection */}
            <div style={{
              position: 'absolute',
              top: '15%', left: '15%', width: '65%', height: '20%',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.25) 0%, transparent 100%)',
              borderRadius: '30%',
            }} />

            {/* Windshield — dark glass from above */}
            <div style={{
              position: 'absolute',
              top: '30%', left: '55%', width: '22%', height: '40%',
              background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f0f1a 100%)',
              borderRadius: '30% 5% 5% 30% / 40% 40% 40% 40%',
              border: '1px solid rgba(255,255,255,0.1)',
            }} />

            {/* Roof — dark panoramic glass */}
            <div style={{
              position: 'absolute',
              top: '30%', left: '38%', width: '18%', height: '40%',
              background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '20% 20% 20% 20% / 30% 30% 30% 30%',
              border: '1px solid rgba(255,255,255,0.08)',
            }} />

            {/* Rear window */}
            <div style={{
              position: 'absolute',
              top: '30%', left: '23%', width: '16%', height: '40%',
              background: 'linear-gradient(180deg, #1a1a2e 0%, #0f0f1a 100%)',
              borderRadius: '5% 30% 30% 5% / 40% 40% 40% 40%',
              border: '1px solid rgba(255,255,255,0.08)',
            }} />

            {/* Front headlights — slim LED strip */}
            <div style={{
              position: 'absolute',
              top: '22%', right: 1, width: 3, height: 10,
              background: '#F8FAFC',
              borderRadius: '0 3px 3px 0',
              boxShadow: '0 0 8px #F8FAFC, 0 0 16px #E2E8F0',
            }} />
            <div style={{
              position: 'absolute',
              bottom: '22%', right: 1, width: 3, height: 10,
              background: '#F8FAFC',
              borderRadius: '0 3px 3px 0',
              boxShadow: '0 0 8px #F8FAFC, 0 0 16px #E2E8F0',
            }} />

            {/* Rear lights — red LED */}
            <div style={{
              position: 'absolute',
              top: '22%', left: 1, width: 3, height: 10,
              background: '#EF4444',
              borderRadius: '3px 0 0 3px',
              boxShadow: '0 0 6px #EF4444',
            }} />
            <div style={{
              position: 'absolute',
              bottom: '22%', left: 1, width: 3, height: 10,
              background: '#EF4444',
              borderRadius: '3px 0 0 3px',
              boxShadow: '0 0 6px #EF4444',
            }} />
          </div>

          {/* Subtle ground glow */}
          <div
            className="absolute rounded-full"
            style={{
              width: CAR_L - 8,
              height: CAR_W + 2,
              background: 'radial-gradient(ellipse, rgba(156,163,175,0.2) 0%, transparent 70%)',
              transform: `rotate(${angle}deg)`,
            }}
          />
        </div>
      </Marker>
    </>
  );
}
