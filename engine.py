import firebase_admin
from firebase_admin import credentials, db
import xgboost as xgb
import pandas as pd
import numpy as np
import networkx as nx
from scipy.spatial import distance_matrix
import math
import argparse
import logging
import os
import time

import notifier

# 1. Initialize Firebase Connection (done in main so `--help` needs no credentials)
def init_firebase():
    cred = credentials.Certificate("smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json")
    firebase_admin.initialize_app(cred, {
        'databaseURL': 'https://smart-waste-gweru-default-rtdb.firebaseio.com/'
    })

def train_forecasting_model():
    """Trains an XGBoost model to predict hours until full based on historical fill rates."""
    # For the prototype, we generate synthetic training data reflecting typical waste patterns
    np.random.seed(42)
    X_train = pd.DataFrame({
        'current_fill': np.random.randint(20, 90, 100),
        'historical_daily_rate': np.random.uniform(5.0, 15.0, 100)
    })
    # Target: hours until hitting 90%
    y_train = ((90 - X_train['current_fill']) / X_train['historical_daily_rate']) * 24
    
    model = xgb.XGBRegressor(objective='reg:squarederror', n_estimators=50, max_depth=3)
    model.fit(X_train, y_train)
    return model

def optimize_route(critical_bins):
    """Calculates the shortest driving path connecting all critical bins."""
    if len(critical_bins) < 2:
        return [bin_data['id'] for bin_data in critical_bins]

    # Extract coordinates
    coords = [[b['lat'], b['lng']] for b in critical_bins]
    
    # Create a distance matrix and solve as a TSP (Traveling Salesperson Problem)
    dist_matrix = distance_matrix(coords, coords)
    G = nx.from_numpy_array(dist_matrix)
    tsp_path = nx.approximation.traveling_salesman_problem(G, cycle=False)
    
    # Return the ordered list of bin IDs based on the optimized route
    return [critical_bins[i]['id'] for i in tsp_path]

def send_bin_alerts(bins_data, resources, dry_run=False):
    """Email the operators about newly-full bins and persist alert state/log."""
    outcome = notifier.process_alerts(
        bins_data,
        db.reference('alertState').get() or {},
        db.reference('settings/alerts').get(),
        notifier.smtp_config_from_env(),
        resources=resources,
        dashboard_url=os.environ.get('DASHBOARD_URL', ''),
        dry_run=dry_run,
    )
    if dry_run:
        return
    for bin_id, state in outcome.state_updates.items():
        db.reference('alertState').child(bin_id).update(state)
    if outcome.log_entry:
        db.reference('alertLog').push(outcome.log_entry)

def run_test_email(dry_run=False):
    """Send a labelled test message to the configured recipients, then log it."""
    settings = notifier.normalize_settings(db.reference('settings/alerts').get())
    entry = notifier.send_test_email(settings['recipients'], notifier.smtp_config_from_env(),
                                     dry_run=dry_run)
    if entry is None:
        return
    print(f"Test email {entry['status']}" + (f": {entry['error']}" if entry.get('error') else "."))
    db.reference('alertLog').push(entry)

def run_logistics_engine(dry_run=False):
    print("Fetching live sensor data from Firebase...")
    bins_ref = db.reference('bins')
    bins_data = bins_ref.get()
    
    if not bins_data:
        print("No bins found in database.")
        return

    public_bins_ref = db.reference('publicBins')

    # Load ML Model
    model = train_forecasting_model()
    
    critical_bins = []
    
    for bin_id, b_data in bins_data.items():
        current_fill = b_data.get('fillLevel', 0)
        
        # 1. Predictive Analytics: Forecast when bin will be full
        # Assuming an average campus fill rate of 8% per day for the prototype
        X_pred = pd.DataFrame({'current_fill': [current_fill], 'historical_daily_rate': [8.0]})
        hours_until_full = float(model.predict(X_pred)[0])
        
        predicted_status = "Critical Now" if current_fill >= 90 else f"Full in {max(1, int(hours_until_full))} hours"
        b_data['prediction'] = predicted_status  # used by the alert email
        
        # Update specific bin with its prediction
        bins_ref.child(bin_id).update({'prediction': predicted_status})

        # Citizen-safe mirror: location and a coarse fill band only. Residents
        # may read /publicBins but never /bins (predictions, sensor internals).
        fill_band = 'critical' if current_fill >= 90 else 'high' if current_fill >= 75 else 'normal'
        public_bins_ref.child(bin_id).set({
            'location': b_data.get('location', bin_id),
            'lat': b_data.get('lat'),
            'lng': b_data.get('lng'),
            'band': fill_band,
        })
        
        # Flag for collection if it's > 80% or will be full in < 12 hours
        if current_fill >= 80 or hours_until_full < 12:
            b_data['id'] = bin_id
            critical_bins.append(b_data)

    # 2. Automation: Optimize Collection Route
    print(f"Identified {len(critical_bins)} bins requiring collection.")
    route_order = optimize_route(critical_bins)
    
    # Build the sequence of GPS coordinates for the dashboard map
    route_coords = [[bins_data[bid]['lat'], bins_data[bid]['lng']] for bid in route_order]
    
    # 3. Resource Requirements Allocation
    # Estimate total distance (rough estimation connecting coordinates)
    total_distance_km = 0
    for i in range(len(route_coords)-1):
        total_distance_km += math.dist(route_coords[i], route_coords[i+1]) * 111 # rough lat/lng to km conversion
    
    trucks_required = max(1, math.ceil(len(critical_bins) / 10)) # Assuming 1 truck per 10 bins
    fuel_estimate = round(total_distance_km * 0.5, 2) # 0.5 Liters per KM estimate
    
    logistics_payload = {
        'activeRoute': route_coords,
        'resources': {
            'trucksAllocated': trucks_required,
            'routeDistanceKm': round(total_distance_km, 2),
            'estimatedFuelLiters': fuel_estimate,
            'binsToCollect': len(critical_bins)
        }
    }
    
    # Push logistics plan to Firebase
    db.reference('logistics').set(logistics_payload)
    print("✓ Predictive analytics and routing complete. Dashboard updated.")

    # 4. Notify: email operators about newly-full bins (never breaks the run)
    try:
        send_bin_alerts(bins_data, logistics_payload['resources'], dry_run)
    except Exception as exc:
        print(f"Alert step failed: {type(exc).__name__}: {exc}")

def watch_seconds(value):
    seconds = int(value)
    if seconds < 30:
        raise argparse.ArgumentTypeError("--watch must be at least 30 seconds")
    return seconds

def main():
    parser = argparse.ArgumentParser(description="Smart Waste logistics engine with email alerts.")
    parser.add_argument('--dry-run', action='store_true',
                        help="do everything except send email or write alert state; print what would be sent")
    parser.add_argument('--test-email', action='store_true',
                        help="send a test email to the configured recipients, then exit")
    parser.add_argument('--watch', type=watch_seconds, metavar='SECONDS',
                        help="rerun the engine every SECONDS (minimum 30)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    notifier.load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))
    init_firebase()

    if args.test_email:
        run_test_email(args.dry_run)
        return
    if not args.watch:
        run_logistics_engine(args.dry_run)
        return

    print(f"Watching: running every {args.watch}s. Press Ctrl-C to stop.")
    try:
        while True:
            try:
                run_logistics_engine(args.dry_run)
            except Exception as exc:
                print(f"Engine cycle failed: {type(exc).__name__}: {exc}")
            time.sleep(args.watch)
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    main()