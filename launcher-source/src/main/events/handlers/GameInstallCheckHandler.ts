import {
  getGameInstallStatusContextsForConfigChange,
  reconcileGameInstallStatus,
  shouldReconcileGameInstallStatusOnConfigChange,
} from "../../game/GameInstallStatusReconciler";
import {
  AppContext,
  EventHandler,
  ConfigChangeEvent,
  EventType,
} from "../types";

/**
 * Handler to check game installation status when configuration changes
 */
export const GameInstallCheckHandler: EventHandler<ConfigChangeEvent> = {
  id: "GameInstallCheckHandler",
  targetEvent: EventType.CONFIG_CHANGE,

  condition: (event) => shouldReconcileGameInstallStatusOnConfigChange(event),

  handle: async (event, context: AppContext) => {
    const targets = getGameInstallStatusContextsForConfigChange(event, context);

    for (const { serviceId, gameId } of targets) {
      await reconcileGameInstallStatus(context, serviceId, gameId, {
        reason: `config-change:${event.payload.key}`,
      });
    }
  },
};
