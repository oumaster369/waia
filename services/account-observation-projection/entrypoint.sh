#!/bin/sh
set -eu
PATH=/usr/local/bin:/usr/bin:/bin
export PATH

readonly RUNTIME_DIR=/run/waia-observation-projection
readonly LOCK_PATH="$RUNTIME_DIR/lifetime.lock"
readonly UID_EXPECTED=10001

refuse() {
  printf '%s\n' 'ACCOUNT_OBSERVATION_PROJECTION_UNAVAILABLE' >&2
  exit 75
}

[ "$(uname -s)" = "Linux" ] || refuse
[ "$(id -u)" = "$UID_EXPECTED" ] || refuse
[ "$#" -eq 0 ] || refuse
umask 077
[ -d "$RUNTIME_DIR" ] && [ ! -L "$RUNTIME_DIR" ] || refuse
[ "$(stat -c '%u' "$RUNTIME_DIR")" = "$UID_EXPECTED" ] || refuse
[ "$(stat -c '%a' "$RUNTIME_DIR")" = "2750" ] || refuse

# Create only once. Never unlink or replace the lock inode: restarts must open
# the same file so a second process cannot evade a live holder's flock.
if [ -L "$LOCK_PATH" ]; then refuse; fi
if [ ! -e "$LOCK_PATH" ]; then
  ( set -C; : > "$LOCK_PATH" ) 2>/dev/null || :
fi
[ -f "$LOCK_PATH" ] && [ ! -L "$LOCK_PATH" ] || refuse
[ "$(stat -c '%u' "$LOCK_PATH")" = "$UID_EXPECTED" ] || refuse
[ "$(stat -c '%a' "$LOCK_PATH")" = "600" ] || refuse
[ "$(stat -c '%h' "$LOCK_PATH")" = "1" ] || refuse

# FD 9 is inherited by exec'd Node. flock operates on the open description;
# it does not fork a supervisor or create a second service process.
exec 9>>"$LOCK_PATH"
path_inode=$(stat -c '%d:%i' "$LOCK_PATH") || refuse
fd_inode=$(stat -Lc '%d:%i' "/proc/$$/fd/9") || refuse
[ "$path_inode" = "$fd_inode" ] || refuse
flock --nonblock --conflict-exit-code 75 9 || refuse

# Recheck after acquisition to reject path replacement before runtime startup.
path_inode=$(stat -c '%d:%i' "$LOCK_PATH") || refuse
fd_inode=$(stat -Lc '%d:%i' "/proc/$$/fd/9") || refuse
[ "$path_inode" = "$fd_inode" ] || refuse
exec /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin NODE_ENV=production \
  /usr/local/bin/node --conditions=react-server /app/account-observation-projection-host.mjs
