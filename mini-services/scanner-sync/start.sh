#!/bin/bash
cd /home/z/my-project/mini-services/scanner-sync
exec bun --hot index.ts 2>&1
