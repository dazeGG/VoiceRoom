// The desktop app's bridge, as apps/web/src/app.d.ts declares it; the site reads only this flag.
interface Window {
  voiceRoomRuntime?: { isDesktop?: boolean };
}
