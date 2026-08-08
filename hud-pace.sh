#!/bin/bash
# Prints the quota pace for both limit windows as a claude-hud --extra-cmd label.
#
# Reads the rate limit snapshot the abtop statusline hook writes, works out how
# far into each window we are, and compares that with how much quota is spent.
# Positive means quota to spare, negative means burning it too fast.
#
#   pace 5h +4 · 7d +13   both windows have room
#   pace 5h -9 · 7d +13   5h window is burning fast, week is fine
#
# Prints nothing when the snapshot is missing, stale, or has no usable window,
# so claude-hud just omits the label.
set -uo pipefail

CONFIG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SNAPSHOT="$CONFIG_DIR/abtop-rate-limits.json"
STALE_AFTER=900

[ -r "$SNAPSHOT" ] || exit 0

jq -r --argjson stale "$STALE_AFTER" '
  def pace($w; $window; $name):
    if $w == null or $w.resets_at == null or $w.used_percentage == null then empty
    elif $w.resets_at <= now then empty
    else
      ($w.resets_at - $window) as $start
      | (((now - $start) / $window * 100) | round | if . < 0 then 0 elif . > 100 then 100 else . end) as $elapsed
      | ($elapsed - ($w.used_percentage | round)) as $delta
      | "\($name) \(if $delta > 0 then "+" else "" end)\($delta)"
    end;
  (.updated_at // 0) as $updated
  | if (now - $updated) > $stale then empty
    else
      [ pace(.five_hour; 18000; "5h"), pace(.seven_day; 604800; "7d") ]
      | if length == 0 then empty else "pace " + join(" · ") end
    end
' "$SNAPSHOT" 2>/dev/null
