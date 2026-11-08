import KbmInputDriver from './driver'
import { KbmRuntimeSettings, KbmStatus, MouseAction } from './types'

const MOUSE_ACTIONS: Array<MouseAction> = [
    'none',
    'rightTrigger',
    'leftTrigger',
    'A',
    'B',
    'X',
    'Y',
    'LeftShoulder',
    'RightShoulder',
]

function numberOrDefault(value: any, fallback: number): number {
    const parsed = typeof value === 'number' ? value : parseFloat(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function mouseActionOrDefault(value: any, fallback: MouseAction): MouseAction {
    return MOUSE_ACTIONS.indexOf(value) >= 0 ? value : fallback
}

/**
 * Translates the flat settings object into the input settings used by the
 * driver. Keeping this in one place makes the defaults (and the migration from
 * the old `input_mousekeyboard` checkbox) explicit.
 */
export function resolveKbmSettings(settings: any): KbmRuntimeSettings {
    const legacyMode = settings?.input_mousekeyboard === true ? 'native' : 'off'
    const rawMode = settings?.input_kbm_mode

    return {
        mode: rawMode === 'native' || rawMode === 'gamepad' || rawMode === 'off' ? rawMode : legacyMode,
        sensitivity: Math.max(0.05, numberOrDefault(settings?.input_kbm_sensitivity, 1)),
        invertY: settings?.input_kbm_invert_y === true,
        deadzone: Math.min(0.9, Math.max(0, numberOrDefault(settings?.input_kbm_deadzone, 0))),
        curve: Math.max(0.1, numberOrDefault(settings?.input_kbm_curve, 1)),
        leftClick: mouseActionOrDefault(settings?.input_kbm_left_click, 'rightTrigger'),
        rightClick: mouseActionOrDefault(settings?.input_kbm_right_click, 'leftTrigger'),
        middleClick: mouseActionOrDefault(settings?.input_kbm_middle_click, 'none'),
        toggleKey: typeof settings?.input_kbm_toggle_key === 'string' ? settings.input_kbm_toggle_key : 'F8',
        keyMapping: settings?.input_mousekeyboard_config !== undefined ? settings.input_mousekeyboard_config : {},
    }
}

export interface KbmPlayerConfig {
    input_driver?: any;
    input_legacykeyboard: boolean;
    input_mousekeyboard: boolean;
    input_mousekeyboard_config: any;
}

export interface KbmRuntime {
    settings: KbmRuntimeSettings;
    driver: KbmInputDriver | undefined;
    enabled: boolean;
    playerConfig: KbmPlayerConfig;
    getStatus(): KbmStatus;
    subscribe(listener: (status: KbmStatus) => void): () => void;
    toggleMode(): void;
    destroy(): void;
}

/**
 * Creates the keyboard & mouse runtime for a stream.
 *
 * The returned `playerConfig` is spread into the `xCloudPlayer` constructor.
 * When the mode is enabled the player's own input driver is replaced by ours so
 * that native keyboard/mouse reports and gamepad emulation can be combined in a
 * single, coherent input stream. When the mode is off the previous behaviour is
 * preserved.
 */
export function createKbmRuntime(rawSettings: any): KbmRuntime {
    const settings = resolveKbmSettings(rawSettings)
    const enabled = settings.mode !== 'off'
    const listeners = new Set<(status: KbmStatus) => void>()

    const driver = enabled ? new KbmInputDriver(settings) : undefined

    if (driver !== undefined) {
        driver.setStatusListener((status) => {
            listeners.forEach((listener) => {
                listener(status)
            })
        })
    }

    const defaultStatus: KbmStatus = {
        supported: false,
        locked: false,
        mode: settings.mode === 'native' ? 'native' : 'gamepad',
        enabled,
    }

    const runtime: KbmRuntime = {
        settings,
        driver,
        enabled,
        playerConfig: enabled ? {
            input_driver: driver,
            // Our driver is the one producing gamepad frames. The player has to
            // run it via the "new" input path.
            input_legacykeyboard: false,
            input_mousekeyboard: false,
            // Neutralise the player's built-in keyboard mapping; ours is in
            // the driver.
            input_mousekeyboard_config: { _keymapping: {} },
        } : {
            input_legacykeyboard: rawSettings?.input_newgamepad ? false : true,
            input_mousekeyboard: false,
            input_mousekeyboard_config: {
                _keymapping: settings.keyMapping,
            },
        },
        getStatus() {
            return driver !== undefined ? driver.getStatus() : defaultStatus
        },
        subscribe(listener) {
            listeners.add(listener)
            listener(runtime.getStatus())

            return () => {
                listeners.delete(listener)
            }
        },
        toggleMode() {
            driver?.toggleMode()
        },
        destroy() {
            listeners.clear()
            driver?.stop()
        },
    }

    return runtime
}
