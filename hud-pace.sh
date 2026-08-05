#!/bin/bash
# Prints the 7 day quota pace as a claude-hud --extra-cmd label.
#
# Reads the rate limit snapshot the abtop statusline hook writes, works out how
# far into the 7 day window we are, and compares that with how much quota is
# spent. Positive means quota to spare, negative means burning it too fast.
#
#   pace +13 (46% elapsed)   used 33%, window 46% through: room for more agents
#   pace -13 (46% elapsed)   used 59%, window 46% through: throttle
#
# Prints nothing when the snapshot is missing, stale, or has no 7 day window,
# so claude-hud just omits the label.
set -uo pipefail

CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SNAPSHOT="$CONFIG_DIR/abtop-rate-limits.json"
STALE_AFTER=900

[ -r "$SNAPSHOT" ] || exit 0

jq -r --argjson stale "$STALE_AFTER" '
  604800 as $window
  | (.updated_at // 0) as $updated
  | .seven_day as $sd
  | if $sd == null or $sd.resets_at == null or $sd.used_percentage == null then empty
    elif (now - $updated) > $stale then empty
    elif $sd.resets_at <= now then empty
    else
      ($sd.resets_at - $window) as $start
      | (((now - $start) / $window * 100) | round | if . < 0 then 0 elif . > 100 then 100 else . end) as $elapsed
      | ($elapsed - ($sd.used_percentage | round)) as $delta
      | "pace \(if $delta > 0 then "+" else "" end)\($delta) (\($elapsed)% elapsed)"
    end
' "$SNAPSHOT" 2>/dev/null
