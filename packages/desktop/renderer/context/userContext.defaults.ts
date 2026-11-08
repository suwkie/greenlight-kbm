export const defaultSettings = {
    xhome_bitrate: 0,
    xcloud_bitrate: 0,
    xcloud_show_non_entitled: true,
    video_profiles: [],
    preferred_game_language: 'en-US',
    controller_vibration: true,
    video_size: 'default',
    force_region_ip: '',
    input_touch: false,
    // Legacy key. Kept for migration to input_kbm_mode; not shown in the UI.
    input_mousekeyboard: false,
    input_kbm_mode: 'off',
    input_kbm_sensitivity: 1,
    input_kbm_invert_y: false,
    input_kbm_deadzone: 0,
    input_kbm_curve: 1,
    input_kbm_left_click: 'rightTrigger',
    input_kbm_right_click: 'leftTrigger',
    input_kbm_middle_click: 'none',
    input_kbm_toggle_key: 'F8',
    input_mousekeyboard_config: {
        ArrowLeft: 'DPadLeft',
        ArrowUp: 'DPadUp',
        ArrowRight: 'DPadRight',
        ArrowDown: 'DPadDown',

        Enter: 'A',
        a: 'A',

        Backspace: 'B',
        b: 'B',

        x: 'X',
        y: 'Y',

        '[': 'LeftShoulder',
        ']': 'RightShoulder',

        '-': 'LeftTrigger',
        '=': 'RightTrigger',

        v: 'View',
        m: 'Menu',
        n: 'Nexus',
    },
    input_newgamepad: false,
    app_lowresolution: false,

    video_enabled: true,
    audio_enabled: true,

    // Latency / streaming
    latency_jitter_buffer_ms: 0,
    latency_immediate_input: true,
    latency_direct_lan: false,

    // WebUI
    webui_autostart: false,
    webui_port: 9003,

    // Selected language for i18n
    language: 'en-US',
}
