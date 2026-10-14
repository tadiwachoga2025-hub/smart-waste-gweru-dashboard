import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMapEvents, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';
import InstallPrompt from './components/InstallPrompt.jsx';

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Icons
const TrashIcon = () => <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>;
const TruckIcon = () => <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2"><rect x="3" y="3" width="12" height="12" rx="2"/><path d="M15 6h4a2 2 0 0 1 2 2v7h-6Z"/><circle cx="7.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/></svg>;
const RouteIcon = () => <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>;
const PinIcon = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>;

const LocationFinder = () => {
  useMapEvents({ click(e) { alert(`Latitude: ${e.latlng.lat.toFixed(3)}\nLongitude: ${e.latlng.lng.toFixed(3)}`); } });
  return null;
};

const MapUpdater = ({ bins }) => {
  const map = useMap();
  useEffect(() => {
    if (bins.length > 0) {
      const bounds = bins.map(bin => [bin.lat, bin.lng]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [bins, map]);
  return null;
};

const App = () => {
  const [bins, setBins] = useState([]);
  const [logistics, setLogistics] = useState({ activeRoute: [], resources: {} });
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    const binsRef = ref(db, 'bins');
    const logRef = ref(db, 'logistics');
    
    onValue(binsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setBins(Object.keys(data).map(key => ({ id: key, ...data[key] })));
    });

    onValue(logRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setLogistics(data);
    });
  }, []);

  const criticalBins = bins.filter(bin => bin.fillLevel >= 90).length;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#f3f4f6', minHeight: '100vh', padding: '2rem' }}>
      {!isOnline && (
        <div style={{ maxWidth: '1400px', margin: '0 auto 1rem auto', padding: '0.75rem 1rem', backgroundColor: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: '0.375rem', fontWeight: '500' }}>
          You are offline — showing cached app shell. Live bin levels will resume when reconnected.
        </div>
      )}
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#111827', margin: 0 }}>Smart City Waste Management</h1>
            <p style={{ color: '#6b7280', margin: '0.25rem 0 0 0' }}>AI Logistics & Sensor Dashboard (Gweru)</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', backgroundColor: isOnline ? '#dcfce7' : '#fef3c7', color: isOnline ? '#166534' : '#92400e', border: `1px solid ${isOnline ? '#bbf7d0' : '#fcd34d'}`, borderRadius: '0.375rem', fontWeight: '500' }}>
            {isOnline ? '● Active AI Pipeline' : '○ Offline Mode'}
          </div>
        </header>

        {/* --- Top Metrics --- */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <TrashIcon />
              <div>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>Network Health</p>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>{bins.length} Active Bins</h2>
              </div>
            </div>
          </div>
          
          <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderLeft: '4px solid #8b5cf6' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <TruckIcon />
              <div>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>Resource Allocation</p>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>{logistics.resources.trucksAllocated || 0} Trucks</h2>
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderLeft: '4px solid #f59e0b' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <RouteIcon />
              <div>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>Optimized Route Distance</p>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>{logistics.resources.routeDistanceKm || 0} km</h2>
              </div>
            </div>
          </div>

          <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', borderLeft: '4px solid #ef4444' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <TrashIcon />
              <div>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '0.875rem' }}>Critical Alerts</p>
                <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold' }}>{criticalBins} Full Bins</h2>
              </div>
            </div>
          </div>
        </div>

        {/* --- Main Dashboard Area --- */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '1.5rem' }}>
          
          {/* Map Section */}
          <div style={{ backgroundColor: '#fff', borderRadius: '0.5rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem', fontWeight: '600' }}>Dynamic Fleet Routing</h3>
            <div style={{ height: '500px', borderRadius: '0.375rem', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
              <MapContainer center={[-19.503, 29.833]} zoom={15} style={{ height: '100%', width: '100%', zIndex: 1 }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
                <LocationFinder />
                <MapUpdater bins={bins} />
                
                {/* Draw the AI optimized route line */}
                {logistics.activeRoute && logistics.activeRoute.length > 1 && (
                  <Polyline positions={logistics.activeRoute} color="#8b5cf6" weight={4} dashArray="10, 10" />
                )}

                {bins.map(bin => (
                  <Marker key={bin.id} position={[bin.lat, bin.lng]}>
                    <Popup>
                      <strong>{bin.location}</strong><br />
                      Fill Level: {bin.fillLevel}%<br />
                      <span style={{ color: '#8b5cf6', fontWeight: 'bold' }}>AI Predicts: {bin.prediction || "Pending"}</span>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>

          {/* List Section */}
          <div style={{ backgroundColor: '#fff', borderRadius: '0.5rem', padding: '1.5rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '600' }}>Live Bin Monitor</h3>
              <span style={{ backgroundColor: '#f3f4f6', padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.875rem', fontWeight: '500' }}>
                Targeting {logistics.resources.binsToCollect || 0} Critical Bins
              </span>
            </div>
            
            {bins.map(bin => (
              <div key={bin.id} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid #f3f4f6' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <PinIcon />
                    <span style={{ fontWeight: '500' }}>{bin.location}</span>
                  </div>
                  <span style={{ color: '#8b5cf6', fontSize: '0.875rem', fontWeight: 'bold' }}>{bin.prediction}</span>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ flexGrow: 1, backgroundColor: '#e5e7eb', height: '1rem', borderRadius: '9999px', overflow: 'hidden' }}>
                    <div style={{ width: `${bin.fillLevel}%`, height: '100%', backgroundColor: bin.fillLevel >= 90 ? '#ef4444' : bin.fillLevel >= 75 ? '#f59e0b' : '#10b981', transition: 'width 0.5s' }} />
                  </div>
                  <span style={{ fontWeight: 'bold', width: '3rem', textAlign: 'right' }}>{bin.fillLevel}%</span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
      <InstallPrompt />
    </div>
  );
};

export default App;