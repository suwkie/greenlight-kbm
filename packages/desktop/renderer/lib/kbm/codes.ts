/**
 * Physical key (KeyboardEvent.code) to Windows virtual key (VK) lookup.
 *
 * The Xbox input protocol expects a VK code in keyboard frame reports. The
 * browser's `KeyboardEvent.keyCode` already contains a VK code, but it is
 * derived from the character produced by the key which makes it layout
 * dependent (AZERTY, Dvorak, ...). `KeyboardEvent.code` identifies the physical
 * key, so mapping that to a VK keeps WASD in the same place on every layout.
 */
const CODE_TO_VK: { [code: string]: number } = {
    Backspace: 0x08,
    Tab: 0x09,
    Enter: 0x0d,
    NumpadEnter: 0x0d,
    ShiftLeft: 0x10,
    ShiftRight: 0x10,
    ControlLeft: 0x11,
    ControlRight: 0x11,
    AltLeft: 0x12,
    AltRight: 0x12,
    Pause: 0x13,
    CapsLock: 0x14,
    Escape: 0x1b,
    Space: 0x20,
    PageUp: 0x21,
    PageDown: 0x22,
    End: 0x23,
    Home: 0x24,
    ArrowLeft: 0x25,
    ArrowUp: 0x26,
    ArrowRight: 0x27,
    ArrowDown: 0x28,
    PrintScreen: 0x2c,
    Insert: 0x2d,
    Delete: 0x2e,
    MetaLeft: 0x5b,
    MetaRight: 0x5c,
    ContextMenu: 0x5d,
    NumpadMultiply: 0x6a,
    NumpadAdd: 0x6b,
    NumpadSubtract: 0x6d,
    NumpadDecimal: 0x6e,
    NumpadDivide: 0x6f,
    NumLock: 0x90,
    ScrollLock: 0x91,
    Semicolon: 0xba,
    Equal: 0xbb,
    Comma: 0xbc,
    Minus: 0xbd,
    Period: 0xbe,
    Slash: 0xbf,
    Backquote: 0xc0,
    BracketLeft: 0xdb,
    Backslash: 0xdc,
    BracketRight: 0xdd,
    Quote: 0xde,
    IntlBackslash: 0xe2,
}

for (let i = 0; i < 26; i++) {
    CODE_TO_VK['Key' + String.fromCharCode(65 + i)] = 65 + i
}

for (let i = 0; i <= 9; i++) {
    CODE_TO_VK['Digit' + i] = 48 + i
    CODE_TO_VK['Numpad' + i] = 96 + i
}

for (let i = 1; i <= 12; i++) {
    CODE_TO_VK['F' + i] = 111 + i
}

/**
 * Returns the VK code for a physical key. Falls back to the (deprecated)
 * KeyboardEvent.keyCode which Chromium still fills in with a VK code.
 */
export function virtualKeyFor(event: KeyboardEvent): number {
    const code = CODE_TO_VK[event.code]
    if (code !== undefined) {
        return code
    }

    return event.keyCode || 0
}

/** Human readable label for a KeyboardEvent.code value. */
export function keyLabelForCode(code: string): string {
    if (code === '') {
        return 'None'
    }

    if (code.indexOf('Key') === 0) {
        return code.substring(3)
    }

    if (code.indexOf('Digit') === 0) {
        return code.substring(5)
    }

    if (code.indexOf('Numpad') === 0) {
        return 'Num ' + code.substring(6)
    }

    switch (code) {
        case 'Escape': return 'Esc'
        case 'ControlLeft': return 'Left Ctrl'
        case 'ControlRight': return 'Right Ctrl'
        case 'ShiftLeft': return 'Left Shift'
        case 'ShiftRight': return 'Right Shift'
        case 'AltLeft': return 'Left Alt'
        case 'AltRight': return 'Right Alt'
        case 'MetaLeft': return 'Left Meta'
        case 'MetaRight': return 'Right Meta'
        case 'Space': return 'Space'
        case 'ArrowUp': return 'Up'
        case 'ArrowDown': return 'Down'
        case 'ArrowLeft': return 'Left'
        case 'ArrowRight': return 'Right'
        default: return code
    }
}
