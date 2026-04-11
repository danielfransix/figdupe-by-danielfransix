#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "server/node_modules/ws" ]; then
    echo "Installing dependencies..."
    cd server
    npm install
    cd ..
fi

echo "Starting figdupe server..."
node server/server.js
