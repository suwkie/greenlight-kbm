import IpcBase from './base'
import { defaultSettings } from '../../renderer/context/userContext.defaults'

export default class IpcSettings extends IpcBase {

    setSettings(args:(typeof defaultSettings)){
        return new Promise((resolve) => {
            // Check for changes which we need to take action on
            // const settings = this._application._store.get('settings', defaultSettings) as Object
            // const prevSettings = {...defaultSettings, ...settings}
            const incoming = args as any
            const newSettings = {...defaultSettings, ...incoming}

            // Users upgrading from the old "Enable Mouse & Keyboard" checkbox
            // (including the localStorage migration path) do not have
            // input_kbm_mode yet. Keep their setting when saving.
            if (incoming.input_kbm_mode === undefined && incoming.input_mousekeyboard === true) {
                newSettings.input_kbm_mode = 'native'
            }

            // Perform save
            this._application._store.set('settings', newSettings)
            resolve(newSettings)
        })
    }

    getSettings(){
        return new Promise<typeof defaultSettings>((resolve) => {
            const stored = this._application._store.get('settings', {}) as any
            const settings = {...defaultSettings, ...stored}

            // Migrate the old "Enable Mouse & Keyboard" checkbox to the new
            // keyboard & mouse mode setting.
            if (stored.input_kbm_mode === undefined && stored.input_mousekeyboard === true) {
                settings.input_kbm_mode = 'native'
            }

            resolve(settings)
        })
    }

    getWebUIStatus(){
        return new Promise((resolve) => {
            resolve((this._application._webUI._express ? true : false))
        })
    }

    startWebUI(){
        return new Promise((resolve) => {
            const rawSettings = this._application._store.get('settings', defaultSettings) as object
            const settings = {...defaultSettings, ...rawSettings}
            this._application._webUI.startServer(settings.webui_port)
            resolve(true)
        })
    }


    stopWebUI(){
        return new Promise((resolve) => {
            this._application._webUI.stopServer()
            resolve(false)
        })
    }

    setLowResolution(){
        return new Promise((resolve) => {
            
            this.getSettings().then((settings) => {
                if(settings.app_lowresolution === false){
                    this._application._mainWindow.setSize(985, 615)
                    settings.app_lowresolution = true

                } else {
                    this._application._mainWindow.setSize(1280, 800)
                    settings.app_lowresolution = false
                }

                this.setSettings(settings)
            })


            // if(this._application._mainWindow.height !)
            // this._application._mainWindow.setSize(960, 600)
             
            resolve(true)
        })
    }
}