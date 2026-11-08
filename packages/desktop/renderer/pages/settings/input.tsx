import React from 'react'
import Head from 'next/head'

import SettingsSidebar from '../../components/settings/sidebar'
import Card from '../../components/ui/card'

import { useSettings } from '../../context/userContext'
import { defaultSettings } from '../../context/userContext.defaults'
import { keyLabelForCode } from '../../lib/kbm/codes'

import { useTranslation } from 'react-i18next'

const MOUSE_ACTIONS = [
    { value: 'none', labelKey: 'settings.input.kbmActionNone' },
    { value: 'rightTrigger', labelKey: 'settings.input.kbmActionRightTrigger' },
    { value: 'leftTrigger', labelKey: 'settings.input.kbmActionLeftTrigger' },
    { value: 'A', labelKey: 'settings.input.kbmActionA' },
    { value: 'B', labelKey: 'settings.input.kbmActionB' },
    { value: 'X', labelKey: 'settings.input.kbmActionX' },
    { value: 'Y', labelKey: 'settings.input.kbmActionY' },
    { value: 'LeftShoulder', labelKey: 'settings.input.kbmActionLeftShoulder' },
    { value: 'RightShoulder', labelKey: 'settings.input.kbmActionRightShoulder' },
]

// Escape releases the mouse, modifiers are used while playing and W/A/S/D
// drive the left stick. None of them make a usable mode switch key.
const DISALLOWED_TOGGLE_CODES = [
    'Escape',
    'Tab',
    'ShiftLeft',
    'ShiftRight',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    // Keys used by the default gamepad bindings.
    'KeyB',
    'KeyX',
    'KeyY',
    'KeyV',
    'KeyM',
    'KeyN',
    'Enter',
    'Backspace',
    'BracketLeft',
    'BracketRight',
    'Minus',
    'Equal',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
]

interface KbmRangeProps {
    id: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (value: number) => string;
    onCommit: (value: number) => void;
    resetToken: number;
}

/**
 * Range input that keeps its own value while dragging and only persists the
 * setting once the user stops moving. Writing electron-store on every
 * pointermove would cause a disk write (and a settings re-render) per frame.
 */
function KbmRange({
    id,
    value,
    min,
    max,
    step,
    format,
    onCommit,
    resetToken,
}: KbmRangeProps) {
    const [local, setLocal] = React.useState(value)
    const commitTimer = React.useRef<any>(undefined)
    const pendingValue = React.useRef<number | undefined>(undefined)
    const commitRef = React.useRef(onCommit)
    commitRef.current = onCommit

    React.useEffect(() => {
        setLocal(value)
    }, [value])

    React.useEffect(() => {
        // Resetting the settings cancels a pending debounced commit instead of
        // replaying the old value after the reset.
        if (commitTimer.current !== undefined) {
            clearTimeout(commitTimer.current)
        }

        pendingValue.current = undefined
    }, [resetToken])

    React.useEffect(() => {
        return () => {
            if (commitTimer.current !== undefined) {
                clearTimeout(commitTimer.current)
            }

            // Do not lose a value that was still waiting for the debounce when
            // the component unmounts (e.g. switching settings pages).
            if (pendingValue.current !== undefined) {
                commitRef.current(pendingValue.current)
            }
        }
    }, [])

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
        const next = parseFloat(event.target.value)
        setLocal(next)
        pendingValue.current = next

        if (commitTimer.current !== undefined) {
            clearTimeout(commitTimer.current)
        }

        commitTimer.current = setTimeout(() => {
            pendingValue.current = undefined
            commitRef.current(next)
        }, 150)
    }

    return (
        <React.Fragment>
            <input id={id} type='range' min={min} max={max} step={step} value={local} onChange={handleChange} />
            &nbsp;({ format(local) })
        </React.Fragment>
    )
}

function invert(obj) {
    const new_obj = {}
    for (const prop in obj) {
        new_obj[obj[prop]] = prop
    }
    return new_obj
}

function KeySettings({keyConfigs, setKeyConfig}) {
    const { t } = useTranslation()
    const mappableButtons = ['DPadUp', 'DPadDown', 'DPadLeft', 'DPadRight', 'A', 'B', 'X', 'Y', 'View', 'Menu', 'Nexus', 'LeftShoulder', 'RightShoulder', 'LeftTrigger', 'RightTrigger', 'LeftThumb', 'RightThumb']
    // console.log('KEYS:', keyConfigs, mappableButtons)
    keyConfigs = invert(keyConfigs)
    return <p>
        {
            mappableButtons.map(
                (btn:string) => {
                    let fullBtnText = ''

                    switch(btn){
                        case 'DPadUp':
                            fullBtnText = t('settings.input.dPadUp')
                            break
                        case 'DPadDown':
                            fullBtnText = t('settings.input.dPadDown')
                            break
                        case 'DPadLeft':
                            fullBtnText = t('settings.input.dPadLeft')
                            break
                        case 'DPadRight':
                            fullBtnText = t('settings.input.dPadRight')
                            break
                        case 'LeftShoulder':
                            fullBtnText = t('settings.input.leftShoulder')
                            break
                        case 'RightShoulder':
                            fullBtnText = t('settings.input.rightShoulder')
                            break
                        case 'LeftTrigger':
                            fullBtnText = t('settings.input.leftTrigger')
                            break
                        case 'RightTrigger':
                            fullBtnText = t('settings.input.rightTrigger')
                            break
                        case 'LeftThumb':
                            fullBtnText = t('settings.input.leftThumb')
                            break
                        case 'RightThumb':
                            fullBtnText = t('settings.input.rightThumb')
                            break
                        case 'View':
                            fullBtnText = t('settings.input.view')
                            break
                        case 'Menu':
                            fullBtnText = t('settings.input.menu')
                            break
                        case 'Nexus':
                            fullBtnText = t('settings.input.nexus')
                        default:
                            fullBtnText = btn
                            break
                    }

                    return <p key={btn}>
                        <label>{fullBtnText}</label>
                        <label style={{minWidth: 0}}>
                            <input type='text' className='text' readOnly onKeyUp={(e) => setKeyConfig(btn, e)} value={keyConfigs[btn] ?? t('settings.input.none')}/>
                        </label>
                    </p>
                }
            )
        }
    </p>
}

function SettingsInput() {
    const { settings, setSettings} = useSettings()
    const [ , setControllerPing] = React.useState(0)

    const [controllerKeys, setControllerKeys] = React.useState<any>(settings.input_mousekeyboard_config)
    const [resetToken, setResetToken] = React.useState(0)

    const { t } = useTranslation()

    React.useEffect(() => {
        const controllerInterval = setInterval(() => {
            setControllerPing(Date.now())
        }, 1000)

        return () => {
            clearInterval(controllerInterval)
        }
    }, [])

    // Settings can arrive asynchronously (IPC). Keep the edited mapping in
    // sync with the stored one instead of writing a stale default back.
    React.useEffect(() => {
        setControllerKeys(settings.input_mousekeyboard_config)
    }, [settings.input_mousekeyboard_config])

    function setControllerVibration(){
        setSettings({
            ...settings,
            controller_vibration: (! settings.controller_vibration),
        })
    }

    function setTouchInput(){
        setSettings({
            ...settings,
            input_touch: (! settings.input_touch),
        })
    }

    function setLegacyInput(){
        setSettings({
            ...settings,
            input_newgamepad: (! settings.input_newgamepad),
        })
    }

    // Range inputs commit after a debounce. Always merge into the latest
    // settings instead of the object captured when the handler was created.
    const settingsRef = React.useRef(settings)
    settingsRef.current = settings

    function setKbmSetting(key: string, value: any){
        setSettings({
            ...settingsRef.current,
            [key]: value,
        })
    }

    function setKbmMode(mode: string){
        setKbmSetting('input_kbm_mode', mode)
    }

    function resetKbmSettings(){
        setResetToken((value) => value + 1)
        setControllerKeys({...defaultSettings.input_mousekeyboard_config})

        setSettings({
            ...settings,
            input_kbm_sensitivity: defaultSettings.input_kbm_sensitivity,
            input_kbm_invert_y: defaultSettings.input_kbm_invert_y,
            input_kbm_deadzone: defaultSettings.input_kbm_deadzone,
            input_kbm_curve: defaultSettings.input_kbm_curve,
            input_kbm_left_click: defaultSettings.input_kbm_left_click,
            input_kbm_right_click: defaultSettings.input_kbm_right_click,
            input_kbm_middle_click: defaultSettings.input_kbm_middle_click,
            input_kbm_toggle_key: defaultSettings.input_kbm_toggle_key,
            input_mousekeyboard_config: {...defaultSettings.input_mousekeyboard_config},
        })
    }

    function setToggleKey(event: React.KeyboardEvent<HTMLInputElement>){
        if (event.code === 'Escape') {
            event.currentTarget.blur()
            return
        }

        if (DISALLOWED_TOGGLE_CODES.indexOf(event.code) >= 0) {
            // Let Tab and modifier keys behave normally instead of trapping
            // focus in the capture field.
            return
        }

        event.preventDefault()

        if(event.code !== undefined && event.code !== ''){
            setKbmSetting('input_kbm_toggle_key', event.code)
        }

        event.currentTarget.blur()
    }

    function setKeyConfig(button:string, event) {
        let ckeys = { ...(controllerKeys ?? {}) }

        for (const ckeysKey of Object.keys(ckeys)) {
            if(ckeys[ckeysKey] === button) delete ckeys[ckeysKey]
        }

        if (event.key !== 'Escape')
            ckeys[event.key] = button

        setControllerKeys(ckeys)

        event.target.blur()

        setSettings({
            ...settings,
            input_mousekeyboard_config: ckeys,
        })
    }

    const kbmMode = settings.input_kbm_mode ?? 'off'
    const kbmEnabled = kbmMode !== 'off'
    const kbmGamepadMode = kbmMode === 'gamepad'

    return (
        <React.Fragment>
            <Head>
                <title>Greenlight - {t('settings.input.pageTitle')}</title>
            </Head>

            <SettingsSidebar>
                <Card>
                    <h1>{t('settings.input.title')}</h1>

                    <p>
                        <label>{t('settings.input.enableVibration')}</label>
                        <label style={{ minWidth: 0 }}>
                            <input type='checkbox' onChange={ setControllerVibration } checked={settings.controller_vibration} />&nbsp; ({ settings.controller_vibration ? t('settings.input.enabledLabel') : t('settings.input.disabledLabel')})
                        </label>
                    </p>

                    <p>
                        <label>{t('settings.input.enableTouch')}</label>
                        <label style={{ minWidth: 0 }}>
                            <input type='checkbox' onChange={ setTouchInput } checked={settings.input_touch} />&nbsp; ({ settings.input_touch ? t('settings.input.enabledLabel') : t('settings.input.disabledLabel')})
                        </label>
                    </p>

                    <p>
                        <label>{t('settings.input.enableLegacy')}</label>
                        <label style={{ minWidth: 0 }}>
                            <input type='checkbox' onChange={ setLegacyInput } checked={!settings.input_newgamepad} />&nbsp; ({ !settings.input_newgamepad ? t('settings.input.enabledLabel') : t('settings.input.disabledLabel')})
                        </label><br />
                        <small>{t('settings.input.enableLegacyDescription')}</small>
                        { kbmEnabled ? <React.Fragment><br /><small style={{ color: 'orange' }}>{t('settings.input.kbmLegacyNote')}</small></React.Fragment> : null }
                    </p>
                </Card>

                <Card>
                    <h1>{t('settings.input.kbmTitle')}</h1>
                    <p>{t('settings.input.kbmDescription')}</p>

                    <p>
                        <label>{t('settings.input.kbmModeLabel')}</label>
                        <select value={ kbmMode } onChange={ (e) => setKbmMode(e.target.value) }>
                            <option value="off">{t('settings.input.kbmModeOff')}</option>
                            <option value="native">{t('settings.input.kbmModeNative')}</option>
                            <option value="gamepad">{t('settings.input.kbmModeGamepad')}</option>
                        </select>
                    </p>

                    <p>
                        <small>
                            { kbmMode === 'off' ? t('settings.input.kbmModeOffDescription') : null }
                            { kbmMode === 'native' ? t('settings.input.kbmModeNativeDescription') : null }
                            { kbmMode === 'gamepad' ? t('settings.input.kbmModeGamepadDescription') : null }
                        </small>
                    </p>

                    { kbmEnabled ? <React.Fragment>
                        <p>
                            <label>{t('settings.input.kbmSensitivityLabel')}</label>
                            <KbmRange
                                id='kbm-sensitivity'
                                resetToken={resetToken}
                                value={ Number(settings.input_kbm_sensitivity ?? 1) }
                                min={0.1}
                                max={8}
                                step={0.1}
                                format={(value) => value.toFixed(2) + 'x'}
                                onCommit={(value) => setKbmSetting('input_kbm_sensitivity', value)}
                            />
                        </p>

                        <p>
                            <label>{t('settings.input.kbmInvertYLabel')}</label>
                            <label style={{ minWidth: 0 }}>
                                <input type='checkbox' checked={ settings.input_kbm_invert_y } onChange={ (e) => setKbmSetting('input_kbm_invert_y', e.target.checked) } />
                            </label>
                        </p>

                        <p>
                            <label>{t('settings.input.kbmToggleKeyLabel')}</label>
                            <label style={{ minWidth: 0 }}>
                                <input
                                    type='text'
                                    className='text'
                                    readOnly
                                    value={ keyLabelForCode(settings.input_kbm_toggle_key) }
                                    onKeyDown={ setToggleKey }
                                />
                            </label>
                            <br />
                            <small>{t('settings.input.kbmToggleKeyDescription')}</small>
                        </p>

                        { kbmGamepadMode ? <React.Fragment>
                            <p>
                                <label>{t('settings.input.kbmDeadzoneLabel')}</label>
                                <KbmRange
                                    id='kbm-deadzone'
                                    resetToken={resetToken}
                                    value={ Number(settings.input_kbm_deadzone ?? 0) }
                                    min={0}
                                    max={0.5}
                                    step={0.01}
                                    format={(value) => value.toFixed(2)}
                                    onCommit={(value) => setKbmSetting('input_kbm_deadzone', value)}
                                />
                                <br />
                                <small>{t('settings.input.kbmDeadzoneDescription')}</small>
                            </p>

                            <p>
                                <label>{t('settings.input.kbmCurveLabel')}</label>
                                <KbmRange
                                    id='kbm-curve'
                                    resetToken={resetToken}
                                    value={ Number(settings.input_kbm_curve ?? 1) }
                                    min={0.5}
                                    max={2}
                                    step={0.05}
                                    format={(value) => value.toFixed(2)}
                                    onCommit={(value) => setKbmSetting('input_kbm_curve', value)}
                                />
                                <br />
                                <small>{t('settings.input.kbmCurveDescription')}</small>
                            </p>

                            <p>
                                <label>{t('settings.input.kbmLeftClickLabel')}</label>
                                <select value={ settings.input_kbm_left_click } onChange={ (e) => setKbmSetting('input_kbm_left_click', e.target.value) }>
                                    { MOUSE_ACTIONS.map((action) => <option key={action.value} value={action.value}>{t(action.labelKey)}</option>) }
                                </select>
                            </p>

                            <p>
                                <label>{t('settings.input.kbmRightClickLabel')}</label>
                                <select value={ settings.input_kbm_right_click } onChange={ (e) => setKbmSetting('input_kbm_right_click', e.target.value) }>
                                    { MOUSE_ACTIONS.map((action) => <option key={action.value} value={action.value}>{t(action.labelKey)}</option>) }
                                </select>
                            </p>

                            <p>
                                <label>{t('settings.input.kbmMiddleClickLabel')}</label>
                                <select value={ settings.input_kbm_middle_click } onChange={ (e) => setKbmSetting('input_kbm_middle_click', e.target.value) }>
                                    { MOUSE_ACTIONS.map((action) => <option key={action.value} value={action.value}>{t(action.labelKey)}</option>) }
                                </select>
                            </p>

                            <p>
                                <small>{t('settings.input.kbmKeyboardToGamepadNote')}</small>
                            </p>
                        </React.Fragment> : null }

                        <p>
                            <button className='btn' onClick={ resetKbmSettings }>{t('settings.input.kbmResetButton')}</button>
                        </p>
                    </React.Fragment> : null }
                </Card>

                <Card hidden={ kbmMode === 'native' }>
                    <h1>{t('settings.input.keyboardMappingsTitle')}</h1>
                    <p>
                        <small>{t('settings.input.keyboardMappingsDescription')}</small>
                    </p>
                    <p>
                        {
                            <KeySettings keyConfigs={controllerKeys ?? {}} setKeyConfig={setKeyConfig} />
                        }
                    </p>
                </Card>

                <Card>
                    <h1>{t('settings.input.controllerDetectedTitle')}</h1>

                    <p>{t('settings.input.controllerDetectedDescription')}</p>

                    <div>
                        {
                            navigator.getGamepads().map((item, index) => {
                                return (
                                    <p key={ index }>
                                #{ index+1 } &nbsp;

                                        { (item) ?
                                            item.id + ' ' + t('settings.input.axesLabel') + ': ' + item.axes.length + ', ' + t('settings.input.buttonsLabel') + ': ' + item.buttons.length + ', ' + t('settings.input.rumbleLabel') + ': ' + ((item.vibrationActuator !== null) ? (item.vibrationActuator as any).type : t('settings.input.notSupportedLabel'))
                                            : t('settings.input.noControllerDetected')
                                        }
                                    </p>
                                )
                            })
                        }
                    </div>
                </Card>
            </SettingsSidebar>


        </React.Fragment>
    )
}

export default SettingsInput
