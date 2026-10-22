// One watch while the app is visible. OS permission changes resume/stop it.
export function createLocationSession({
  geolocation,
  permissions,
  loadData,
  onPosition,
  onStatus,
  positionOptions = () => ({
    enableHighAccuracy: true,
    maximumAge: 10000,
    timeout: 20000,
  }),
}) {
  let watch = null,
    generation = 0,
    pending = null,
    data,
    blocked = false,
    visible = true,
    permissionBound = false;
  function stop() {
    visible = false;
    generation++;
    pending = null;
    if (watch !== null) geolocation?.clearWatch(watch);
    watch = null;
  }
  async function bindPermission() {
    if (permissionBound || !permissions?.query) return;
    permissionBound = true;
    try {
      const status = await permissions.query({ name: "geolocation" });
      status.addEventListener("change", () => {
        if (status.state === "denied") {
          const wasVisible = visible;
          blocked = true;
          stop();
          visible = wasVisible;
          onStatus("denied");
        } else {
          blocked = false;
          if (visible) start({ retry: true });
        }
      });
    } catch {
      /* Safari versions without geolocation permission queries still use watch errors. */
    }
  }
  async function start({ retry = false } = {}) {
    visible = true;
    if (watch !== null) return;
    if (pending) return pending;
    if (blocked && !retry) return;
    if (!geolocation) {
      onStatus("unsupported");
      return;
    }
    blocked = false;
    const token = ++generation;
    onStatus("loading");
    bindPermission();
    pending = (async () => {
      try {
        data ??= await loadData();
        if (token !== generation) return;
        watch = geolocation.watchPosition(
          (position) => {
            if (token !== generation) return;
            onStatus("active");
            onPosition(position, data);
          },
          (error) => {
            if (token !== generation) return;
            if (error.code === 1) {
              blocked = true;
              const wasVisible = visible;
              stop();
              visible = wasVisible;
              onStatus("denied");
            } else onStatus("unavailable");
          },
          positionOptions(),
        );
      } catch {
        if (token === generation) onStatus("unavailable");
      } finally {
        if (token === generation) pending = null;
      }
    })();
    return pending;
  }
  return {
    start,
    stop,
    get active() {
      return watch !== null;
    },
  };
}
