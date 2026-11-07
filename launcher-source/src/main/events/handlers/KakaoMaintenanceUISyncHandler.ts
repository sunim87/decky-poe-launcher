import {
  AppContext,
  EventHandler,
  EventType,
  KakaoMaintenanceDetectedEvent,
} from "../types";

export const KakaoMaintenanceUISyncHandler: EventHandler<KakaoMaintenanceDetectedEvent> =
  {
    id: "KakaoMaintenanceUISyncHandler",
    targetEvent: EventType.KAKAO_MAINTENANCE_DETECTED,

    handle: async (event, context: AppContext) => {
      if (context.mainWindow && !context.mainWindow.isDestroyed()) {
        context.mainWindow.webContents.send(
          "kakao:maintenance-detected",
          event.payload,
        );
      }
    },
  };
