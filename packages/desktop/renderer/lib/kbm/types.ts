export type KbmMode = 'off' | 'native' | 'gamepad'

export type KbmActiveMode = 'native' | 'gamepad'

export type MouseAction =
    | 'none'
    | 'rightTrigger'
    | 'leftTrigger'
    | 'A'
    | 'B'
    | 'X'
    | 'Y'
    | 'LeftShoulder'
    | 'RightShoulder'

export interface KbmRuntimeSettings {
    mode: KbmMode;
    sensitivity: number;
    invertY: boolean;
    deadzone: number;
    curve: number;
    leftClick: MouseAction;
    rightClick: MouseAction;
    middleClick: MouseAction;
    toggleKey: string;
    keyMapping: { [key: string]: string };
}

export interface KbmStatus {
    /** True when the player exposes a way to deliver native mouse/keyboard frames. */
    supported: boolean;

    /** True when the pointer is captured by the stream. */
    locked: boolean;

    /** Mode currently in use. */
    mode: KbmActiveMode;

    /** True when a mouse/keyboard session is available at all. */
    enabled: boolean;
}

/**
 * The shape of an input frame understood by xbox-xcloud-player. Kept local so
 * that this module does not depend on the package internals.
 */
export interface GamepadFrame {
    GamepadIndex: number;
    Nexus: number;
    Menu: number;
    View: number;
    A: number;
    B: number;
    X: number;
    Y: number;
    DPadUp: number;
    DPadDown: number;
    DPadLeft: number;
    DPadRight: number;
    LeftShoulder: number;
    RightShoulder: number;
    LeftThumb: number;
    RightThumb: number;
    LeftThumbXAxis: number;
    LeftThumbYAxis: number;
    RightThumbXAxis: number;
    RightThumbYAxis: number;
    LeftTrigger: number;
    RightTrigger: number;
}

export interface MouseFrame {
    X: number;
    Y: number;
    WheelX: number;
    WheelY: number;
    Buttons: number;
    Relative: number;
}

export interface KeyboardFrame {
    pressed: boolean;
    keyCode: number;
    key: string;
}
