#!/bin/bash
# Gen 3 Map Blueprint - double-click to start (macOS).
# The first run installs the tool's parts into this folder (node_modules);
# nothing is installed anywhere else on your computer.
# If macOS says it can't open this file, see "Mac" in README.md.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is not installed, so the tool can't start."
  echo "  Install the LTS version from https://nodejs.org , then double-click start.command again."
  echo
  read -r -p "Press Return to close."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo
  echo "  First run: installing the tool's parts into this folder. This takes a minute..."
  echo
  if ! npm ci --no-audit; then
    echo
    echo "  Installing failed. Check your internet connection, then try again."
    read -r -p "Press Return to close."
    exit 1
  fi
fi

echo
echo "  Starting Gen 3 Map Blueprint. Your browser will open in a moment."
echo "  Keep this window open while you work. Close it to stop the tool."
echo
npm run dev -- --open
