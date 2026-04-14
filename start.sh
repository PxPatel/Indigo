#!/bin/bash

ROOT="$(cd "$(dirname "$0")/portfolio-dashboard" && pwd)"

# Start backend
cd "$ROOT/backend"
source venv/bin/activate
python -m uvicorn main:app --reload &
BACKEND_PID=$!

# Start frontend
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo "Backend PID: $BACKEND_PID | Frontend PID: $FRONTEND_PID"
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
