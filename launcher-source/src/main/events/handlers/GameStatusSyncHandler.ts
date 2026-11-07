import { updateGameStatusCache } from "../../state/GameStatusStore";
import { EventHandler, EventType, GameStatusChangeEvent } from "../types";

export const GameStatusSyncHandler: EventHandler<GameStatusChangeEvent> = {
  id: "GameStatusSyncHandler",
  targetEvent: EventType.GAME_STATUS_CHANGE,

  handle: async (event, context) => {
    const payload = updateGameStatusCache(event.payload);

    // Send structured status update to Main Window (Renderer)
    if (context.mainWindow && !context.mainWindow.isDestroyed()) {
      context.mainWindow.webContents.send("game-status-update", payload);
    }
  },
};
