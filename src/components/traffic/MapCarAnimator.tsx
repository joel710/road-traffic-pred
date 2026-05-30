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

// Particles for exhaust effect
function ExhaustParticles({ pos, angle }: { pos: [number, number]; angle: number }) {
  const particles = [
    { dx: -8, dy: 3, delay: 0, size: 3 },
    { dx: -10, dy: -2, delay: 0.3, size: 2.5 },
    { dx: -12, dy: 0, delay: 0.6, size: 2 },
  ];
  return (
    <>
      {particles.map((p, i) => (
        <Marker key={i} longitude={pos[0]} latitude={pos[1]} anchor="center">
          <div
            className="rounded-full bg-blue-400/60"
            style={{
              width: p.size,
              height: p.size,
              transform: `translate(${Math.cos(angle * Math.PI / 180) * p.dx}px, ${Math.sin(angle * Math.PI / 180) * p.dy}px)`,
              animation: `exhaust-fade 0.6s ease-out ${p.delay}s infinite`,
              boxShadow: '0 0 6px rgba(96,165,250,0.5)',
            }}
          />
        </Marker>
      ))}
    </>
  );
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

  const CAR_W = 54, CAR_H = 28;

  return (
    <>
      {/* Trail glow line */}
      {trail.length > 3 && trail.filter((_, i) => i % 4 === 0).slice(-40).map((t, i) => (
        <Marker key={`t${i}`} longitude={t[0]} latitude={t[1]} anchor="center">
          <div
            style={{
              width: 4 + (i / 40) * 5,
              height: 4 + (i / 40) * 5,
              borderRadius: '50%',
              background: `rgba(59,130,246,${0.08 + (i / 40) * 0.45})`,
              boxShadow: `0 0 ${6 + (i / 40) * 10}px rgba(59,130,246,${0.15 + (i / 40) * 0.3})`,
            }}
          />
        </Marker>
      ))}

      {/* Exhaust */}
      <ExhaustParticles pos={position} angle={angle} />

      {/* Main Car Marker */}
      <Marker longitude={position[0]} latitude={position[1]} anchor="center" rotation={0}>
        <div className="relative flex items-center justify-center" style={{ width: CAR_W + 24, height: CAR_H + 24 }}>
          {/* Large glow halo */}
          <div
            className="absolute rounded-full"
            style={{
              width: CAR_W + 24,
              height: CAR_W + 24,
              background: 'radial-gradient(circle, rgba(59,130,246,0.5) 0%, rgba(59,130,246,0.15) 40%, transparent 70%)',
              animation: 'car-pulse 1.2s ease-in-out infinite alternate',
            }}
          />
          {/* Mid glow ring */}
          <div
            className="absolute rounded-full"
            style={{
              width: CAR_W + 8,
              height: CAR_H + 8,
              border: '2px solid rgba(59,130,246,0.3)',
              borderRadius: '30%',
              animation: 'car-ring 0.8s ease-in-out infinite alternate',
            }}
          />

          {/* Car body */}
          <div
            className="relative rounded-lg shadow-2xl"
            style={{
              width: CAR_W,
              height: CAR_H,
              background: 'linear-gradient(160deg, #2563EB 0%, #1E40AF 40%, #1E3A5F 100%)',
              border: '2px solid rgba(255,255,255,0.3)',
              boxShadow: '0 0 20px rgba(37,99,235,0.9), 0 0 40px rgba(37,99,235,0.5), 0 0 60px rgba(37,99,235,0.2)',
              transform: `rotate(${angle}deg)`,
            }}
          >
            {/* Roof/cabin */}
            <div
              style={{
                position: 'absolute',
                top: 3,
                left: '30%',
                width: CAR_W * 0.3,
                height: CAR_H * 0.55,
                background: 'linear-gradient(180deg, rgba(147,197,253,0.3) 0%, rgba(30,58,95,0.6) 100%)',
                borderRadius: '3px 3px 0 0',
                borderLeft: '1px solid rgba(255,255,255,0.15)',
                borderRight: '1px solid rgba(255,255,255,0.15)',
                borderTop: '1px solid rgba(255,255,255,0.2)',
              }}
            />
            {/* Windshield */}
            <div
              style={{
                position: 'absolute',
                top: 3,
                left: '58%',
                width: CAR_W * 0.12,
                height: CAR_H * 0.5,
                background: 'linear-gradient(200deg, rgba(147,197,253,0.7) 0%, rgba(96,165,250,0.3) 100%)',
                borderRadius: '1px 3px 1px 0',
              }}
            />
            {/* Rear window */}
            <div
              style={{
                position: 'absolute',
                top: 3,
                left: '22%',
                width: CAR_W * 0.08,
                height: CAR_H * 0.45,
                background: 'rgba(147,197,253,0.25)',
                borderRadius: '3px 1px 0 1px',
              }}
            />
            {/* Headlights */}
            <div style={{ position: 'absolute', right: 2, top: 4, width: 4, height: 4, background: '#FEF08A', borderRadius: '50%', boxShadow: '0 0 6px #FEF08A, 0 0 12px #FDE047' }} />
            <div style={{ position: 'absolute', right: 2, bottom: 4, width: 4, height: 4, background: '#FEF08A', borderRadius: '50%', boxShadow: '0 0 6px #FEF08A, 0 0 12px #FDE047' }} />
            {/* Tail lights */}
            <div style={{ position: 'absolute', left: 2, top: 4, width: 3.5, height: 3.5, background: '#EF4444', borderRadius: '50%', boxShadow: '0 0 6px #EF4444, 0 0 12px #F87171' }} />
            <div style={{ position: 'absolute', left: 2, bottom: 4, width: 3.5, height: 3.5, background: '#EF4444', borderRadius: '50%', boxShadow: '0 0 6px #EF4444, 0 0 12px #F87171' }} />
            {/* Racing stripe */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '20%',
                width: '50%',
                height: 2,
                background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 30%, rgba(255,255,255,0.3) 70%, transparent 100%)',
                transform: 'translateY(-50%)',
              }}
            />
            {/* Wheels */}
            <div style={{ position: 'absolute', right: 4, top: -3, width: 5, height: 5, background: '#0F172A', borderRadius: 1, border: '1px solid rgba(255,255,255,0.15)' }} />
            <div style={{ position: 'absolute', right: 4, bottom: -3, width: 5, height: 5, background: '#0F172A', borderRadius: 1, border: '1px solid rgba(255,255,255,0.15)' }} />
            <div style={{ position: 'absolute', left: 4, top: -3, width: 5, height: 5, background: '#0F172A', borderRadius: 1, border: '1px solid rgba(255,255,255,0.15)' }} />
            <div style={{ position: 'absolute', left: 4, bottom: -3, width: 5, height: 5, background: '#0F172A', borderRadius: 1, border: '1px solid rgba(255,255,255,0.15)' }} />
          </div>
        </div>
      </Marker>

      <style>{`
        @keyframes car-pulse {
          from { transform: scale(0.85); opacity: 0.7; }
          to { transform: scale(1.15); opacity: 0.25; }
        }
        @keyframes car-ring {
          from { transform: scale(1); opacity: 0.5; }
          to { transform: scale(1.15); opacity: 0.15; }
        }
        @keyframes exhaust-fade {
          0% { opacity: 0.8; transform: translate(0, 0) scale(1); }
          100% { opacity: 0; transform: translate(-6px, -2px) scale(0.3); }
        }
      `}</style>
    </>
  );
}
