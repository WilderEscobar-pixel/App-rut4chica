#!/bin/bash
cd /home/z/my-project
while true; do
  > /home/z/my-project/dev.log
  NODE_OPTIONS="--max-old-space-size=256" node node_modules/.bin/next dev -p 3000 >> /home/z/my-project/dev.log 2>&1
  echo "[$(date)] Server exited, restarting in 2s..." >> /home/z/my-project/dev.log
  sleep 2
done
