import React from 'react'
import { useTranslation } from 'react-i18next'

import { keyLabelForCode } from '../../lib/kbm/codes'
import { KbmStatus } from '../../lib/kbm/types'

interface KbmOverlayProps {
    status: KbmStatus;
    toggleKey: string;
}

function modeLabel(status: KbmStatus, t): string {
    if (status.mode === 'native') {
        return t('streamWindow.kbmModeNative')
    }

    return t('streamWindow.kbmModeGamepad')
}

function KbmOverlay({
    status,
    toggleKey,
}: KbmOverlayProps) {
    const { t } = useTranslation()
    const [showBadge, setShowBadge] = React.useState(true)

    React.useEffect(() => {
        if (!status.locked) {
            setShowBadge(true)
            return
        }

        setShowBadge(true)
        const timer = setTimeout(() => setShowBadge(false), 3000)

        return () => clearTimeout(timer)
    }, [status.locked, status.mode])

    if (status.enabled !== true) {
        return null
    }

    const hotkey = keyLabelForCode(toggleKey)

    if (status.locked === false) {
        return (
            <div id="component_kbm_overlay">
                <div id="component_kbm_prompt">
                    <div id="component_kbm_prompt_title">
                        <i className="fa-solid fa-computer-mouse"></i> {t('streamWindow.kbmCaptureTitle')}
                    </div>
                    <div id="component_kbm_prompt_description">
                        {t('streamWindow.kbmCaptureDescription')}
                    </div>
                    <div id="component_kbm_prompt_hints">
                        <span>{modeLabel(status, t)}</span>
                        <span className="kbm-hint-separator">•</span>
                        <span>{t('streamWindow.kbmSwitchHint', { key: hotkey })}</span>
                        <span className="kbm-hint-separator">•</span>
                        <span>{t('streamWindow.kbmReleaseHint')}</span>
                    </div>
                    {status.mode === 'gamepad' && status.supported === false ? (
                        <div id="component_kbm_prompt_warning">
                            {t('streamWindow.kbmNativeUnsupported')}
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    if (!showBadge) {
        return null
    }

    return (
        <div id="component_kbm_overlay">
            <div id="component_kbm_badge">
                <i className={ status.mode === 'native' ? 'fa-solid fa-keyboard' : 'fa-solid fa-gamepad' }></i>
                &nbsp;{modeLabel(status, t)}
                <span className="kbm-hint-separator">•</span>
                <span className="kbm-key">{hotkey}</span>
            </div>
        </div>
    )
}

export default KbmOverlay
