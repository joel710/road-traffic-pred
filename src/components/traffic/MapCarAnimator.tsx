'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Marker } from 'react-map-gl/maplibre';
import { CarRoute, RouteSegment } from '@/types/traffic';
import { roadGeometries } from '@/lib/data/roadGeometries';
import { findBestPath } from '@/lib/traffic/routing';

interface CarAnimatorProps {
  carRoute: CarRoute | null;
  routes: RouteSegment[];
  onArrival: () => void;
}

const CAR_SPEED = 0.00008; // lng/lat units per frame (~60fps)

function interpolate(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function distance(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function getDirection(from: [number, number], to: [number, number]): number {
  return Math.atan2(to[1] - from[1], to[0] - from[0]) * (180 / Math.PI);
}

export default function MapCarAnimator({ carRoute, routes, onArrival }: CarAnimatorProps) {
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

  const buildFullPath = useCallback((route: CarRoute, allRoutes: RouteSegment[]): [number, number][] | null => {
    const pathJunctions = findBestPath(route.from, route.to, allRoutes);
    if (!pathJunctions || pathJunctions.length < 2) return null;

    const fullCoords: [number, number][] = [];
    for (let i = 0; i < pathJunctions.length - 1; i++) {
      const key = `${pathJunctions[i]}-${pathJunctions[i + 1]}` as keyof typeof roadGeometries;
      const revKey = `${pathJunctions[i + 1]}-${pathJunctions[i]}` as keyof typeof roadGeometries;
      const seg = roadGeometries[key] ?? roadGeometries[revKey];
      if (!seg) {
        // Fallback: straight line between junction centers
        const fromJ = allRoutes.flatMap(r => [r.from, r.to]);
        fullCoords.push([0, 0]); // Will be filled by parent
        continue;
      }
      const coords = key in roadGeometries ? seg : [...seg].reverse();
      for (let j = (i === 0 ? 0 : 1); j < coords.length; j++) {
        fullCoords.push(coords[j]);
      }
    }
    return fullCoords;
  }, []);

  // Start animation when carRoute changes
  useEffect(() => {
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

    const lastCheck = { time: 0, segment: 0 };

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);

      let i = idxRef.current;
      let t = subRef.current;

      if (i >= coords.length - 1) {
        setVisible(false);
        onArrival();
        return;
      }

      // Progress along current segment
      const segLen = segmentDistances[i] || 0.0001;
      t += CAR_SPEED / segLen;

      if (t >= 1.0) {
        t = 0;
        i++;
        if (i >= coords.length - 1) {
          setPosition(coords[coords.length - 1]);
          setTrail(prev => [...prev.slice(-200), coords[coords.length - 1]]);
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
        return next.length > 200 ? next.slice(-200) : next;
      });

      // Re-routing check every 2 seconds
      if (carRoute) {
        lastCheck.time++;
        if (lastCheck.time % 120 === 0) {
          // Check if upcoming segments are congested
          const reroute = findBestPath(
            carRoute.from,
            carRoute.to,
            routesRef.current
          );
          if (reroute && reroute.length >= 2) {
            const newCoords = buildFullPath(
              { ...carRoute, path: reroute },
              routesRef.current
            );
            if (newCoords && newCoords.length >= 2) {
              // Find closest point on new path
              const currentPos = pos;
              let closestIdx = 0;
              let closestDist = Infinity;
              for (let j = 0; j < newCoords.length; j++) {
                const d = distance(currentPos, newCoords[j]);
                if (d < closestDist) {
                  closestDist = d;
                  closestIdx = j;
                }
              }
              // Only re-route if significantly different
              if (Math.abs(closestIdx - i) > 5 || reroute.join() !== carRoute.path.join()) {
                coordsRef.current = newCoords;
                idxRef.current = closestIdx;
                subRef.current = 0;
                // Recalculate segment distances
                segmentDistances.length = 0;
                for (let k = 0; k < newCoords.length - 1; k++) {
                  segmentDistances.push(distance(newCoords[k], newCoords[k + 1]));
                }
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

  return (
    <>
      {/* Car Marker */}
      <Marker longitude={position[0]} latitude={position[1]} anchor="center" rotation={angle}>
        <div className="relative flex items-center justify-center" style={{ width: 28, height: 28 }}>
          {/* Glow halo */}
          <div
            className="absolute rounded-full"
            style={{
              width: 28,
              height: 28,
              background: 'radial-gradient(circle, rgba(59,130,246,0.6) 0%, transparent 70%)',
              animation: 'pulse-glow 0.8s ease-in-out infinite alternate',
            }}
          />
          {/* Car body */}
          <div
            className="relative flex items-center justify-center rounded-md shadow-lg"
            style={{
              width: 18,
              height: 10,
              background: 'linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)',
              border: '1.5px solid rgba(255,255,255,0.4)',
              boxShadow: '0 0 12px rgba(59,130,246,0.8), 0 0 24px rgba(59,130,246,0.4)',
              transform: `rotate(${angle}deg)`,
            }}
          >
            {/* Windshield */}
            <div
              style={{
                position: 'absolute',
                top: 1,
                left: '55%',
                width: 5,
                height: 4,
                background: 'rgba(147,197,253,0.8)',
                borderRadius: '1px 2px 1px 0',
              }}
            />
            {/* Headlights */}
            <div style={{ position: 'absolute', right: 1, top: 1.5, width: 2, height: 2, background: '#FEF08A', borderRadius: '50%', boxShadow: '0 0 3px #FEF08A' }} />
            <div style={{ position: 'absolute', right: 1, bottom: 1.5, width: 2, height: 2, background: '#FEF08A', borderRadius: '50%', boxShadow: '0 0 3px #FEF08A' }} />
          </div>
        </div>
      </Marker>

      {/* Trail dots */}
      {trail.length > 5 && trail.filter((_, i) => i % 8 === 0).slice(-15).map((t, i) => (
        <Marker key={i} longitude={t[0]} latitude={t[1]} anchor="center">
          <div
            style={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: `rgba(59,130,246,${0.15 + (i / 15) * 0.4})`,
              boxShadow: `0 0 4px rgba(59,130,246,${0.2 + (i / 15) * 0.3})`,
            }}
          />
        </Marker>
      ))}

      <style>{`
        @keyframes pulse-glow {
          from { transform: scale(0.9); opacity: 0.8; }
          to { transform: scale(1.3); opacity: 0.3; }
        }
      `}</style>
    </>
  );
}
