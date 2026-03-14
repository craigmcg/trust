#!/bin/bash
# Installs the nightly cron job to run at 2:00 AM daily

SCRIPT="$(cd "$(dirname "$0")" && pwd)/nightly.sh"
chmod +x "$SCRIPT"

# Check if already installed
if crontab -l 2>/dev/null | grep -q "trust.*nightly"; then
  echo "Cron job already installed."
  crontab -l | grep trust
  exit 0
fi

# Add to crontab (runs at 2:00 AM daily)
(crontab -l 2>/dev/null; echo "0 2 * * * $SCRIPT") | crontab -

echo "Cron job installed. Will run nightly at 2:00 AM."
echo ""
echo "To verify:  crontab -l"
echo "To remove:  crontab -l | grep -v trust | crontab -"
echo "To view log: tail -f ~/Library/Logs/trust-nightly.log"
