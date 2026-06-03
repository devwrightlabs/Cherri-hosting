#!/bin/bash

# Start the backend server in the background
(cd server && npm run dev) &
SERVER_PID=$!

# Start the frontend dev server
(cd client && npm run dev) &
CLIENT_PID=$!

# Wait for both
wait $SERVER_PID $CLIENT_PID
