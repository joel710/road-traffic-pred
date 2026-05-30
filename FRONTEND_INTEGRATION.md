// 🗺️ Exemple: Intégration WebSocket Frontend

// À ajouter dans src/components/traffic/TrafficMap.tsx ou un hook personnalisé

import { useEffect, useState, useRef } from 'react';

interface TrafficPrediction {
  DateTime: string;
  Junction: number;
  Vehicles: number;
  PredictedVehicles: number;
  Status: 'fluid' | 'moderate' | 'congested';
  Timestamp: string;
}

export const useTrafficWebSocket = (backendUrl = 'ws://localhost:8000') => {
  const [predictions, setPredictions] = useState<Map<number, TrafficPrediction>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Connexion WebSocket
    const ws = new WebSocket(`${backendUrl}/ws/traffic`);

    ws.onopen = () => {
      console.log('✅ WebSocket connecté au backend');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data: TrafficPrediction = JSON.parse(event.data);
        
        // Mettre à jour la prédiction pour cette jonction
        setPredictions(prev => {
          const updated = new Map(prev);
          updated.set(data.Junction, data);
          return updated;
        });

        console.log(`🚗 Junction ${data.Junction}: ${data.PredictedVehicles} vehicles (${data.Status})`);

        // ✨ Ici vous pouvez:
        // 1. Mettre à jour la couleur sur la carte (rouge si congested, etc.)
        // 2. Afficher un toast notification pour les changements majeurs
        // 3. Mettre à jour un graphique en temps réel
      } catch (error) {
        console.error('❌ Erreur parsing WebSocket:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket erreur:', error);
    };

    ws.onclose = () => {
      console.log('🔌 WebSocket fermé');
      setIsConnected(false);
    };

    wsRef.current = ws;

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [backendUrl]);

  // Fonction utilitaire: obtenir la couleur en fonction du status
  const getStatusColor = (status: TrafficPrediction['Status']): string => {
    switch (status) {
      case 'fluid':
        return '#00ff00'; // Vert
      case 'moderate':
        return '#ffaa00'; // Orange
      case 'congested':
        return '#ff0000'; // Rouge
      default:
        return '#aaaaaa'; // Gris
    }
  };

  return {
    predictions,
    isConnected,
    getStatusColor,
  };
};

// ─────────────────────────────────────────────────────────────

// 📌 Exemple d'utilisation dans un composant:

export function TrafficMapWithLiveUpdates() {
  const { predictions, isConnected, getStatusColor } = useTrafficWebSocket(
    process.env.NEXT_PUBLIC_BACKEND_WS_URL || 'ws://localhost:8000'
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Indicateur de connexion */}
      <div className="flex items-center gap-2">
        <div className={`h-3 w-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span>{isConnected ? 'Connecté au backend' : 'Déconnecté'}</span>
      </div>

      {/* Tableau des prédictions actuelles */}
      <div className="rounded-lg bg-slate-900 p-4">
        <h2 className="mb-4 text-lg font-bold">Prédictions Temps Réel</h2>
        
        {predictions.size === 0 ? (
          <p className="text-gray-400">En attente des prédictions...</p>
        ) : (
          <div className="grid gap-2">
            {Array.from(predictions.values()).map((pred) => (
              <div
                key={pred.Junction}
                className="flex items-center justify-between rounded bg-slate-800 p-3"
              >
                <div>
                  <p className="font-bold">Junction {pred.Junction}</p>
                  <p className="text-sm text-gray-400">{pred.DateTime}</p>
                </div>
                
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-right text-sm">Actual: {pred.Vehicles}</p>
                    <p className="text-right font-bold">Pred: {pred.PredictedVehicles.toFixed(0)}</p>
                  </div>
                  
                  {/* Indicateur coloré du status */}
                  <div
                    className="h-8 w-8 rounded-full"
                    style={{ backgroundColor: getStatusColor(pred.Status) }}
                    title={`Status: ${pred.Status}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

// 🗺️ Intégration avec MapLibre GL (pour la carte 3D):

import maplibregl from 'maplibre-gl';

export function TrafficMapWithMarkersUpdate() {
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { predictions } = useTrafficWebSocket();

  // Mettre à jour les marqueurs sur la carte quand les prédictions changent
  useEffect(() => {
    if (!mapRef.current) return;

    predictions.forEach((pred) => {
      // ID du marqueur: junction-{id}
      const markerId = `junction-${pred.Junction}`;
      
      // Chercher le marqueur existant
      const markerElement = document.getElementById(markerId);
      
      if (markerElement) {
        // Changer la couleur du marqueur selon le status
        const color = pred.Status === 'congested' ? 'red' : 
                      pred.Status === 'moderate' ? 'orange' : 'green';
        
        markerElement.style.backgroundColor = color;
        markerElement.style.borderColor = color;
        
        // Ajouter une animation de pulse si congestion
        if (pred.Status === 'congested') {
          markerElement.classList.add('animate-pulse');
        } else {
          markerElement.classList.remove('animate-pulse');
        }
        
        // Mettre à jour le popup d'information
        const popup = markerElement.querySelector('.marker-popup');
        if (popup) {
          popup.innerHTML = `
            <div class="text-sm">
              <p><strong>Junction ${pred.Junction}</strong></p>
              <p>Vehicles: ${pred.Vehicles}</p>
              <p>Predicted: ${pred.PredictedVehicles.toFixed(0)}</p>
              <p>Status: <span style="color: ${
                pred.Status === 'congested' ? 'red' :
                pred.Status === 'moderate' ? 'orange' : 'green'
              }">${pred.Status}</span></p>
            </div>
          `;
        }
      }
    });
  }, [predictions]);

  return (
    <div ref={mapRef} className="h-screen w-full" />
  );
}

// ─────────────────────────────────────────────────────────────

// 💡 Conseils d'intégration:

/*
1. Variables d'environnement dans .env.local:
   NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:8000
   (ou ws://your-production-domain.com pour prod)

2. Pour la production avec Caddy:
   - Configurez le reverse proxy Caddy
   - WebSocket: ws://your-domain.com/ws/traffic

3. Mettre à jour les pins sur la carte:
   - Utiliser maplibregl pour modifier les sources
   - Ajouter des animations avec Framer Motion
   - Toast notifications pour les alertes critiques

4. Historique des prédictions:
   - Fetch /traffic/history/{junction_id} au chargement initial
   - Ajouter un graphique avec Recharts ou Chart.js
*/
